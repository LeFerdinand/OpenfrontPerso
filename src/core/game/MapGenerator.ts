/**
 * MapGenerator — deterministic procedural map generation from a seed.
 *
 * Produces the same byte layout as the pre-baked `map.bin` files:
 *   bit 7 (0x80) = IS_LAND
 *   bit 6 (0x40) = SHORELINE  (land tile adjacent to water)
 *   bit 5 (0x20) = OCEAN      (water reachable from the map border)
 *   bits 0-4     = magnitude  (0-31, elevation for land / shore distance for water)
 *
 * Same seed + same style + same size → bit-identical Uint8Array on every
 * client and on the server. This is the multiplayer-safety guarantee for
 * runtime-generated maps: only the seed travels on the wire.
 *
 * Styles supported (Palier 1): "continental" only. archipelago + mixed land
 * in subsequent paliers once the visual baseline is validated.
 */

import seedrandom from "seedrandom";
import { GameMapType, RandomMapSize } from "./Game";

export type MapStyle = "continental" | "archipelago" | "mixed";
export type MapSize = "small" | "medium" | "large";

/** True iff `map` is one of the GameMapType.Random* enum values. */
export function isRandomMap(map: GameMapType): boolean {
  return (
    map === GameMapType.RandomContinental ||
    map === GameMapType.RandomArchipelago ||
    map === GameMapType.RandomMixed
  );
}

/** Map a Random* GameMapType to the corresponding generator style, or null. */
export function randomMapStyle(map: GameMapType): MapStyle | null {
  switch (map) {
    case GameMapType.RandomContinental:
      return "continental";
    case GameMapType.RandomArchipelago:
      return "archipelago";
    case GameMapType.RandomMixed:
      return "mixed";
    default:
      return null;
  }
}

/** Convert the GameConfig randomMapSize enum to the generator's lowercase form. */
export function randomMapSize(size: RandomMapSize | undefined): MapSize {
  switch (size) {
    case RandomMapSize.Small:
      return "small";
    case RandomMapSize.Large:
      return "large";
    case RandomMapSize.Medium:
    default:
      return "medium";
  }
}

export interface GeneratedMap {
  /** Raw `map.bin`-compatible bytes, length = width * height. */
  bin: Uint8Array;
  width: number;
  height: number;
  numLandTiles: number;
  /** Suggested nation spawn coordinates in (x, y) tiles. */
  nations: Array<{ x: number; y: number }>;
}

const SIZE_PRESETS: Record<MapSize, { width: number; height: number }> = {
  small: { width: 800, height: 600 },
  medium: { width: 1500, height: 1000 },
  large: { width: 2400, height: 1600 },
};

// Bit constants — must match GameMapImpl.
const IS_LAND_BIT = 0x80;
const SHORELINE_BIT = 0x40;
const OCEAN_BIT = 0x20;
const MAGNITUDE_MASK = 0x1f;

/** Per-style tuning knobs. Higher land threshold → more water. */
interface StyleParams {
  /** fBm output above this is considered land, below is water. */
  landThreshold: number;
  /** Number of octaves for the fBm — more octaves = more detail. */
  octaves: number;
  /** Base feature size in tiles — smaller = noisier (more islands). */
  featureSize: number;
  /** Edge falloff strength — 1.0 = ensures full ocean border. */
  edgeFalloff: number;
  /**
   * Weighted distribution over the number of continent "centers" the
   * generator will scatter across the map. Each center is a radial bias
   * pushing the noise above the land threshold. Determines whether a seed
   * gives one monolithic landmass or several distinct continents.
   */
  centerCounts: Array<{ n: number; weight: number }>;
  /**
   * Per-center continent radius as a fraction of the smaller map dimension.
   * Wider → softer/bigger landmasses; tighter → crispier separation.
   */
  centerRadius: number;
  /** Strength of the continent-center bias added to the noise (0..1). */
  centerStrength: number;
  /**
   * Power applied to normalised land elevation before bucketing into 0-31.
   * >1 biases toward plains (mag 0-9), <1 toward mountains. The in-game
   * palette renders mag<10 as grass, 10-19 as tan/highland, 20+ as
   * grey/snow mountain.
   */
  landElevationPower: number;
}

const STYLE_PARAMS: Record<MapStyle, StyleParams> = {
  // 2-3 distinct continents most of the time (only ~15% chance of a single
  // monolithic landmass), with mostly plains, occasional highlands and rare
  // mountain peaks. River network carved from the highlands.
  continental: {
    landThreshold: 0.5,
    octaves: 5,
    featureSize: 110,
    edgeFalloff: 0.4,
    centerCounts: [
      { n: 1, weight: 0.15 },
      { n: 2, weight: 0.55 },
      { n: 3, weight: 0.3 },
    ],
    centerRadius: 0.32,
    centerStrength: 0.45,
    landElevationPower: 2.5,
  },
  // Distinct clusters of small islands separated by open sea. Many cluster
  // centers with very small radius + high threshold mean each cluster has
  // a handful of fragmented islands and there's clear ocean between clusters.
  archipelago: {
    landThreshold: 0.62,
    octaves: 6,
    featureSize: 35,
    edgeFalloff: 0.2,
    centerCounts: [
      { n: 5, weight: 0.3 },
      { n: 7, weight: 0.4 },
      { n: 9, weight: 0.3 },
    ],
    centerRadius: 0.12,
    centerStrength: 0.22,
    landElevationPower: 1.8,
  },
  // (Renamed: this used to be the archipelago config — keeping it as the
  // "mixed" style on the user's request.) Many islands of varied sizes
  // produced by pure noise variance, no continent centers.
  mixed: {
    landThreshold: 0.56,
    octaves: 6,
    featureSize: 55,
    edgeFalloff: 0.2,
    centerCounts: [{ n: 0, weight: 1 }],
    centerRadius: 0.1,
    centerStrength: 0,
    landElevationPower: 1.8,
  },
};

export function generateMap(opts: {
  seed: string;
  style: MapStyle;
  size: MapSize;
}): GeneratedMap {
  const { width, height } = SIZE_PRESETS[opts.size];
  const params = STYLE_PARAMS[opts.style];
  const rng = seedrandom(opts.seed);
  const noise = new ValueNoise2D(rng);
  // Second noise channel used purely to add elevation variety inside
  // already-land tiles. Independent permutation so it doesn't correlate
  // with the land-mask noise.
  const elevNoise = new ValueNoise2D(rng);

  // 0) Pick continent centers — radial biases that pull noise above the
  //    land threshold. Determines whether the seed produces a single
  //    monolithic landmass or several distinct continents.
  const numCenters = pickWeighted(params.centerCounts, rng);
  const radiusPx = Math.min(width, height) * params.centerRadius;
  const centers = pickWellSpaced(
    width,
    height,
    numCenters,
    rng,
    radiusPx * 0.9, // min separation a hair under one continent radius
  );

  // 1) Heightmap via fBm + edge falloff + continent-center bias.
  const heightmap = new Float32Array(width * height);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let h = fbm(noise, x, y, params.featureSize, params.octaves);
      h -= edgeFalloff(x, y, width, height, params.edgeFalloff);
      h += continentBias(x, y, centers, radiusPx) * params.centerStrength;
      heightmap[y * width + x] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  // 2) Normalize heightmap to [0, 1] so the threshold stays comparable
  //    across seeds.
  const range = Math.max(1e-6, maxH - minH);
  const normalized = new Float32Array(heightmap.length);
  for (let i = 0; i < heightmap.length; i++) {
    normalized[i] = (heightmap[i] - minH) / range;
  }

  // 3) Land mask via threshold.
  const isLand = new Uint8Array(width * height);
  let landCount = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] > params.landThreshold) {
      isLand[i] = 1;
      landCount++;
    }
  }

  // 4) Distance to shore for water tiles (used as magnitude). BFS from
  //    every shoreline water tile outward.
  const distToShore = bfsDistance(isLand, width, height, /* targetVal */ 0);

  // 5) Ocean mask: water tiles reachable from the map border via 4-conn
  //    flood fill. Lakes (water surrounded by land) stay un-flagged.
  const isOcean = oceanMask(isLand, width, height);

  // 6) Assemble the byte array.
  //
  // Land magnitude rules:
  //   - Re-normalise the land elevation so the lowest land tile maps to 0
  //     (instead of inheriting the global ~landThreshold offset → mag 17+).
  //   - Apply landElevationPower so most tiles fall in the 0-9 (plains)
  //     range, with sparser highlands and rare mountains.
  //   - Blend in a small independent noise channel so plains don't all sit
  //     at exactly the same magnitude.
  const bin = new Uint8Array(width * height);
  const denom = Math.max(1e-6, 1 - params.landThreshold);
  const featureSize2 = Math.max(40, params.featureSize * 0.6);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const land = isLand[i] === 1;
      let byte = 0;
      if (land) {
        const landNorm = (normalized[i] - params.landThreshold) / denom;
        const shaped = Math.pow(Math.max(0, landNorm), params.landElevationPower);
        // Add ±0.08 of independent low-freq noise so plains have texture.
        const jitter =
          (fbm(elevNoise, x, y, featureSize2, 3) - 0.5) * 0.16;
        const elev = clamp01(shaped + jitter);
        const mag = Math.min(31, Math.floor(elev * 32));
        byte = IS_LAND_BIT | (mag & MAGNITUDE_MASK);
        if (hasWaterNeighbor(isLand, x, y, width, height)) {
          byte |= SHORELINE_BIT;
        }
      } else {
        // Water magnitude: distance to nearest shore, capped at 31.
        const d = Math.min(31, distToShore[i]);
        byte = d & MAGNITUDE_MASK;
        if (isOcean[i] === 1) byte |= OCEAN_BIT;
      }
      bin[i] = byte;
    }
  }

  // 7) Pick nation spawn coordinates — random land tiles with a minimum
  //    pairwise distance so they don't clump.
  const nations = pickNationSpawns(isLand, width, height, rng);

  return { bin, width, height, numLandTiles: landCount, nations };
}

// ── Value noise (lightweight, no external dep) ─────────────────────────

class ValueNoise2D {
  private readonly perm: Uint8Array;

  constructor(rng: () => number) {
    // Fisher–Yates shuffle of 0..255 using the seeded RNG.
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    // Double the permutation table to avoid modulo at lookup time.
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private hash(xi: number, yi: number): number {
    // Both axes folded through the perm table. Output in [0, 1).
    const a = this.perm[(xi & 255) + 0];
    return this.perm[(a + yi) & 255] / 256;
  }

  sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const aa = this.hash(xi, yi);
    const ba = this.hash(xi + 1, yi);
    const ab = this.hash(xi, yi + 1);
    const bb = this.hash(xi + 1, yi + 1);
    const u = smoothstep(xf);
    const v = smoothstep(yf);
    return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Fractional Brownian motion — sum of N octaves of noise at increasing freq. */
function fbm(
  noise: ValueNoise2D,
  x: number,
  y: number,
  featureSize: number,
  octaves: number,
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1 / featureSize;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise.sample(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Soft radial falloff toward the map border so the perimeter is reliably
 * sea. Returns a value in [0, strength] subtracted from the heightmap.
 */
function edgeFalloff(
  x: number,
  y: number,
  w: number,
  h: number,
  strength: number,
): number {
  const nx = (x / w) * 2 - 1; // -1 .. +1
  const ny = (y / h) * 2 - 1;
  const d = Math.min(1, Math.sqrt(nx * nx + ny * ny));
  // Steeper falloff at the very edge, gentle in the middle.
  return Math.pow(d, 3) * strength;
}

// ── Topology helpers ───────────────────────────────────────────────────

/** 4-connected BFS distance from every cell of value === targetVal to the
 *  nearest cell of the opposite value, capped at 31. */
function bfsDistance(
  mask: Uint8Array,
  w: number,
  h: number,
  targetVal: 0 | 1,
): Uint8Array {
  const dist = new Uint8Array(w * h).fill(255);
  const queue: number[] = [];
  // Seed: every cell of the OPPOSITE value sits at distance 0 from itself
  // (we want the distance for `targetVal` cells, so cells of value
  // 1 - targetVal are the "boundary").
  const seedVal = (1 - targetVal) as 0 | 1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === seedVal) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const d = dist[idx];
    if (d >= 31) continue;
    const x = idx % w;
    const y = (idx - x) / w;
    const nd = d + 1;
    if (x > 0) tryQueue(idx - 1, nd, dist, queue);
    if (x < w - 1) tryQueue(idx + 1, nd, dist, queue);
    if (y > 0) tryQueue(idx - w, nd, dist, queue);
    if (y < h - 1) tryQueue(idx + w, nd, dist, queue);
  }
  return dist;
}

function tryQueue(idx: number, nd: number, dist: Uint8Array, queue: number[]) {
  if (dist[idx] > nd) {
    dist[idx] = nd;
    queue.push(idx);
  }
}

/** True if any 4-neighbour of (x, y) is water (isLand mask). */
function hasWaterNeighbor(
  isLand: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  if (x > 0 && isLand[y * w + x - 1] === 0) return true;
  if (x < w - 1 && isLand[y * w + x + 1] === 0) return true;
  if (y > 0 && isLand[(y - 1) * w + x] === 0) return true;
  if (y < h - 1 && isLand[(y + 1) * w + x] === 0) return true;
  return false;
}

/** Flood fill from the map border through water tiles → those are the ocean.
 *  Water tiles unreachable from the border are lakes. */
function oceanMask(isLand: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  const enqueue = (i: number) => {
    if (isLand[i] === 0 && out[i] === 0) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    enqueue(x);
    enqueue((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    enqueue(y * w);
    enqueue(y * w + w - 1);
  }
  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) enqueue(idx - 1);
    if (x < w - 1) enqueue(idx + 1);
    if (y > 0) enqueue(idx - w);
    if (y < h - 1) enqueue(idx + w);
  }
  return out;
}

/** Pick up to N nation spawns from the land mask, enforcing a minimum
 *  pairwise distance. Falls back to fewer if the land is too sparse. */
function pickNationSpawns(
  isLand: Uint8Array,
  w: number,
  h: number,
  rng: () => number,
  target = 8,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const minDist = Math.min(w, h) * 0.25;
  const minD2 = minDist * minDist;
  const maxAttempts = target * 200;
  for (let a = 0; a < maxAttempts && out.length < target; a++) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    if (isLand[y * w + x] !== 1) continue;
    let ok = true;
    for (const n of out) {
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy < minD2) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ x, y });
  }
  return out;
}

// ── Continent-center helpers ───────────────────────────────────────────

/**
 * Picks one number from a weighted distribution using the seeded RNG.
 * Weights don't need to sum to 1 — they're normalised internally.
 */
function pickWeighted(
  entries: Array<{ n: number; weight: number }>,
  rng: () => number,
): number {
  let total = 0;
  for (const e of entries) total += e.weight;
  let r = rng() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.n;
  }
  return entries[entries.length - 1].n;
}

/**
 * Scatters `count` random points across the map keeping a minimum pairwise
 * distance. Falls back to fewer points if the constraint can't be met,
 * which lets the caller request 3 centers on a small map without crashing.
 */
function pickWellSpaced(
  w: number,
  h: number,
  count: number,
  rng: () => number,
  minDist: number,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const minD2 = minDist * minDist;
  const maxAttempts = count * 100;
  // Keep centers off the very edge so the continent isn't half cut off.
  const margin = Math.min(w, h) * 0.18;
  for (let a = 0; a < maxAttempts && out.length < count; a++) {
    const x = margin + rng() * (w - 2 * margin);
    const y = margin + rng() * (h - 2 * margin);
    let ok = true;
    for (const p of out) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < minD2) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ x, y });
  }
  return out;
}

/**
 * Returns the max of all (1 - dist/radius) contributions from each center,
 * clipped to [0, 1]. Smooth quadratic falloff for a more natural blend.
 */
function continentBias(
  x: number,
  y: number,
  centers: Array<{ x: number; y: number }>,
  radius: number,
): number {
  let best = 0;
  for (const c of centers) {
    const dx = c.x - x;
    const dy = c.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= radius) continue;
    const t = 1 - d / radius;
    const smooth = t * t * (3 - 2 * t);
    if (smooth > best) best = smooth;
  }
  return best;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


// ── Public utilities (used by preview / loader) ────────────────────────

export function sizePreset(size: MapSize): { width: number; height: number } {
  return { ...SIZE_PRESETS[size] };
}

/**
 * Downsample a generated map.bin to lower resolution (factor 4 → map4x,
 * factor 16 → map16x). Used by the loader to populate the minimap textures
 * without regenerating noise at a different scale (which would lose visual
 * consistency with the main map).
 *
 * For each block of `factor * factor` source tiles we compute:
 *   - isLand by majority vote
 *   - magnitude as the floored average
 *   - shoreline if any source land tile in the block was shore
 *   - ocean if the resulting tile is water AND any source water tile was ocean
 */
export function downsampleMap(
  bin: Uint8Array,
  srcW: number,
  srcH: number,
  factor: number,
): { bin: Uint8Array; width: number; height: number; numLandTiles: number } {
  const w = Math.max(1, Math.floor(srcW / factor));
  const h = Math.max(1, Math.floor(srcH / factor));
  const out = new Uint8Array(w * h);
  let landCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let landTiles = 0;
      let waterTiles = 0;
      let magSum = 0;
      let magCount = 0;
      let anyShore = false;
      let anyOcean = false;

      const x0 = x * factor;
      const y0 = y * factor;
      const x1 = Math.min(srcW, x0 + factor);
      const y1 = Math.min(srcH, y0 + factor);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const b = bin[yy * srcW + xx];
          const isLand = (b & 0x80) !== 0;
          const mag = b & 0x1f;
          if (isLand) {
            landTiles++;
            if ((b & 0x40) !== 0) anyShore = true;
          } else {
            waterTiles++;
            if ((b & 0x20) !== 0) anyOcean = true;
          }
          magSum += mag;
          magCount++;
        }
      }

      const isLandOut = landTiles >= waterTiles;
      const avgMag = magCount > 0 ? Math.floor(magSum / magCount) : 0;
      let byte = avgMag & 0x1f;
      if (isLandOut) {
        byte |= 0x80;
        if (anyShore) byte |= 0x40;
        landCount++;
      } else {
        if (anyOcean) byte |= 0x20;
      }
      out[y * w + x] = byte;
    }
  }

  return { bin: out, width: w, height: h, numLandTiles: landCount };
}

/**
 * Build the same `MapManifest` shape the on-disk maps use. The fields it
 * fills are what TerrainMapLoader.loadTerrainMap reads — name, the three
 * size descriptors, and the nation spawn list.
 */
export function buildManifest(
  name: string,
  main: GeneratedMap,
  map4x: { width: number; height: number; numLandTiles: number },
  map16x: { width: number; height: number; numLandTiles: number },
): import("./TerrainMapLoader").MapManifest {
  return {
    name,
    map: {
      width: main.width,
      height: main.height,
      num_land_tiles: main.numLandTiles,
    },
    map4x: {
      width: map4x.width,
      height: map4x.height,
      num_land_tiles: map4x.numLandTiles,
    },
    map16x: {
      width: map16x.width,
      height: map16x.height,
      num_land_tiles: map16x.numLandTiles,
    },
    nations: main.nations.map((n, i) => ({
      coordinates: [n.x, n.y] as [number, number],
      name: `Nation ${i + 1}`,
    })),
  };
}
