/**
 * GeneratedMapLoader — MapData implementation backed by an in-memory
 * generator instead of HTTP fetch.
 *
 * Construction is parameterised by (seed, style, size). Each MapData getter
 * generates lazily on first call and caches the result, mirroring how
 * FetchGameMapLoader caches per-file fetches.
 */

import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";
import {
  buildManifest,
  downsampleMap,
  GeneratedMap,
  generateMap,
  MapSize,
  MapStyle,
} from "./MapGenerator";
import type { MapManifest } from "./TerrainMapLoader";

export interface GeneratedMapSpec {
  seed: string;
  style: MapStyle;
  size: MapSize;
}

export class GeneratedMapLoader implements GameMapLoader {
  /**
   * Cached full-resolution generation. Both `mapBin` and the downsamples
   * derive from it, so we pay the noise pass exactly once per session.
   */
  private cachedMain: GeneratedMap | null = null;
  private cachedMap4x: ReturnType<typeof downsampleMap> | null = null;
  private cachedMap16x: ReturnType<typeof downsampleMap> | null = null;
  private cachedManifest: MapManifest | null = null;

  constructor(private readonly spec: GeneratedMapSpec) {}

  getMapData(_map: GameMapType): MapData {
    // Single map per loader instance — the GameMapType arg is for parity
    // with the interface but we ignore it (the caller already knows it's
    // a generated map by virtue of having instantiated this loader).
    return {
      mapBin: async () => this.main().bin,
      map4xBin: async () => this.map4x().bin,
      map16xBin: async () => this.map16x().bin,
      manifest: async () => this.manifest(),
      webpPath: "",
    };
  }

  private main(): GeneratedMap {
    if (this.cachedMain === null) {
      this.cachedMain = generateMap(this.spec);
    }
    return this.cachedMain;
  }

  private map4x(): ReturnType<typeof downsampleMap> {
    if (this.cachedMap4x === null) {
      const m = this.main();
      // "4x" in the manifest means 4x AREA reduction = factor 2 linearly.
      this.cachedMap4x = downsampleMap(m.bin, m.width, m.height, 2);
    }
    return this.cachedMap4x;
  }

  private map16x(): ReturnType<typeof downsampleMap> {
    if (this.cachedMap16x === null) {
      const m = this.main();
      // "16x" means 16x AREA reduction = factor 4 linearly.
      this.cachedMap16x = downsampleMap(m.bin, m.width, m.height, 4);
    }
    return this.cachedMap16x;
  }

  private manifest(): MapManifest {
    if (this.cachedManifest === null) {
      const name = `Random ${this.spec.style} (${this.spec.seed})`;
      this.cachedManifest = buildManifest(
        name,
        this.main(),
        this.map4x(),
        this.map16x(),
      );
    }
    return this.cachedManifest;
  }
}

/**
 * Wraps a base loader and overrides specific map types to use a generated
 * map. Used at the wiring layer so existing FetchGameMapLoader keeps
 * serving the 50+ pre-baked maps while the new GameMapType.Random* values
 * route through generation.
 */
export class CompositeMapLoader implements GameMapLoader {
  constructor(
    private readonly base: GameMapLoader,
    private readonly overrides: Map<GameMapType, GameMapLoader>,
  ) {}

  getMapData(map: GameMapType): MapData {
    const override = this.overrides.get(map);
    if (override) return override.getMapData(map);
    return this.base.getMapData(map);
  }
}
