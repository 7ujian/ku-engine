import { stat } from 'node:fs/promises';
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

export function invalidateTiledCache(mapPath: string): void {
	cache.delete(resolve(mapPath));
}
