import fs from "fs/promises";
import path from "path";
import { normalizeAssetPath } from "src/core/AssetUrls";
import { GameMapType } from "src/core/game/Game";
import { isRandomMap } from "src/core/game/MapGenerator";
import { fileURLToPath } from "url";
import { logger } from "./Logger";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";

const log = logger.child({ component: "MapLandTiles" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "../../static");
const resourcesDir = path.join(__dirname, "../../resources");

const landTilesCache = new Map<GameMapType, number>();

function mapDirName(map: GameMapType): string {
  const key = (
    Object.keys(GameMapType) as Array<keyof typeof GameMapType>
  ).find((k) => GameMapType[k] === map);
  if (!key) throw new Error(`Unknown map: ${map}`);
  return key.toLowerCase();
}

async function readManifestFile(map: GameMapType): Promise<string> {
  const relativePath = `maps/${mapDirName(map)}/manifest.json`;

  // Production: resolve via the asset manifest to the hashed file under static/_assets/.
  const assetManifest = await getRuntimeAssetManifest();
  const hashedUrl = assetManifest[relativePath];
  if (hashedUrl) {
    return fs.readFile(
      path.join(staticDir, normalizeAssetPath(hashedUrl)),
      "utf8",
    );
  }

  // Dev: read directly from resources/. The Dockerfile deletes resources/maps in
  // production, so this branch only runs locally.
  return fs.readFile(path.join(resourcesDir, relativePath), "utf8");
}

/**
 * Rough land-tile estimates for procedurally-generated maps. Used only by
 * matchmaking heuristics (lobby capacity tuning) — the exact count varies
 * with the seed, but matchmaking can tolerate the approximation. The actual
 * per-game count is computed client-side from the generated manifest.
 *
 * Numbers assume the default Medium size preset (1500×1000 tiles) and
 * style-specific land densities (continental ~25%, mixed ~20%, archipel ~12%).
 */
const RANDOM_MAP_LAND_TILE_ESTIMATES: Partial<Record<GameMapType, number>> = {
  [GameMapType.RandomContinental]: 375_000,
  [GameMapType.RandomMixed]: 300_000,
  [GameMapType.RandomArchipelago]: 180_000,
};

// Gets the number of land tiles for a map.
export async function getMapLandTiles(map: GameMapType): Promise<number> {
  const cached = landTilesCache.get(map);
  if (cached !== undefined) return cached;

  // Procedural maps don't have a manifest on disk — return an estimate
  // sized roughly for the default Medium preset. Matchmaking tolerates a
  // ±50% error here.
  if (isRandomMap(map)) {
    const est = RANDOM_MAP_LAND_TILE_ESTIMATES[map] ?? 300_000;
    landTilesCache.set(map, est);
    return est;
  }

  try {
    const raw = await readManifestFile(map);
    const tiles = (JSON.parse(raw) as { map: { num_land_tiles: number } }).map
      .num_land_tiles;
    landTilesCache.set(map, tiles);
    return tiles;
  } catch (error) {
    log.error(`Failed to load manifest for ${map}: ${error}`, { map });
    return 1_000_000; // Default fallback
  }
}
