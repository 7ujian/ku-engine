import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadTiledMap } from '../src/persistence/tiled-loader.js';
import { importTiledMap, importTiledMapMerged } from '../src/persistence/tiled-importer.js';
import type { NodeData } from '../src/engine/types.js';

const FIXTURES = resolve(__dirname, 'fixtures/tiled');
const PROJECT_DIR = FIXTURES;

function findNode(root: NodeData, id: string): NodeData | null {
	if (root.id === id) return root;
	for (const child of root.children ?? []) {
		const found = findNode(child, id);
		if (found) return found;
	}
	return null;
}

function findNodesByType(root: NodeData, type: string): NodeData[] {
	const result: NodeData[] = [];
	if (root.type === type) result.push(root);
	for (const child of root.children ?? []) {
		result.push(...findNodesByType(child, type));
	}
	return result;
}

describe('importTiledMap', () => {
	it('imports simple map with one tile layer', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'simple-map.json'));
		const root = importTiledMap(map, PROJECT_DIR);

		expect(root.type).toBe('Node2D');
		expect(root.id).toBe('root');
		expect(root.children).toHaveLength(1);

		const tileMap = root.children![0];
		expect(tileMap.type).toBe('TileMap');
		expect(tileMap.id).toBe('ground');

		const layers = tileMap.properties.tiled_layers as any[];
		expect(layers).toHaveLength(1);
		expect(layers[0].width).toBe(4);
		expect(layers[0].height).toBe(3);
		expect(layers[0].firstgid).toBe(1);
		expect(layers[0].columns).toBe(3);
		expect(layers[0].tilewidth).toBe(16);
		expect(layers[0].data).toEqual([1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1]);
		expect(layers[0].image).toMatch(/tiles\.png$/);
	});

	it('imports map with object layer', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'objects-map.json'));
		const root = importTiledMap(map, PROJECT_DIR);

		expect(root.children).toHaveLength(2);

		const tileMap = root.children![0];
		expect(tileMap.type).toBe('TileMap');

		const objectsNode = root.children![1];
		expect(objectsNode.type).toBe('Node2D');
		expect(objectsNode.id).toBe('objects');
		expect(objectsNode.children).toHaveLength(3);

		// Point object → Node2D
		const spawn = objectsNode.children![0];
		expect(spawn.id).toBe('spawn');
		expect(spawn.type).toBe('Node2D');
		expect(spawn.properties.x).toBe(16);
		expect(spawn.properties.y).toBe(32);

		// Wall → CollisionShape
		const wall = objectsNode.children![1];
		expect(wall.id).toBe('wall');
		expect(wall.type).toBe('CollisionShape');
		expect(wall.properties.shape).toBe('rect');
		expect(wall.properties.width).toBe(64);
		expect(wall.properties.height).toBe(16);

		// Object with GID → Sprite
		const chest = objectsNode.children![2];
		expect(chest.id).toBe('chest');
		expect(chest.type).toBe('Sprite');
		expect(chest.properties.texture).toMatch(/tiles\.png$/);
	});

	it('imports multi-tileset map as split TileMap nodes', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'multi-tileset-map.json'));
		const root = importTiledMap(map, PROJECT_DIR);

		const tileMaps = findNodesByType(root, 'TileMap');
		expect(tileMaps).toHaveLength(2);

		// First tileset tiles (GIDs 1-6)
		const first = tileMaps.find(n => (n.properties.tiled_layers as any[])[0].firstgid === 1);
		expect(first).toBeDefined();
		const firstData = (first!.properties.tiled_layers as any[])[0].data;
		expect(firstData[0]).toBe(1);
		expect(firstData[2]).toBe(0); // GID 7 filtered out

		// Second tileset tiles (GIDs 7-8)
		const second = tileMaps.find(n => (n.properties.tiled_layers as any[])[0].firstgid === 7);
		expect(second).toBeDefined();
		const secondData = (second!.properties.tiled_layers as any[])[0].data;
		expect(secondData[2]).toBe(7);
		expect(secondData[3]).toBe(8);
		expect(secondData[0]).toBe(0); // GID 1 filtered out
	});

	it('all imported nodes have required NodeData fields', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'objects-map.json'));
		const root = importTiledMap(map, PROJECT_DIR);

		function validateNode(node: NodeData) {
			expect(node.id).toBeDefined();
			expect(node.type).toBeDefined();
			expect(node.properties).toBeDefined();
			expect(Array.isArray(node.scripts)).toBe(true);
			for (const child of node.children ?? []) {
				validateNode(child);
			}
		}
		validateNode(root);
	});

	it('sanitizes node IDs', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'simple-map.json'));
		const root = importTiledMap(map, PROJECT_DIR);

		// "ground" is already valid
		expect(root.children![0].id).toBe('ground');
	});
});

describe('importTiledMapMerged', () => {
	it('consolidates tile layers into single tiled_layers array', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'multi-tileset-map.json'));
		const merged = importTiledMapMerged(map, PROJECT_DIR);

		expect(merged.tiled_layers).toHaveLength(2);
		expect(merged.children).toHaveLength(0);

		const first = merged.tiled_layers.find(l => l.firstgid === 1);
		expect(first).toBeDefined();
		expect(first!.data[0]).toBe(1);
		expect(first!.data[2]).toBe(0);

		const second = merged.tiled_layers.find(l => l.firstgid === 7);
		expect(second).toBeDefined();
		expect(second!.data[2]).toBe(7);
		expect(second!.data[0]).toBe(0);
	});

	it('produces object children from object layers', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'objects-map.json'));
		const merged = importTiledMapMerged(map, PROJECT_DIR);

		expect(merged.tiled_layers.length).toBeGreaterThanOrEqual(1);
		expect(merged.children.length).toBe(3);
		const spawn = merged.children.find(c => c.id === 'spawn');
		expect(spawn).toBeDefined();
		expect(spawn!.type).toBe('Node2D');
	});

	it('skips empty tile layers', async () => {
		const map = await loadTiledMap(resolve(FIXTURES, 'simple-map.json'));
		const merged = importTiledMapMerged(map, PROJECT_DIR);

		expect(merged.tiled_layers).toHaveLength(1);
		expect(merged.tiled_layers[0].data.filter(d => d !== 0).length).toBeGreaterThan(0);
	});
});
