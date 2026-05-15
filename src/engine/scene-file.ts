import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Node } from './node.js';
import { SceneTree } from './scene-tree.js';
import type { SceneFile } from './types.js';

export async function loadScene(filePath: string): Promise<SceneTree> {
  const content = await readFile(filePath, 'utf-8');
  const data: SceneFile = JSON.parse(content);
  const root = Node.fromJSON(data.root);
  return new SceneTree(root);
}

export async function saveScene(tree: SceneTree, filePath: string, sceneName?: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const data: SceneFile = {
    scene: sceneName ?? 'untitled',
    root: tree.root.toJSON(),
  };
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function listScenes(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter(e => e.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

export function sceneFilePath(scenesDir: string, name: string): string {
  const base = name.endsWith('.json') ? name : `${name}.json`;
  return join(scenesDir, base);
}
