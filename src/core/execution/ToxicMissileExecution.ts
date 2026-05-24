import {
  Attack,
  Execution,
  Game,
  MessageType,
  Player,
  Structures,
  TerraNullius,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";

// 2 minutes at 10 ticks/sec (MS_PER_TICK = 100).
const TOXIC_DURATION_TICKS = 60 * 10 * 2;

function attackTouchesBlast(
  attack: Attack,
  blastSet: ReadonlySet<TileRef>,
): boolean {
  // Iterate the smaller set for speed — most attacks have ≤ a few thousand
  // border tiles, but a blast at outer=30 only touches ~2,800 tiles, so
  // either side is comparable. Border-side wins for big attacks targeting
  // small nuked patches; blast-side wins for huge fronts. Iterate border:
  // the API returns ReadonlySet so the indirection is constant.
  for (const tile of attack.borderTiles()) {
    if (blastSet.has(tile)) return true;
  }
  return false;
}

/**
 * ToxicMissile — same trajectory + blast radius as an Atom Bomb, but it does
 * not destroy land or troops. Instead it marks every tile in the blast as
 * toxic for 2 minutes, suppressing 75% of attacking troops trying to conquer
 * those tiles (handled in Config.attackLogic via Game.isToxic).
 */
export class ToxicMissileExecution implements Execution {
  private active = true;
  private mg: Game;
  private nuke: Unit | null = null;
  private pathFinder: ParabolaUniversalPathFinder;
  private toxicTiles: TileRef[] = [];
  private expiryTick = -1;

  constructor(
    private player: Player,
    private dst: TileRef,
    private src?: TileRef | null,
    private speed: number = -1,
    private waitTicks = 0,
    private rocketDirectionUp: boolean = true,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.speed === -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
      distanceBasedHeight: true,
      directionUp: this.rocketDirectionUp,
    });
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  tick(ticks: number): void {
    // Phase 1 — spawn the missile from a silo.
    if (this.nuke === null && this.expiryTick === -1) {
      const spawn = this.player.canBuild(UnitType.ToxicMissile, this.dst);
      if (spawn === false) {
        console.warn(`cannot build ToxicMissile`);
        this.active = false;
        return;
      }
      this.src = spawn;
      this.nuke = this.player.buildUnit(UnitType.ToxicMissile, spawn, {
        targetTile: this.dst,
        trajectory: this.getTrajectory(this.dst),
      });

      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (target.isPlayer()) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            `${this.player.displayName()} - toxic missile inbound`,
            MessageType.NUKE_INBOUND,
            target.id(),
          );
        }
      }

      const silo = this.player
        .units(UnitType.MissileSilo)
        .find((silo) => silo.tile() === spawn);
      if (silo) {
        silo.launch();
      }
      return;
    }

    // Phase 3 — toxic zone expiring.
    if (this.expiryTick !== -1) {
      if (this.mg.ticks() >= this.expiryTick) {
        for (const tile of this.toxicTiles) {
          this.mg.clearToxic(tile);
        }
        this.toxicTiles = [];
        this.active = false;
      }
      return;
    }

    // Phase 2 — flight + intercept handling.
    if (!this.nuke!.isActive()) {
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    const result = this.pathFinder.next(this.src!, this.dst, this.speed);
    if (result.status === PathStatus.COMPLETE) {
      this.detonate();
      return;
    } else if (result.status === PathStatus.NEXT) {
      this.updateNukeTargetable();
      this.nuke!.move(result.node);
      this.nuke!.setTrajectoryIndex(this.pathFinder.currentIndex());
    }
  }

  public getNuke(): Unit | null {
    return this.nuke;
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles = this.pathFinder.findPath(this.src!, target) ?? [];
    for (const tile of allTiles) {
      trajectoryTiles.push({
        tile,
        targetable: this.isTargetable(target, tile, targetRangeSquared),
      });
    }
    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    nukeTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    return (
      this.mg.euclideanDistSquared(nukeTile, targetTile) < targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, nukeTile) < targetRangeSquared)
    );
  }

  private updateNukeTargetable() {
    if (this.nuke === null || this.nuke.targetTile() === undefined) {
      return;
    }
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.nuke.targetTile();
    this.nuke.setTargetable(
      this.isTargetable(targetTile!, this.nuke.tile(), targetRangeSquared),
    );
  }

  private detonate() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    const mg = this.mg;
    const magnitude = mg.config().nukeMagnitudes(UnitType.ToxicMissile);

    const outer2 = magnitude.outer * magnitude.outer;
    const cx = mg.x(this.dst);
    const cy = mg.y(this.dst);
    const outer = magnitude.outer;
    const x0 = Math.max(0, cx - outer);
    const y0 = Math.max(0, cy - outer);
    const x1 = Math.min(mg.width() - 1, cx + outer);
    const y1 = Math.min(mg.height() - 1, cy + outer);

    const expiryTick = mg.ticks() + TOXIC_DURATION_TICKS;
    this.expiryTick = expiryTick;

    const blastSet = new Set<TileRef>();
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > outer2) continue;
        const tile = mg.ref(px, py);
        if (!mg.isLand(tile)) continue;
        mg.setToxic(tile, expiryTick);
        this.toxicTiles.push(tile);
        blastSet.add(tile);
      }
    }

    // Wipe 77% of any active attack whose front line touches the blast.
    // We check both outgoing and incoming attacks of every player so attackers
    // and defenders fighting inside the zone both take the hit. Each attack is
    // processed once via the visited set (incoming/outgoing share the same
    // Attack object).
    const visited = new Set<string>();
    for (const player of mg.players()) {
      const attacks = [
        ...player.outgoingAttacks(),
        ...player.incomingAttacks(),
      ];
      for (const attack of attacks) {
        if (visited.has(attack.id())) continue;
        visited.add(attack.id());
        if (!attack.isActive()) continue;
        if (!attackTouchesBlast(attack, blastSet)) continue;
        attack.setTroops(Math.floor(attack.troops() * 0.23));
      }
    }

    // Trigger structure redraw so the detonation pops visually like a nuke.
    this.redrawBuildings(magnitude.outer);

    this.nuke.setReachedTarget();
    this.nuke.delete(false);
  }

  private redrawBuildings(range: number) {
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (Structures.has(unit.type())) {
        if (
          this.mg.euclideanDistSquared(this.dst, unit.tile()) < rangeSquared
        ) {
          unit.touch();
        }
      }
    }
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
