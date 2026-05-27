import { relative } from 'node:path';
import type { NodeData, PropertyMap, TiledLayerData } from '../engine/types.js';
import type { TiledMapResolved } from './tiled-loader.js';
import { findTilesetForGid, gidToRect, isCollectionTileset } from './tiled-loader.js';
import type {
	TiledTileLayer,
	TiledObjectLayer,
	TiledObject,
	TiledProperty,
	TiledTilesetFull,
} from './tiled-types.js';
import { GID_MASK } from './tiled-types.js';

/** Create a base NodeData with defaults */
function node(id: string, type: string, properties: PropertyMap, children: NodeData[] = []): NodeData {
	return { id, type, properties, children, scripts: [] };
}

/** Import a resolved Tiled map as ku scene NodeData */
export function importTiledMap(
	tiledMap: TiledMapResolved,
	projectDir: string,
): NodeData {
	const children: NodeData[] = [];

	for (const layer of tiledMap.layers) {
		if (layer.type === 'tilelayer') {
			const nodes = importTileLayer(layer as TiledTileLayer, tiledMap.tilesets, tiledMap.mapDir, projectDir);
			children.push(...nodes);
		} else if (layer.type === 'objectgroup') {
			const objNode = importObjectLayer(layer as TiledObjectLayer, tiledMap.tilesets, tiledMap.mapDir, projectDir);
			children.push(objNode);
		}
	}

	return node('root', 'Node2D', { x: 0, y: 0 }, children);
}

/** Import a resolved Tiled map as merged tiled_layers + object children (for dynamic loading) */
export function importTiledMapMerged(
	tiledMap: TiledMapResolved,
	projectDir: string,
): { tiled_layers: TiledLayerData[]; children: NodeData[] } {
	const tiled_layers: TiledLayerData[] = [];
	const children: NodeData[] = [];

	for (const layer of tiledMap.layers) {
		if (layer.type === 'tilelayer') {
			const layerData = buildTiledLayerData(layer as TiledTileLayer, tiledMap.tilesets, projectDir);
			tiled_layers.push(...layerData);
		} else if (layer.type === 'objectgroup') {
			const objNode = importObjectLayer(layer as TiledObjectLayer, tiledMap.tilesets, tiledMap.mapDir, projectDir);
			children.push(...(objNode.children ?? []));
		}
	}

	return { tiled_layers, children };
}

/** Build TiledLayerData entries for a tile layer (one per used tileset) */
function buildTiledLayerData(
	layer: TiledTileLayer,
	tilesets: TiledTilesetFull[],
	projectDir: string,
): TiledLayerData[] {
	const data = layer.data as number[];

	const hasTiles = data.some(g => (g & GID_MASK) !== 0);
	if (!hasTiles) return [];

	const usedTilesets = new Set<TiledTilesetFull>();
	for (let i = 0; i < data.length; i++) {
		const rawGid = data[i];
		if (rawGid === 0) continue;
		const gid = rawGid & GID_MASK;
		if (gid === 0) continue;
		const ts = findTilesetForGid(gid, tilesets);
		if (ts) usedTilesets.add(ts);
	}

	if (usedTilesets.size === 0) return [];

	const results: TiledLayerData[] = [];
	for (const ts of usedTilesets) {
		const filteredData = new Array(data.length).fill(0);
		for (let i = 0; i < data.length; i++) {
			const rawGid = data[i];
			if (rawGid === 0) continue;
			const gid = rawGid & GID_MASK;
			if (gid === 0) continue;
			if (gid >= ts.firstgid && gid < ts.firstgid + ts.tilecount) {
				filteredData[i] = rawGid;
			}
		}

		const relImage = ts.image ? relative(projectDir, ts.image) : '';
		results.push({
			image: relImage,
			columns: ts.columns,
			tilewidth: ts.tilewidth,
			tileheight: ts.tileheight,
			firstgid: ts.firstgid,
			data: filteredData,
			width: layer.width,
			height: layer.height,
			opacity: layer.opacity,
			name: layer.name,
			tile_images: buildTileImages(ts, projectDir),
		});
	}

	return results;
}

/** Build tile_images for a collection tileset */
function buildTileImages(ts: TiledTilesetFull, projectDir: string): Record<number, { image: string; w: number; h: number }> | undefined {
	if (!isCollectionTileset(ts) || !ts.tiles) return undefined;
	const result: Record<number, { image: string; w: number; h: number }> = {};
	for (const tile of ts.tiles) {
		if (tile.image) {
			const relImage = relative(projectDir, tile.image);
			result[tile.id] = {
				image: relImage,
				w: tile.imagewidth ?? ts.tilewidth,
				h: tile.imageheight ?? ts.tileheight,
			};
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

/** Import a tile layer — may produce multiple TileMap nodes if multiple tilesets are used */
function importTileLayer(
	layer: TiledTileLayer,
	tilesets: TiledTilesetFull[],
	_mapDir: string,
	projectDir: string,
): NodeData[] {
	const data = layer.data as number[];

	// Skip empty layers (all zeros)
	const hasTiles = data.some(g => (g & GID_MASK) !== 0);
	if (!hasTiles) return [];

	// Determine which tilesets are used in this layer
	const usedTilesets = new Set<TiledTilesetFull>();
	for (let i = 0; i < data.length; i++) {
		const rawGid = data[i];
		if (rawGid === 0) continue;
		const gid = rawGid & GID_MASK;
		if (gid === 0) continue;
		const ts = findTilesetForGid(gid, tilesets);
		if (ts) usedTilesets.add(ts);
	}

	// Single tileset (common case)
	if (usedTilesets.size <= 1) {
		const ts = usedTilesets.size === 1 ? usedTilesets.values().next().value! : tilesets[0];
		if (!ts) return [];

		const relImage = ts.image ? relative(projectDir, ts.image) : '';
		return [node(sanitizeId(layer.name), 'TileMap', {
			x: layer.offsetx ?? 0,
			y: layer.offsety ?? 0,
			tiled_layers: [{
				image: relImage,
				columns: ts.columns,
				tilewidth: ts.tilewidth,
				tileheight: ts.tileheight,
				firstgid: ts.firstgid,
				data,
				width: layer.width,
				height: layer.height,
				opacity: layer.opacity,
				name: layer.name,
				tile_images: buildTileImages(ts, projectDir),
			}],
		})];
	}

	// Multiple tilesets: split into sibling TileMap nodes
	const nodes: NodeData[] = [];
	for (const ts of usedTilesets) {
		const filteredData = new Array(data.length).fill(0);
		for (let i = 0; i < data.length; i++) {
			const rawGid = data[i];
			if (rawGid === 0) continue;
			const gid = rawGid & GID_MASK;
			if (gid === 0) continue;
			if (gid >= ts.firstgid && gid < ts.firstgid + ts.tilecount) {
				filteredData[i] = rawGid;
			}
		}

		const relImage = ts.image ? relative(projectDir, ts.image) : '';
		nodes.push(node(sanitizeId(`${layer.name}_${ts.name}`), 'TileMap', {
			x: layer.offsetx ?? 0,
			y: layer.offsety ?? 0,
			tiled_layers: [{
				image: relImage,
				columns: ts.columns,
				tilewidth: ts.tilewidth,
				tileheight: ts.tileheight,
				firstgid: ts.firstgid,
				data: filteredData,
				width: layer.width,
				height: layer.height,
				opacity: layer.opacity,
				name: layer.name,
				tile_images: buildTileImages(ts, projectDir),
			}],
		}));
	}

	return nodes;
}

/** Import an object layer as a Node2D container */
function importObjectLayer(
	layer: TiledObjectLayer,
	tilesets: TiledTilesetFull[],
	_mapDir: string,
	projectDir: string,
): NodeData {
	const children: NodeData[] = [];
	for (const obj of layer.objects) {
		children.push(importObject(obj, tilesets, _mapDir, projectDir));
	}

	return node(sanitizeId(layer.name), 'Node2D', {
		x: layer.offsetx ?? 0,
		y: layer.offsety ?? 0,
	}, children);
}

/** Import a single Tiled object as a ku node */
function importObject(
	obj: TiledObject,
	tilesets: TiledTilesetFull[],
	_mapDir: string,
	projectDir: string,
): NodeData {
	const props: PropertyMap = { x: obj.x, y: obj.y };

	if (obj.properties) {
		Object.assign(props, mapProperties(obj.properties));
	}

	// Object with GID → Sprite
	if (obj.gid) {
		const gid = obj.gid & GID_MASK;
		const ts = findTilesetForGid(gid, tilesets);
		if (ts) {
			const rect = gidToRect(gid, ts);
			props.texture = relative(projectDir, ts.image);
			props.texture_rect = `${rect.x},${rect.y},${rect.w},${rect.h}`;
		}
		return node(sanitizeId(obj.name ?? `obj_${obj.id}`), 'Sprite', props);
	}

	// Point object
	if (obj.point) {
		return node(sanitizeId(obj.name ?? `obj_${obj.id}`), 'Node2D', props);
	}

	// Use type field to determine ku node type
	const nodeType = mapObjectType(obj.type);

	if (nodeType === 'CollisionShape') {
		props.shape = 'rect';
	}
	if (obj.width) props.width = obj.width;
	if (obj.height) props.height = obj.height;

	return node(sanitizeId(obj.name ?? `obj_${obj.id}`), nodeType, props);
}

function mapObjectType(type?: string): string {
	if (!type) return 'Node2D';
	const lower = type.toLowerCase();
	if (lower === 'rigidbody') return 'RigidBody';
	if (lower === 'area') return 'Area';
	if (lower === 'collision' || lower === 'wall' || lower === 'collision_shape') return 'CollisionShape';
	if (lower === 'sprite') return 'Sprite';
	if (lower === 'label') return 'Label';
	if (lower === 'camera' || lower === 'camera2d') return 'Camera2D';
	return 'Node2D';
}

function mapProperties(properties: TiledProperty[]): PropertyMap {
	const result: PropertyMap = {};
	for (const prop of properties) {
		if (prop.value !== undefined) {
			result[prop.name] = prop.value as PropertyMap[string];
		}
	}
	return result;
}

function sanitizeId(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'node';
}
