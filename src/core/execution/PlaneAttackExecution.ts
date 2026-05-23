/**
 * PlaneAttackExecution — spawner for "colon plane" attacks.
 *
 * When the player clicks a far-away enemy/empty tile and has at least one
 * airport in range, this execution figures out:
 *   • Which airport launches (closest to the destination)
 *   • How many planes to send (cap of 3, each costs 50k gold, and the
 *     player can never have more than 3 colon planes in flight at once)
 *   • How troops are split (equal share per plane)
 *
 * It then debits the gold and spawns one `AttackPlaneExecution` per plane.
 * The individual planes carry their share of troops and trigger an
 * `AttackExecution` on the destination tile on arrival.
 */

import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AttackPlaneExecution } from "./AttackPlaneExecution";

const COLON_PLANE_MAX = 3;
const COLON_PLANE_COST = 50_000n;
/** Generous range so colon planes are a true long-distance option. */
export const COLON_PLANE_RANGE = 600;

export class PlaneAttackExecution implements Execution {
  private active = true;

  constructor(
    private attacker: Player,
    private dst: TileRef,
    private troops: number,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    if (!mg.isValidRef(this.dst)) {
      this.active = false;
      return;
    }

    // Find the player's closest airport to the destination.
    const src = this.findSourceAirport(mg);
    if (src === null) {
      mg.displayMessage(
        "events_display.plane_attack.no_airport",
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
      );
      this.active = false;
      return;
    }

    // Distance gate.
    const d2 = squaredDistance(mg, src.tile(), this.dst);
    if (d2 > COLON_PLANE_RANGE * COLON_PLANE_RANGE) {
      mg.displayMessage(
        "events_display.plane_attack.out_of_range",
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
      );
      this.active = false;
      return;
    }

    // How many planes can we afford + are we under the in-flight cap?
    const inFlight = this.attacker.unitCount(UnitType.AttackPlane);
    const remainingSlots = Math.max(0, COLON_PLANE_MAX - inFlight);
    const affordable = Number(this.attacker.gold() / COLON_PLANE_COST);
    const count = Math.min(COLON_PLANE_MAX, remainingSlots, affordable);
    if (count <= 0) {
      mg.displayMessage(
        "events_display.plane_attack.fleet_full",
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
      );
      this.active = false;
      return;
    }

    // Equal troop split across the planes (rounded down; remainder stays
    // with the player). This matches how boat attacks behave when they
    // can't allocate the full pool.
    const perPlane = Math.max(1, Math.floor(this.troops / count));
    const totalSpent = perPlane * count;
    this.attacker.removeTroops(totalSpent);

    for (let i = 0; i < count; i++) {
      this.attacker.removeGold(COLON_PLANE_COST);
      mg.addExecution(new AttackPlaneExecution(this.attacker, src, this.dst, perPlane));
    }

    // One-shot spawner.
    this.active = false;
  }

  /** Returns the player's airport with the smallest distance² to dst. */
  private findSourceAirport(mg: Game): Unit | null {
    let best: Unit | null = null;
    let bestD2 = Infinity;
    for (const u of mg.units(UnitType.Airport)) {
      if (u.owner().id() !== this.attacker.id()) continue;
      if (!u.isActive() || u.isUnderConstruction()) continue;
      const d2 = squaredDistance(mg, u.tile(), this.dst);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = u;
      }
    }
    return best;
  }

  tick(): void {
    // All work happens in init() — nothing to do per tick.
  }

  isActive(): boolean {
    return this.active;
  }
}

function squaredDistance(mg: Game, a: TileRef, b: TileRef): number {
  const dx = mg.x(a) - mg.x(b);
  const dy = mg.y(a) - mg.y(b);
  return dx * dx + dy * dy;
}
