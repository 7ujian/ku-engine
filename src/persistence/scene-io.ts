import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { Node } from '../engine/node.js';
import { SceneTree } from '../engine/scene-tree.js';
import type { SceneFile, NodeData } from '../engine/types.js';
import { loadTiledMapCached } from './tiled-cache.js';
import { importTiledMapMerged } from './tiled-importer.js';

export async function loadScene(filePath: string, projectDir?: string): Promise<SceneTree> {
  const content = await readFile(filePath, 'utf-8');
  const data: SceneFile = JSON.parse(content);
  const scenesDir = dirname(filePath);
  const resolved = await resolveInstances(data.root, scenesDir, new Set());
  const tiledResolved = await resolveTiledMaps(resolved, projectDir ?? dirname(filePath));
  const root = Node.fromJSON(tiledResolved);
  return new SceneTree(root);
}

export async function loadSceneRoot(filePath: string, projectDir?: string): Promise<NodeData> {
  const content = await readFile(filePath, 'utf-8');
  const data: SceneFile = JSON.parse(content);
  const scenesDir = dirname(filePath);
  const resolved = await resolveInstances(data.root, scenesDir, new Set());
  return resolveTiledMaps(resolved, projectDir ?? dirname(filePath));
}

async function loadSceneFile(filePath: string): Promise<NodeData> {
  const content = await readFile(filePath, 'utf-8');
  const data: SceneFile = JSON.parse(content);
  return data.root;
}

async function resolveInstances(
  nodeData: NodeData,
  scenesDir: string,
  stack: Set<string>,
): Promise<NodeData> {
  if (nodeData.instance) {
    const instancePath = join(scenesDir, nodeData.instance);
    if (stack.has(instancePath)) {
      throw new Error(`circular instance reference: ${nodeData.instance}`);
    }
    stack.add(instancePath);

    // Load template and resolve its own instances recursively
    const template = await loadSceneFile(instancePath);
    const resolvedTemplate = await resolveInstances(template, scenesDir, stack);

    stack.delete(instancePath);

    // Merge: instance overrides template
    return mergeNodeData(resolvedTemplate, nodeData);
  }

  // Recurse into children
  const resolvedChildren: NodeData[] = [];
  for (const child of nodeData.children ?? []) {
    resolvedChildren.push(await resolveInstances(child, scenesDir, stack));
  }

  return { ...nodeData, children: resolvedChildren };
}

function mergeNodeData(template: NodeData, instance: NodeData): NodeData {
  // Instance id/type take precedence
  // Properties: shallow merge, instance wins
  // Children: concatenate (template first, then instance)
  // Scripts: concatenate (template first, then instance)
  // js_script: instance wins if set
  return {
    id: instance.id,
    type: instance.type,
    properties: { ...template.properties, ...instance.properties },
    children: [...(template.children ?? []), ...(instance.children ?? [])],
    scripts: [...template.scripts, ...instance.scripts],
    ...(template.js_script || instance.js_script
      ? { js_script: instance.js_script || template.js_script }
      : {}),
  };
}

async function resolveTiledMaps(nodeData: NodeData, projectDir: string): Promise<NodeData> {
  const children = await Promise.all(
    (nodeData.children ?? []).map(c => resolveTiledMaps(c, projectDir)),
  );

  const mapRef = (nodeData.properties?.tiled_map as string) ?? '';
  if (!mapRef) return { ...nodeData, children };

  const absPath = resolve(projectDir, mapRef);
  const tiledMap = await loadTiledMapCached(absPath);
  const merged = importTiledMapMerged(tiledMap, projectDir);

  const newProps = { ...nodeData.properties, tiled_layers: merged.tiled_layers };
  delete (newProps as Record<string, unknown>).tiled_map;

  return {
    ...nodeData,
    properties: newProps,
    children: [...merged.children, ...children],
  };
}

export async function saveScene(tree: SceneTree, filePath: string, sceneName?: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const data: SceneFile = {
    scene: sceneName ?? 'untitled',
    root: tree.root.toJSON(),
  };
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function saveSceneSync(tree: SceneTree, filePath: string, sceneName?: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const data: SceneFile = {
    scene: sceneName ?? 'untitled',
    root: tree.root.toJSON(),
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function listScenes(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter(e => e.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

export interface SceneInfo {
  name: string;
  type: string;
}

export async function listSceneInfos(dir: string): Promise<SceneInfo[]> {
  const names = await listScenes(dir);
  const infos: SceneInfo[] = [];
  for (const name of names) {
    let type = '?';
    try {
      const raw = readFileSync(join(dir, name), 'utf-8');
      const data = JSON.parse(raw);
      type = data?.root?.type ?? '?';
    } catch { /* keep '?' */ }
    infos.push({ name, type });
  }
  return infos;
}

export function sceneFilePath(scenesDir: string, name: string): string {
  const base = name.endsWith('.json') ? name : `${name}.json`;
  return join(scenesDir, base);
}
