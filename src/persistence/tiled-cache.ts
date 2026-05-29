import { stat } from 'node:fs/promises';
import { statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTiledMap, type TiledMapResolved } from './tiled-loader.js';

const cache = new Map<string, { mtimeMs: number; data: TiledMapResolved }>();

export async function loadTiledMapCached(mapPath: string): Promise<TiledMapResolved> {
  const absPath = resolve(mapPath);
  try {
    const s = await stat(absPath);
    const cached = cache.get(absPath);
    if (cached && cached.mtimeMs === s.mtimeMs) return cached.data;

    const data = await loadTiledMap(absPath);
    cache.set(absPath, { mtimeMs: s.mtimeMs, data });
    return data;
  } catch {
    return loadTiledMap(absPath);
  }
}

export function loadTiledMapCachedSync(mapPath: string): TiledMapResolved {
  const absPath = resolve(mapPath);
  try {
    const s = statSync(absPath);
    const cached = cache.get(absPath);
    if (cached && cached.mtimeMs === s.mtimeMs) return cached.data;
  } catch { /* load fresh */ }
  const raw = readFileSync(absPath, 'utf-8');
  const tiledMap = JSON.parse(raw);
  tiledMap.mapDir = absPath.substring(0, absPath.lastIndexOf('/'));
  // Resolve external tileset sources
  if (Array.isArray(tiledMap.tilesets)) {
    for (const tsRef of tiledMap.tilesets) {
      if (tsRef.source) {
        const tsPath = resolve(tiledMap.mapDir, tsRef.source);
        const tsRaw = readFileSync(tsPath, 'utf-8');
        Object.assign(tsRef, JSON.parse(tsRaw));
      }
    }
  }
  const data = tiledMap as TiledMapResolved;
  try {
    const s = statSync(absPath);
    cache.set(absPath, { mtimeMs: s.mtimeMs, data });
  } catch { /* no cache */ }
  return data;
}

export function invalidateTiledCache(mapPath: string): void {
  cache.delete(resolve(mapPath));
}
