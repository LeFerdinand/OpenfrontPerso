/**
 * WeatherExecution — extreme-weather event manager.
 *
 * Runs every tick when the `weather` config flag is on. Owns the
 * cooldowns + active-event caps for the three weather types and
 * spawns child executions that carry out the per-tick effects:
 *
 *   • FogPatch     — non-destructive visual area (10 s lifetime).
 *                    Max 2 simultaneous, 4 min cooldown between
 *                    spawns.
 *   • Earthquake   — instantaneous; picks a random mountain tile and
 *                    destroys each structure inside its radius with
 *                    1/3 probability. 1 at a time, 1 min cooldown.
 *   • Cyclone      — wanders across the sea for up to 40 s,
 *                    deleting trade ships + warships in its radius.
 *                    1 at a time, 5 min cooldown.
 *
 * Visual rendering of these events is intentionally out of scope for
 * this first iteration — the player is notified via in-game messages.
 */

import {
  Execution,
  Game,
  MessageType,
  Structures,
  TerrainType,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType, WeatherKind } from "../game/GameUpdates";
import { PseudoRandom } from "../PseudoRandom";

const TICKS_PER_SECOND = 10;

// --- Tuning constants ------------------------------------------------------
const FOG_DURATION_TICKS = 10 * TICKS_PER_SECOND;
const FOG_MAX_CONCURRENT = 2;
const FOG_COOLDOWN_TICKS = 4 * 60 * TICKS_PER_SECOND;
const FOG_RADIUS = 30;

const QUAKE_COOLDOWN_TICKS = 60 * TICKS_PER_SECOND;
const QUAKE_RADIUS = 12;
const QUAKE_DESTROY_PROBABILITY = 1 / 3;

const CYCLONE_MAX_DURATION_TICKS = 40 * TICKS_PER_SECOND;
const CYCLONE_COOLDOWN_TICKS = 5 * 60 * TICKS_PER_SECOND;
const CYCLONE_RADIUS = 54;
const CYCLONE_SPEED = 0.5; // tiles per tick — slow drift
const CYCLONE_TARGETS: readonly UnitType[] = [
  UnitType.TradeShip,
  UnitType.Warship,
];

// --- Helper: pick a random tile of a given kind ----------------------------
function findRandomTile(
  game: Game,
  random: PseudoRandom,
  predicate: (tile: TileRef) => boolean,
  maxTries = 400,
): TileRef | null {
  const w = game.width();
  const h = game.height();
  for (let i = 0; i < maxTries; i++) {
    const x = random.nextInt(0, w);
    const y = random.nextInt(0, h);
    const tile = game.ref(x, y);
    if (predicate(tile)) return tile;
  }
  return null;
}

/** Interface every weather child execution exposes so the manager can
 *  publish its render state each tick. */
interface WeatherEvent extends Execution {
  readonly kind: WeatherKind;
  readonly id: number;
  /** Current center in tile coordinates. */
  centerX(): number;
  centerY(): number;
  readonly radius: number;
  /** Fraction of lifetime left, 0..1. Instantaneous events return 1. */
  remainingFrac(): number;
}

let nextWeatherId = 1;

// --- Manager ---------------------------------------------------------------
export class WeatherExecution implements Execution {
  private mg: Game;
  private random: PseudoRandom;
  private active = true;

  private nextFogTick = 0;
  private activeFogs: FogPatchExecution[] = [];

  private nextQuakeTick = 0;
  private activeQuake: EarthquakeExecution | null = null;

  private nextCycloneTick = 0;
  private activeCyclone: CycloneExecution | null = null;

  init(mg: Game): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks() + 0xfeed);
    // Stagger initial spawns so we don't see all three pop on tick 1.
    this.nextFogTick = mg.ticks() + 30 * TICKS_PER_SECOND;
    this.nextQuakeTick = mg.ticks() + 60 * TICKS_PER_SECOND;
    this.nextCycloneTick = mg.ticks() + 90 * TICKS_PER_SECOND;
  }

  tick(ticks: number): void {
    // Prune finished events from our concurrent caps.
    this.activeFogs = this.activeFogs.filter((e) => e.isActive());
    if (this.activeQuake !== null && !this.activeQuake.isActive()) {
      this.activeQuake = null;
    }
    if (this.activeCyclone !== null && !this.activeCyclone.isActive()) {
      this.activeCyclone = null;
    }

    this.maybeSpawnFog(ticks);
    this.maybeSpawnQuake(ticks);
    this.maybeSpawnCyclone(ticks);

    // Publish render state for every still-active event so the client
    // renderer can draw the overlays this tick.
    const publish = (e: WeatherEvent) =>
      this.mg.addUpdate({
        type: GameUpdateType.WeatherEvent,
        kind: e.kind,
        id: e.id,
        x: e.centerX(),
        y: e.centerY(),
        radius: e.radius,
        remaining: e.remainingFrac(),
      });
    for (const f of this.activeFogs) publish(f);
    if (this.activeQuake !== null) publish(this.activeQuake);
    if (this.activeCyclone !== null) publish(this.activeCyclone);
  }

  private maybeSpawnFog(ticks: number): void {
    if (this.activeFogs.length >= FOG_MAX_CONCURRENT) return;
    if (ticks < this.nextFogTick) return;

    const tile = findRandomTile(this.mg, this.random, (t) =>
      // Land or water both fine — fog spawns anywhere on the map.
      this.mg.isValidRef(t),
    );
    if (tile === null) return;

    const fog = new FogPatchExecution(
      this.mg.x(tile),
      this.mg.y(tile),
      FOG_RADIUS,
      FOG_DURATION_TICKS,
    );
    this.mg.addExecution(fog);
    this.activeFogs.push(fog);
    this.nextFogTick = ticks + FOG_COOLDOWN_TICKS;

    this.notify("events_display.weather.fog", tile);
  }

  private maybeSpawnQuake(ticks: number): void {
    if (this.activeQuake !== null) return;
    if (ticks < this.nextQuakeTick) return;

    const tile = findRandomTile(
      this.mg,
      this.random,
      (t) => this.mg.terrainType(t) === TerrainType.Mountain,
    );
    if (tile === null) return;

    const quake = new EarthquakeExecution(
      tile,
      this.mg.x(tile),
      this.mg.y(tile),
      QUAKE_RADIUS,
      QUAKE_DESTROY_PROBABILITY,
      this.random,
    );
    this.activeQuake = quake;
    this.mg.addExecution(quake);
    this.nextQuakeTick = ticks + QUAKE_COOLDOWN_TICKS;

    this.notify("events_display.weather.earthquake", tile);
  }

  private maybeSpawnCyclone(ticks: number): void {
    if (this.activeCyclone !== null) return;
    if (ticks < this.nextCycloneTick) return;

    const tile = findRandomTile(this.mg, this.random, (t) =>
      this.mg.isOcean(t),
    );
    if (tile === null) return;

    // Random unit direction.
    const angle = this.random.nextInt(0, 360) * (Math.PI / 180);
    const cyclone = new CycloneExecution(
      this.mg.x(tile),
      this.mg.y(tile),
      CYCLONE_RADIUS,
      Math.cos(angle) * CYCLONE_SPEED,
      Math.sin(angle) * CYCLONE_SPEED,
      CYCLONE_MAX_DURATION_TICKS,
    );
    this.activeCyclone = cyclone;
    this.mg.addExecution(cyclone);
    this.nextCycloneTick = ticks + CYCLONE_COOLDOWN_TICKS;

    this.notify("events_display.weather.cyclone", tile);
  }

  private notify(key: string, focusTile?: TileRef): void {
    this.mg.displayMessage(
      key,
      MessageType.WEATHER_EVENT,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      focusTile,
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// --- Fog patch -------------------------------------------------------------
class FogPatchExecution implements WeatherEvent {
  readonly kind: WeatherKind = "fog";
  readonly id = nextWeatherId++;
  private active = true;
  private remaining: number;
  private readonly duration: number;

  constructor(
    private readonly cx: number,
    private readonly cy: number,
    public readonly radius: number,
    durationTicks: number,
  ) {
    this.duration = durationTicks;
    this.remaining = durationTicks;
  }

  init(_mg: Game): void {}

  tick(): void {
    if (this.remaining-- <= 0) {
      this.active = false;
    }
  }

  centerX(): number {
    return this.cx;
  }
  centerY(): number {
    return this.cy;
  }
  remainingFrac(): number {
    return Math.max(0, this.remaining / this.duration);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// --- Earthquake (instantaneous burst, kept "live" briefly for a flash) -----
class EarthquakeExecution implements WeatherEvent {
  readonly kind: WeatherKind = "earthquake";
  readonly id = nextWeatherId++;
  private mg: Game;
  private active = true;
  /** Stays visible for ~1s so the player sees the flash. */
  private static readonly DISPLAY_TICKS = 10;
  private remaining = EarthquakeExecution.DISPLAY_TICKS;
  private applied = false;

  constructor(
    public readonly tile: TileRef,
    private readonly cx: number,
    private readonly cy: number,
    public readonly radius: number,
    private destroyProbability: number,
    private random: PseudoRandom,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    if (!this.applied) {
      const candidates = this.mg.nearbyUnits(
        this.tile,
        this.radius,
        Structures.types,
        undefined,
        false,
      );
      for (const { unit } of candidates) {
        if (this.random.chance(Math.round(1 / this.destroyProbability))) {
          unit.delete(true);
        }
      }
      this.applied = true;
    }
    if (--this.remaining <= 0) {
      this.active = false;
    }
  }

  centerX(): number {
    return this.cx;
  }
  centerY(): number {
    return this.cy;
  }
  remainingFrac(): number {
    return Math.max(0, this.remaining / EarthquakeExecution.DISPLAY_TICKS);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

// --- Cyclone (moving) ------------------------------------------------------
class CycloneExecution implements WeatherEvent {
  readonly kind: WeatherKind = "cyclone";
  readonly id = nextWeatherId++;
  private mg: Game;
  private active = true;
  private readonly duration: number;
  private remaining: number;
  private cx: number;
  private cy: number;

  constructor(
    startX: number,
    startY: number,
    public readonly radius: number,
    private vx: number,
    private vy: number,
    maxDuration: number,
  ) {
    this.duration = maxDuration;
    this.remaining = maxDuration;
    this.cx = startX;
    this.cy = startY;
  }

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    this.remaining--;
    this.cx += this.vx;
    this.cy += this.vy;
    if (this.remaining <= 0 || !this.inBounds()) {
      this.active = false;
      return;
    }
    const xi = Math.round(this.cx);
    const yi = Math.round(this.cy);
    if (!this.mg.isValidCoord(xi, yi)) return;
    const here = this.mg.ref(xi, yi);
    // Sweep ships in range — TradeShip and Warship.
    const targets = this.mg.nearbyUnits(
      here,
      this.radius,
      CYCLONE_TARGETS,
      undefined,
      false,
    );
    for (const { unit } of targets) {
      unit.delete(true);
    }
  }

  centerX(): number {
    return this.cx;
  }
  centerY(): number {
    return this.cy;
  }
  remainingFrac(): number {
    return Math.max(0, this.remaining / this.duration);
  }

  private inBounds(): boolean {
    return (
      this.cx >= 0 &&
      this.cy >= 0 &&
      this.cx < this.mg.width() &&
      this.cy < this.mg.height()
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
