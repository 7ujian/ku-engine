import { stat } from 'node:fs/promises';
import { statSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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
  const m = JSON.parse(raw);

  const mapDir = dirname(absPath);
  const resolvedTilesets: any[] = [];
  if (Array.isArray(m.tilesets)) {
    for (const tsRef of m.tilesets as any[]) {
      resolvedTilesets.push(resolveTilesetRefSync(tsRef, mapDir));
    }
  }

  // Decode base64 layer data (same as decodeLayerData in tiled-loader.ts)
  const layers = m.layers as any[];
  for (const layer of layers) {
    if (layer.type === 'tilelayer' && typeof layer.data === 'string') {
      if (layer.encoding === 'base64') {
        if (layer.compression) {
          throw new Error(`Tiled layer "${layer.name}": compression not supported in sync loader`);
        }
        const buf = Buffer.from(layer.data, 'base64');
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const result: number[] = [];
        for (let i = 0; i < buf.length; i += 4) {
          result.push(view.getUint32(i, true));
        }
        layer.data = result;
      }
    }
  }

  const data: TiledMapResolved = {
    width: m.width as number,
    height: m.height as number,
    tilewidth: m.tilewidth as number,
    tileheight: m.tileheight as number,
    orientation: (m.orientation as string) ?? 'orthogonal',
    renderorder: (m.renderorder as string) ?? 'right-down',
    infinite: (m.infinite as boolean) ?? false,
    layers,
    tilesets: resolvedTilesets,
    backgroundcolor: m.backgroundcolor as string | undefined,
    properties: m.properties as Record<string, unknown>[] | undefined,
    mapDir,
    mapPath: absPath,
  };

  try {
    const s = statSync(absPath);
    cache.set(absPath, { mtimeMs: s.mtimeMs, data });
  } catch { /* no cache */ }
  return data;
}

function resolveTilesetRefSync(tsRef: any, mapDir: string): any {
  if (tsRef.source) {
    const tsPath = resolve(mapDir, tsRef.source);
    return loadTiledTilesetSync(tsPath, tsRef.firstgid);
  }

  const isCollection = !tsRef.image || tsRef.columns === 0;
  const resolvedImage = (!isCollection && tsRef.image)
    ? (tsRef.image.startsWith('/') ? tsRef.image : resolve(mapDir, tsRef.image))
    : '';
  const resolvedTiles = resolveTileImagesSync(tsRef.tiles, mapDir);

  return {
    firstgid: tsRef.firstgid,
    name: tsRef.name ?? '',
    image: resolvedImage,
    imagewidth: tsRef.imagewidth ?? 0,
    imageheight: tsRef.imageheight ?? 0,
    tilewidth: tsRef.tilewidth!,
    tileheight: tsRef.tileheight!,
    tilecount: tsRef.tilecount!,
    columns: tsRef.columns ?? 0,
    margin: tsRef.margin,
    spacing: tsRef.spacing,
    transparentcolor: tsRef.transparentcolor,
    terrains: tsRef.terrains,
    tiles: resolvedTiles,
    properties: tsRef.properties as any[] | undefined,
    tileoffset: tsRef.tileoffset,
  };
}

function loadTiledTilesetSync(tsPath: string, firstgid: number): any {
  const raw = readFileSync(tsPath, 'utf-8');
  const t = JSON.parse(raw);
  const dir = dirname(tsPath);
  const isCollection = !t.image || (t.columns as number) === 0;
  const image = (!isCollection && t.image)
    ? ((t.image as string).startsWith('/') ? (t.image as string) : resolve(dir, t.image as string))
    : '';
  const resolvedTiles = resolveTileImagesSync(t.tiles, dir);

  return {
    firstgid,
    name: (t.name as string) ?? '',
    image,
    imagewidth: (t.imagewidth as number) ?? 0,
    imageheight: (t.imageheight as number) ?? 0,
    tilewidth: t.tilewidth as number,
    tileheight: t.tileheight as number,
    tilecount: t.tilecount as number,
    columns: (t.columns as number) ?? 0,
    margin: t.margin as number | undefined,
    spacing: t.spacing as number | undefined,
    transparentcolor: t.transparentcolor as string | undefined,
    terrains: t.terrains as any,
    tiles: resolvedTiles,
    properties: t.properties as any[] | undefined,
    tileoffset: t.tileoffset as any,
  };
}

function resolveTileImagesSync(tiles: any[] | undefined, baseDir: string): any[] | undefined {
  if (!tiles) return undefined;
  return tiles.map(tile => {
    if (tile.image) {
      return {
        ...tile,
        image: tile.image.startsWith('/') ? tile.image : resolve(baseDir, tile.image),
      };
    }
    return tile;
  });
}

export function invalidateTiledCache(mapPath: string): void {
  cache.delete(resolve(mapPath));
}
