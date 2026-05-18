import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Node } from './node.js';
import { SceneTree } from './scene-tree.js';
import type { SceneFile, NodeData } from './types.js';

export async function loadScene(filePath: string): Promise<SceneTree> {
  const content = await readFile(filePath, 'utf-8');
  const data: SceneFile = JSON.parse(content);
  const scenesDir = dirname(filePath);
  const resolved = await resolveInstances(data.root, scenesDir, new Set());
  const root = Node.fromJSON(resolved);
  return new SceneTree(root);
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
  for (const child of nodeData.children) {
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
    children: [...template.children, ...instance.children],
    scripts: [...template.scripts, ...instance.scripts],
    ...(template.js_script || instance.js_script
      ? { js_script: instance.js_script || template.js_script }
      : {}),
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

export function sceneFilePath(scenesDir: string, name: string): string {
  const base = name.endsWith('.json') ? name : `${name}.json`;
  return join(scenesDir, base);
}
