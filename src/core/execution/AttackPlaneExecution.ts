/**
 * AttackPlaneExecution — a single colon plane carrying troops toward a
 * destination tile. Mirrors `PlaneExecution` for movement (3 tiles/tick,
 * straight-line `AirPathFinder`) but on arrival it triggers an
 * `AttackExecution` against whoever owns the destination, like a
 * `TransportShipExecution` does for boat colonization.
 *
 * Spawned exclusively by `PlaneAttackExecution`, which handles gold + fleet
 * accounting. The plane is rendered with the same sprite as a trade plane
 * (UT_PLANE column) and leaves a trail like a transport ship.
 */

import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";
import { AttackExecution } from "./AttackExecution";

const ATTACK_PLANE_TILES_PER_TICK = 3;
/** After this many ticks with no path progress we give up. */
const MAX_STALL_TICKS = 20;

export class AttackPlaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | undefined;
  private pathFinder: AirPathFinder;
  private stallTicks = 0;

  constructor(
    private attacker: Player,
    private srcAirport: Unit,
    private dst: TileRef,
    private troops: number,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    this.mg = mg;
    this.pathFinder = new AirPathFinder(mg);
  }

  tick(): void {
    if (!this.active) return;

    if (this.plane === undefined) {
      const spawn = this.attacker.canBuild(
        UnitType.AttackPlane,
        this.srcAirport.tile(),
      );
      if (spawn === false) {
        this.refundOnFailure();
        this.active = false;
        return;
      }
      this.plane = this.attacker.buildUnit(UnitType.AttackPlane, spawn, {
        targetTile: this.dst,
        troops: this.troops,
      });
    }

    if (!this.plane.isActive()) {
      this.active = false;
      return;
    }

    // Advance up to N tiles this tick.
    let moved = false;
    for (let step = 0; step < ATTACK_PLANE_TILES_PER_TICK; step++) {
      const curTile = this.plane.tile();
      if (curTile === this.dst) {
        this.completeAttack();
        return;
      }
      const path = this.pathFinder.findPath(curTile, this.dst);
      if (!path || path.length < 2) break;
      this.plane.move(path[1]);
      moved = true;
    }

    if (!moved) {
      this.stallTicks++;
      if (this.stallTicks > MAX_STALL_TICKS) {
        this.refundOnFailure();
        this.plane.delete(false);
        this.active = false;
      }
    } else {
      this.stallTicks = 0;
    }
  }

  /** Land on the destination tile → launch a normal attack with the carried troops. */
  private completeAttack(): void {
    if (this.plane === undefined) return;
    const targetOwner = this.mg.owner(this.dst);
    this.plane.delete(false);
    this.active = false;

    if (targetOwner.id() === this.attacker.id()) {
      // Already owned — reabsorb the troops with no penalty.
      this.attacker.addTroops(this.troops);
      return;
    }

    this.attacker.conquer(this.dst);
    if (targetOwner.isPlayer() && this.attacker.isFriendly(targetOwner)) {
      // Friendly drop — return the troops to the player.
      this.attacker.addTroops(this.troops);
      return;
    }

    this.mg.addExecution(
      new AttackExecution(
        this.troops,
        this.attacker,
        targetOwner.id(),
        this.dst,
        false,
      ),
    );
  }

  /** If the plane never made it off the ground, restore the troops it was
   *  carrying so the player isn't penalised for our failure. */
  private refundOnFailure(): void {
    this.attacker.addTroops(this.troops);
  }

  isActive(): boolean {
    return this.active;
  }
}
