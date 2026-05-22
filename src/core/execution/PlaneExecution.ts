import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";

/**
 * PlaneExecution — sibling of TradeShipExecution, but for aircraft.
 * Planes fly in a straight line over both water and land (using the
 * existing AirPathFinder), generating gold on arrival. Per-tick speed
 * is `PLANE_TILES_PER_TICK`: a plane is meaningfully faster than a
 * trade ship (~1 tile/tick) — the user spec is roughly 3x.
 */
const PLANE_TILES_PER_TICK = 3;
export class PlaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | undefined;
  private pathFinder: AirPathFinder;
  private tilesTraveled = 0;
  private wasCaptured = false;

  constructor(
    private origOwner: Player,
    private srcAirport: Unit,
    private dstAirport: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new AirPathFinder(mg);
  }

  tick(ticks: number): void {
    if (this.plane === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.Plane,
        this.srcAirport.tile(),
      );
      if (spawn === false) {
        this.active = false;
        return;
      }
      this.plane = this.origOwner.buildUnit(UnitType.Plane, spawn, {
        targetUnit: this.dstAirport,
      });
    }

    if (!this.plane.isActive()) {
      this.active = false;
      return;
    }

    const planeOwner = this.plane.owner();
    const dstOwner = this.dstAirport.owner();

    // Same-owner src/dst: nothing to gain, abort.
    if (dstOwner.id() === this.srcAirport.owner().id()) {
      this.plane.delete(false);
      this.active = false;
      return;
    }

    // Cancel mid-flight if the destination airport is gone or the
    // relationship turned hostile.
    if (
      !this.wasCaptured &&
      (!this.dstAirport.isActive() || !planeOwner.canTrade(dstOwner))
    ) {
      this.plane.delete(false);
      this.active = false;
      return;
    }

    if (this.wasCaptured !== true && this.origOwner !== planeOwner) {
      this.wasCaptured = true;
    }

    const dst = this.dstAirport.tile();
    // Advance up to PLANE_TILES_PER_TICK tiles this tick, stopping
    // early if we reach the destination or run out of path.
    for (let step = 0; step < PLANE_TILES_PER_TICK; step++) {
      const curTile = this.plane.tile();
      if (curTile === dst) {
        this.complete();
        return;
      }
      const path = this.pathFinder.findPath(curTile, dst);
      if (!path || path.length < 2) {
        this.plane.delete(false);
        this.active = false;
        return;
      }
      this.plane.move(path[1]);
      this.tilesTraveled++;
    }
  }

  private complete(): void {
    this.active = false;
    this.plane!.delete(false);
    const gold = this.mg
      .config()
      .planeGold(this.tilesTraveled, this.plane!.owner());
    if (this.wasCaptured) {
      this.plane!.owner().addGold(gold, this.dstAirport.tile());
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.plane!.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.origOwner.displayName(),
        },
      );
    } else {
      this.srcAirport.owner().addGold(gold, this.srcAirport.tile());
      this.dstAirport.owner().addGold(gold, this.dstAirport.tile());
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
