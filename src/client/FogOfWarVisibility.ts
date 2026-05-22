/**
 * FogOfWarVisibility — CPU-side computation of which tiles the local
 * player can currently see. Used by WebGLFrameBuilder when the
 * `fogOfWar` config flag is on (singleplayer feature).
 *
 * Three-state output (per tile, in the visibility byte):
 *   0   — never explored (renders pitch black)
 *   128 — explored but not currently visible (renders dim grey "memory")
 *   255 — currently visible (no fog)
 *
 * A tile is currently visible when any of the following is true:
 *   - it's owned by the local player or an ally / teammate
 *   - it's within TERRITORY_HALO_RADIUS of a friendly border tile
 *   - it's within UNIT_VISION_RADIUS of a local-player unit
 *
 * The "ever-seen" mask is persistent for the whole game: once a tile
 * becomes visible, it stays at least grey forever (until the game ends).
 * Resets implicitly with each new game (fresh FogOfWarVisibility).
 *
 * During the spawn phase, or before the local player owns any territory,
 * everything renders as visible (no fog, no ever-seen update) — fog
 * only kicks in once gameplay has started.
 */

import { TileRef } from "../core/game/GameMap";
import { GameView } from "../core/game/GameView";
import { OWNER_MASK } from "./render/gl/utils/TileCodec";

/**
 * Radius in tiles around a friendly unit that becomes visible. Chosen
 * to be useful for scouting (see incoming warships) without revealing
 * huge portions of the map.
 */
export const UNIT_VISION_RADIUS = 30;

/**
 * Radius in tiles around friendly *border* tiles that becomes visible.
 * Gives the player a comfortable view of the world surrounding their
 * territory (neighbors, approaching threats) without revealing the
 * whole map.
 */
export const TERRITORY_HALO_RADIUS = 25;

/**
 * Cheap on-demand visibility check for a single tile, mirroring the
 * texture buffer's logic. Use this for UI decisions like "should we
 * show this player's info on hover?" without paying for a full sweep.
 *
 * Returns true when fog isn't active (no flag, spawn phase, no
 * territory yet) so callers can treat "fog off" and "tile visible"
 * the same way.
 */
export function isTileVisibleToLocalPlayer(
  gameView: GameView,
  tile: TileRef,
): boolean {
  if (!gameView.config().fogOfWar()) return true;
  const me = gameView.myPlayer();
  if (gameView.inSpawnPhase() || me === null || me.numTilesOwned() === 0) {
    return true;
  }

  const owner = gameView.ownerID(tile);
  if (owner !== 0) {
    if (owner === me.smallID()) return true;
    for (const ally of me.allies()) {
      if (ally && ally.smallID() === owner) return true;
    }
    const myTeam = me.team();
    if (myTeam !== null) {
      const ownerPlayer = gameView.playerBySmallID(owner);
      if (ownerPlayer && ownerPlayer.isPlayer()) {
        if ((ownerPlayer as { team(): string | null }).team() === myTeam) {
          return true;
        }
      }
    }
  }

  const tx = gameView.x(tile);
  const ty = gameView.y(tile);
  const r2 = UNIT_VISION_RADIUS * UNIT_VISION_RADIUS;
  const mySmallID = me.smallID();
  for (const unit of gameView.frameData().units.values()) {
    if (unit.ownerID !== mySmallID || !unit.isActive) continue;
    const ux = gameView.x(unit.pos);
    const uy = gameView.y(unit.pos);
    const dx = ux - tx;
    const dy = uy - ty;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/** Pre-baked disc-mask stamp — 1 inside the circle, 0 outside. */
interface DiscStamp {
  readonly radius: number;
  readonly bytes: Uint8Array;
}

function buildDiscStamp(radius: number): DiscStamp {
  const diameter = 2 * radius + 1;
  const bytes = new Uint8Array(diameter * diameter);
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        bytes[(dy + radius) * diameter + (dx + radius)] = 1;
      }
    }
  }
  return { radius, bytes };
}

/** Max owner smallID value (OWNER_MASK = 0xfff = 4095). */
const OWNER_LUT_SIZE = 4096;

export class FogOfWarVisibility {
  private readonly mapW: number;
  private readonly mapH: number;
  /** Output buffer uploaded to GPU: 0 / 128 / 255. */
  private readonly visibility: Uint8Array;
  /**
   * Persistent "ever seen" mask. A tile flips to 1 the first tick it is
   * currently visible and stays 1 for the remainder of the game.
   */
  private readonly everSeen: Uint8Array;
  private readonly unitStamp: DiscStamp;
  private readonly haloStamp: DiscStamp;
  /** Reusable buffer for collected border tile indices (avoids per-tick alloc). */
  private borderRefs: Uint32Array;
  private borderCount = 0;
  /**
   * Per-tick owner-visibility lookup table. lut[smallID] = 1 when that
   * owner's tiles are visible to the local player (self, ally, teammate).
   * Direct array indexing is ~5-10× faster than Set.has() in the 4M-tile
   * hot loop — critical because the LocalServer is backpressured by main
   * thread tick processing time, so a slow visibility scan stalls the
   * simulation.
   */
  private readonly ownerVisLUT: Uint8Array;
  /**
   * Compute throttling. Building the visibility buffer involves a couple
   * of full-map scans (~4M tiles on a large map). The singleplayer
   * LocalServer is backpressured by main-thread tick processing, so a
   * slow visibility compute literally stalls the simulation — bots and
   * nations appear frozen. We only refresh the buffer every Nth tick;
   * vision changes slowly (territory and units move a few tiles per
   * second), so 5Hz updates instead of 10Hz are imperceptible.
   */
  private static readonly COMPUTE_EVERY_N_TICKS = 2;
  private ticksSinceCompute = Infinity;

  constructor(mapW: number, mapH: number) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.visibility = new Uint8Array(mapW * mapH);
    this.everSeen = new Uint8Array(mapW * mapH);
    this.unitStamp = buildDiscStamp(UNIT_VISION_RADIUS);
    this.haloStamp = buildDiscStamp(TERRITORY_HALO_RADIUS);
    this.borderRefs = new Uint32Array(4096);
    this.ownerVisLUT = new Uint8Array(OWNER_LUT_SIZE);
  }

  /** Returns the visibility buffer for upload. Buffer is reused across calls. */
  compute(gameView: GameView): Uint8Array {
    this.ticksSinceCompute++;
    const me = gameView.myPlayer();
    const vis = this.visibility;

    // Pre-spawn, no local player, or local player has no territory yet:
    // reveal everything so the player can pick a spawn / see their
    // starting context. Fog turns on the tick they own their first tile.
    if (gameView.inSpawnPhase() || me === null || me.numTilesOwned() === 0) {
      vis.fill(255);
      this.ticksSinceCompute = 0;
      return vis;
    }

    // Throttle: keep returning the cached buffer for N-1 ticks out of N.
    if (this.ticksSinceCompute < FogOfWarVisibility.COMPUTE_EVERY_N_TICKS) {
      return vis;
    }
    this.ticksSinceCompute = 0;

    vis.fill(0);

    // --- Build visible-owner LUT (self + allies + same-team mates) ---
    // smallID 0 = unowned, never marked visible from ownership.
    const lut = this.ownerVisLUT;
    lut.fill(0);
    lut[me.smallID()] = 1;
    for (const ally of me.allies()) {
      if (ally) lut[ally.smallID()] = 1;
    }
    const myTeam = me.team();
    if (myTeam !== null) {
      for (const p of gameView.players()) {
        if (p.team() === myTeam) lut[p.smallID()] = 1;
      }
    }
    // Defensive: owner=0 must never count as visible (smallID 0 = unowned).
    lut[0] = 0;

    // --- Single fused pass: mark territory visibility AND collect border
    //     tiles in one scan over tileState. The previous two-pass version
    //     scanned 4M tiles twice; this halves the cost. Border detection
    //     looks at neighbor *owners* in tileState directly (not vis[]),
    //     which lets the merge into one pass be safe.
    const tileState = gameView.frameData().tileState;
    const W = this.mapW;
    const H = this.mapH;
    this.borderCount = 0;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const interiorY = y > 0 && y < H - 1;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const owner = tileState[i] & OWNER_MASK;
        if (!lut[owner]) continue;
        vis[i] = 255;
        if (!interiorY || x === 0 || x === W - 1) continue;
        // Border: at least one 4-neighbor owner is non-friendly.
        if (
          !lut[tileState[i - 1] & OWNER_MASK] ||
          !lut[tileState[i + 1] & OWNER_MASK] ||
          !lut[tileState[i - W] & OWNER_MASK] ||
          !lut[tileState[i + W] & OWNER_MASK]
        ) {
          this.pushBorder(i);
        }
      }
    }

    // --- Stamp territory halo around each border tile ---
    const halo = this.haloStamp;
    const borderCount = this.borderCount;
    const borderRefs = this.borderRefs;
    for (let k = 0; k < borderCount; k++) {
      const ref = borderRefs[k];
      const by = (ref / W) | 0;
      const bx = ref - by * W;
      this.stampDisc(bx, by, halo);
    }

    // --- Unit-based vision: disc around every local-player unit ---
    const mySmallID = me.smallID();
    const unitStamp = this.unitStamp;
    for (const unit of gameView.frameData().units.values()) {
      if (unit.ownerID !== mySmallID) continue;
      if (!unit.isActive) continue;
      const pos = unit.pos;
      this.stampDisc(gameView.x(pos), gameView.y(pos), unitStamp);
    }

    // --- Merge with the persistent ever-seen mask ---
    // Currently-visible tiles flip ever-seen to 1; previously-seen tiles
    // not currently visible degrade to 128 ("memory") which the shader
    // renders as a dim grey overlay.
    const everSeen = this.everSeen;
    const n = tileState.length;
    for (let i = 0; i < n; i++) {
      const v = vis[i];
      if (v === 255) {
        everSeen[i] = 1;
      } else if (everSeen[i] === 1) {
        vis[i] = 128;
      }
    }

    return vis;
  }

  private pushBorder(ref: number): void {
    if (this.borderCount === this.borderRefs.length) {
      const grown = new Uint32Array(this.borderRefs.length * 2);
      grown.set(this.borderRefs);
      this.borderRefs = grown;
    }
    this.borderRefs[this.borderCount++] = ref;
  }

  private stampDisc(cx: number, cy: number, stamp: DiscStamp): void {
    const r = stamp.radius;
    const diameter = 2 * r + 1;
    const W = this.mapW;
    const H = this.mapH;
    const bytes = stamp.bytes;
    const vis = this.visibility;

    const y0 = Math.max(0, cy - r);
    const y1 = Math.min(H - 1, cy + r);
    const x0 = Math.max(0, cx - r);
    const x1 = Math.min(W - 1, cx + r);

    for (let y = y0; y <= y1; y++) {
      const stampRow = (y - cy + r) * diameter + (x0 - cx + r);
      const visRow = y * W + x0;
      for (let dx = 0; dx <= x1 - x0; dx++) {
        if (bytes[stampRow + dx]) vis[visRow + dx] = 255;
      }
    }
  }
}
