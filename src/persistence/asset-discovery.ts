import { resolve, dirname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { NodeData } from '../engine/types.js';

export interface DiscoveredAssets {
  scenes: string[];
  textures: string[];
  atlases: string[];
  scripts: string[];
  tilesets: string[];
  tilemaps: string[];
  audio: string[];
}

export async function discoverAssets(projectDir: string): Promise<DiscoveredAssets> {
  const assets: DiscoveredAssets = {
    scenes: [],
    textures: [],
    atlases: [],
    scripts: [],
    tilesets: [],
    tilemaps: [],
    audio: [],
  };

  const seen = new Set<string>();

  const add = (list: string[], path: string) => {
    const abs = resolve(projectDir, path);
    if (!seen.has(abs)) {
      seen.add(abs);
      list.push(abs);
    }
  };

  // Read project.json to find entry scene
  const configPath = resolve(projectDir, 'project.json');
  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  const entryScene = config.entry ?? 'main';
  add(assets.scenes, resolve(projectDir, 'scenes', `${entryScene}.json`));

  // Walk scene graph
  const visited = new Set<string>();
  const queue = [...assets.scenes];

  while (queue.length > 0) {
    const scenePath = queue.shift()!;
    if (visited.has(scenePath)) continue;
    visited.add(scenePath);

    try {
      const content = await readFile(scenePath, 'utf-8');
      const data = JSON.parse(content);
      const root = data.root as NodeData;
      collectNodeAssets(root, projectDir, assets, add);

      // Follow instance references
      collectInstances(root, projectDir, add, assets.scenes);
    } catch {
      // skip unreadable scenes
    }
  }

  // Discover atlases referenced by .tileset.json files
  for (const tilesetPath of assets.tilesets) {
    if (!tilesetPath.endsWith('.tileset.json')) continue;
    try {
      const content = await readFile(tilesetPath, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data.tiles)) {
        for (const tile of data.tiles) {
          if (tile && typeof tile.atlas === 'string') {
            add(assets.atlases, tile.atlas);
          }
        }
      }
      if (data.transitions && typeof data.transitions === 'object') {
        for (const trans of Object.values(data.transitions)) {
          const t = trans as Record<string, unknown>;
          if (t && typeof t.atlas === 'string') {
            add(assets.atlases, t.atlas);
          }
        }
      }
    } catch {
      // skip unreadable tileset files
    }
  }

  return assets;
}

function collectNodeAssets(
  node: NodeData,
  projectDir: string,
  assets: DiscoveredAssets,
  add: (list: string[], path: string) => void,
): void {
  const props = node.properties ?? {};

  // Sprite / AnimatedSprite textures
  if (typeof props.texture === 'string' && props.texture) {
    add(assets.textures, props.texture);
  }
  if (Array.isArray(props.frames)) {
    for (const f of props.frames) {
      if (typeof f === 'string' && f) add(assets.textures, f);
    }
  }

  // Atlas
  if (typeof props.atlas === 'string' && props.atlas) {
    add(assets.atlases, props.atlas);
  }

  // TileMap
  if (typeof props.tileset === 'string' && props.tileset) {
    add(assets.tilesets, props.tileset);
  }
  if (typeof props.data === 'string' && props.data && !props.data.startsWith('\n')) {
    // Only add if it looks like a file path, not inline CSV data
    if (!props.data.includes('\n') && (props.data.endsWith('.csv') || props.data.endsWith('.json'))) {
      add(assets.tilemaps, props.data);
    }
  }

  // AudioPlayer
  if (typeof props.stream === 'string' && props.stream) {
    add(assets.audio, props.stream);
  }

  // JS script
  if (typeof (node as any).js_script === 'string' && (node as any).js_script) {
    add(assets.scripts, (node as any).js_script);
  }

  for (const child of node.children ?? []) {
    collectNodeAssets(child, projectDir, assets, add);
  }
}

function collectInstances(
  node: NodeData,
  projectDir: string,
  add: (list: string[], path: string) => void,
  sceneList: string[],
): void {
  if (typeof (node as any).instance === 'string' && (node as any).instance) {
    add(sceneList, resolve(projectDir, 'scenes', (node as any).instance));
  }
  for (const child of node.children ?? []) {
    collectInstances(child, projectDir, add, sceneList);
  }
}
