import { Execution, Game, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { PlaneExecution } from "./PlaneExecution";

/**
 * AirportExecution — mirrors PortExecution's role for trade ships, but
 * for planes. Every 10 ticks, decides whether to spawn a plane bound
 * for one of the player's friendly / neutral airports. Enemy airports
 * are filtered out (the user's spec: "ils évitent les pays ennemis").
 */
export class AirportExecution implements Execution {
  private active = true;
  private mg: Game;
  private airport: Unit;
  private random: PseudoRandom;
  private checkOffset: number;
  private planeSpawnRejections = 0;

  constructor(airport: Unit) {
    this.airport = airport;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }
    if (this.airport.isUnderConstruction()) {
      return;
    }
    // Check every 10 ticks, like PortExecution.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    if (!this.shouldSpawnPlane()) {
      return;
    }

    const candidates = this.candidateDestinations();
    if (candidates.length === 0) return;

    const dst = this.random.randElement(candidates);
    this.mg.addExecution(new PlaneExecution(this.airport.owner(), this.airport, dst));
  }

  private shouldSpawnPlane(): boolean {
    const numPlanes = this.mg.unitCount(UnitType.Plane);
    const spawnRate = this.mg
      .config()
      .planeSpawnRate(this.planeSpawnRejections, numPlanes);
    for (let i = 0; i < this.airport.level(); i++) {
      if (this.random.chance(spawnRate)) {
        this.planeSpawnRejections = 0;
        return true;
      }
      this.planeSpawnRejections++;
    }
    return false;
  }

  /**
   * Airports the local airport can legally fly to. Filters out enemy
   * players (planes "evite les pays ennemis" — the cheapest approximation
   * is to never pick a destination owned by an enemy in the first place).
   * Also avoids destinations whose straight-line path crosses enemy
   * territory.
   */
  private candidateDestinations(): Unit[] {
    const owner = this.airport.owner();
    return this.mg
      .players()
      .filter((p) => p !== owner && owner.canTrade(p))
      .flatMap((p) => p.units(UnitType.Airport))
      .filter(
        (a) =>
          a.isActive() &&
          !a.isUnderConstruction() &&
          this.pathSafeFromEnemies(a),
      );
  }

  /**
   * Walks a Bresenham-style straight line between the two airports;
   * returns false if any tile along the way is owned by an enemy of
   * the source player. Cheap proxy for "planes evite les pays ennemis"
   * without having to run a full A*.
   */
  private pathSafeFromEnemies(dst: Unit): boolean {
    const owner = this.airport.owner();
    const x0 = this.mg.x(this.airport.tile());
    const y0 = this.mg.y(this.airport.tile());
    const x1 = this.mg.x(dst.tile());
    const y1 = this.mg.y(dst.tile());

    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    // Cap iterations to avoid pathological loops on tiny maps.
    const maxSteps = (dx - dy) + 4;
    for (let step = 0; step < maxSteps; step++) {
      const tile = this.mg.ref(x, y);
      const tileOwner = this.mg.owner(tile);
      if (
        tileOwner.isPlayer() &&
        tileOwner !== owner &&
        !owner.canTrade(tileOwner)
      ) {
        return false;
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
