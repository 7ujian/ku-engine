import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import type {
	TiledMap,
	TiledTilesetRef,
	TiledTilesetFull,
	TiledLayer,
	TiledTileLayer,
	TiledTileDef,
	TiledTerrain,
	TiledProperty,
} from './tiled-types.js';

/** Load and resolve a Tiled JSON map file */
export async function loadTiledMap(mapPath: string): Promise<TiledMapResolved> {
	const absMapPath = resolve(mapPath);
	const raw = await readFile(absMapPath, 'utf-8');
	const map: unknown = JSON.parse(raw);

	if (!map || typeof map !== 'object') {
		throw new Error('Tiled map: expected JSON object');
	}

	const m = map as Record<string, unknown>;
	if (m.type && m.type !== 'map') {
		throw new Error(`Tiled map: expected type "map", got "${m.type}"`);
	}

	const width = validateInt(m, 'width', 'map');
	const height = validateInt(m, 'height', 'map');
	const tilewidth = validateInt(m, 'tilewidth', 'map');
	const tileheight = validateInt(m, 'tileheight', 'map');

	if (!Array.isArray(m.layers)) {
		throw new Error('Tiled map: missing or invalid "layers" array');
	}

	if (!Array.isArray(m.tilesets)) {
		throw new Error('Tiled map: missing or invalid "tilesets" array');
	}

	const mapDir = dirname(absMapPath);

	// Resolve tilesets
	const resolvedTilesets: TiledTilesetFull[] = [];
	for (const tsRef of m.tilesets as TiledTilesetRef[]) {
		const resolved = await resolveTilesetRef(tsRef, mapDir);
		resolvedTilesets.push(resolved);
	}

	// Decode base64 layer data if needed
	const layers = m.layers as TiledLayer[];
	for (const layer of layers) {
		if (layer.type === 'tilelayer' && typeof layer.data === 'string') {
			(layer as TiledTileLayer).data = decodeLayerData(layer);
		}
	}

	return {
		width,
		height,
		tilewidth,
		tileheight,
		orientation: (m.orientation as string) ?? 'orthogonal',
		renderorder: (m.renderorder as string) ?? 'right-down',
		infinite: (m.infinite as boolean) ?? false,
		layers,
		tilesets: resolvedTilesets,
		backgroundcolor: m.backgroundcolor as string | undefined,
		properties: m.properties as Record<string, unknown>[] | undefined,
		mapDir,
		mapPath: absMapPath,
	};
}

export interface TiledMapResolved {
	width: number;
	height: number;
	tilewidth: number;
	tileheight: number;
	orientation: string;
	renderorder: string;
	infinite: boolean;
	layers: TiledLayer[];
	tilesets: TiledTilesetFull[];
	backgroundcolor?: string;
	properties?: Record<string, unknown>[];
	mapDir: string;
	mapPath: string;
}

/** Resolve a tileset reference (external source or embedded) */
async function resolveTilesetRef(tsRef: TiledTilesetRef, mapDir: string): Promise<TiledTilesetFull> {
	if (tsRef.source) {
		// External tileset
		const tsPath = resolve(mapDir, tsRef.source);
		return loadTiledTileset(tsPath, tsRef.firstgid);
	}

	// Embedded tileset — validate required fields
	if (!tsRef.tilewidth) throw new Error('Tiled tileset: missing "tilewidth"');
	if (!tsRef.tileheight) throw new Error('Tiled tileset: missing "tileheight"');
	if (!tsRef.tilecount) throw new Error('Tiled tileset: missing "tilecount"');

	// Spritesheet tileset: single image, columns > 0
	// Image collection tileset: empty image, columns = 0, per-tile images
	const isCollection = !tsRef.image || tsRef.columns === 0;
	const resolvedImage = (!isCollection && tsRef.image)
		? (tsRef.image.startsWith('/') ? tsRef.image : resolve(mapDir, tsRef.image))
		: '';
	const resolvedTiles = resolveTileImages(tsRef.tiles, mapDir);

	return {
		firstgid: tsRef.firstgid,
		name: tsRef.name ?? '',
		image: resolvedImage,
		imagewidth: tsRef.imagewidth ?? 0,
		imageheight: tsRef.imageheight ?? 0,
		tilewidth: tsRef.tilewidth,
		tileheight: tsRef.tileheight,
		tilecount: tsRef.tilecount,
		columns: tsRef.columns ?? 0,
		margin: tsRef.margin,
		spacing: tsRef.spacing,
		transparentcolor: tsRef.transparentcolor,
		terrains: tsRef.terrains,
		tiles: resolvedTiles,
		properties: tsRef.properties as TiledProperty[] | undefined,
		tileoffset: tsRef.tileoffset,
	};
}

/** Load an external Tiled tileset JSON file */
export async function loadTiledTileset(tilesetPath: string, firstgid: number): Promise<TiledTilesetFull> {
	const raw = await readFile(tilesetPath, 'utf-8');
	const ts: unknown = JSON.parse(raw);

	if (!ts || typeof ts !== 'object') {
		throw new Error('Tiled tileset: expected JSON object');
	}

	const t = ts as Record<string, unknown>;
	const tilesetDir = dirname(tilesetPath);

	if (!t.tilewidth) throw new Error('Tiled tileset: missing "tilewidth"');
	if (!t.tileheight) throw new Error('Tiled tileset: missing "tileheight"');
	if (!t.tilecount) throw new Error('Tiled tileset: missing "tilecount"');

	const isCollection = !t.image || (t.columns as number) === 0;
	const image = (!isCollection && t.image)
		? ((t.image as string).startsWith('/')
			? (t.image as string)
			: resolve(tilesetDir, t.image as string))
		: '';
	const resolvedTiles = resolveTileImages(t.tiles as TiledTileDef[] | undefined, tilesetDir);

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
		terrains: t.terrains as TiledTerrain[] | undefined,
		tiles: resolvedTiles,
		properties: t.properties as TiledProperty[] | undefined,
		tileoffset: t.tileoffset as { x: number; y: number } | undefined,
	};
}

/** Build tile ID → TiledTileDef lookup */
/** Resolve per-tile image paths for image collection tilesets */
function resolveTileImages(tiles: TiledTileDef[] | undefined, baseDir: string): TiledTileDef[] | undefined {
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

export function buildTileLookup(tiles: TiledTileDef[] | undefined): Map<number, TiledTileDef> {
	const map = new Map<number, TiledTileDef>();
	if (tiles) {
		for (const tile of tiles) {
			map.set(tile.id, tile);
		}
	}
	return map;
}

/** Find which tileset a GID belongs to */
export function findTilesetForGid(gid: number, tilesets: TiledTilesetFull[]): TiledTilesetFull | null {
	// Search in reverse order (higher firstgid = more specific)
	for (let i = tilesets.length - 1; i >= 0; i--) {
		const ts = tilesets[i];
		if (gid >= ts.firstgid && gid < ts.firstgid + ts.tilecount) {
			return ts;
		}
	}
	return null;
}

/** Compute source rect from GID in a spritesheet tileset */
export function gidToRect(gid: number, tileset: TiledTilesetFull): { x: number; y: number; w: number; h: number } {
	const localId = gid - tileset.firstgid;
	const columns = tileset.columns || 1; // avoid div-by-zero for collection tilesets
	const margin = tileset.margin ?? 0;
	const spacing = tileset.spacing ?? 0;
	const col = localId % columns;
	const row = Math.floor(localId / columns);
	return {
		x: margin + col * (tileset.tilewidth + spacing),
		y: margin + row * (tileset.tileheight + spacing),
		w: tileset.tilewidth,
		h: tileset.tileheight,
	};
}

/** Check if tileset is an image collection (per-tile images) */
export function isCollectionTileset(tileset: TiledTilesetFull): boolean {
	return tileset.columns === 0 || !tileset.image;
}

/** Get per-tile image info for collection tilesets */
export function gidToTileImage(gid: number, tileset: TiledTilesetFull): { image: string; imagewidth: number; imageheight: number } | null {
	const localId = gid - tileset.firstgid;
	const tile = tileset.tiles?.find(t => t.id === localId);
	if (!tile?.image) return null;
	return {
		image: tile.image,
		imagewidth: tile.imagewidth ?? tileset.tilewidth,
		imageheight: tile.imageheight ?? tileset.tileheight,
	};
}

/** Decode base64 layer data (CSV is already parsed as number[]) */
function decodeLayerData(layer: TiledTileLayer): number[] {
	const data = layer.data;
	if (typeof data !== 'string') return data as number[];

	if (layer.encoding === 'base64') {
		// Decode base64 → Uint32Array
		const buf = Buffer.from(data, 'base64');
		const raw = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

		// Handle compression (zlib/gzip/zstd) — for now, only uncompressed
		if (layer.compression) {
			throw new Error(`Tiled layer "${layer.name}": compression "${layer.compression}" not supported yet`);
		}

		const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		const result: number[] = [];
		for (let i = 0; i < raw.length; i += 4) {
			result.push(view.getUint32(i, true)); // little-endian
		}
		return result;
	}

	// CSV string
	return (data as string).split(',').map(s => parseInt(s.trim(), 10));
}

function validateInt(obj: Record<string, unknown>, key: string, context: string): number {
	const val = obj[key];
	if (typeof val !== 'number' || !Number.isInteger(val)) {
		throw new Error(`Tiled ${context}: missing or invalid "${key}"`);
	}
	return val;
}
