import { resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import { sendCommand, makeMessage } from '../client.js';
import { getAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';
import { saveScene, loadScene, listSceneInfos, sceneFilePath } from '../../persistence/scene-io.js';
import { SceneTree } from '../../engine/scene-tree.js';
import { Node } from '../../engine/node.js';
import type { NodeData } from '../../engine/types.js';

export async function sceneCreate(projectDir: string, name: string): Promise<void> {
  const scenesDir = resolve(projectDir, 'scenes');
  const tree = new SceneTree(new Node(name, 'Node'));
  await saveScene(tree, sceneFilePath(scenesDir, name), name);
  printJson({ ok: true, data: { created: name } });
}

export async function sceneList(projectDir: string): Promise<void> {
  const scenes = await listSceneInfos(resolve(projectDir, 'scenes'));
  printJson({ ok: true, data: scenes });
}

export async function sceneRm(projectDir: string, name: string): Promise<void> {
  const path = sceneFilePath(resolve(projectDir, 'scenes'), name);
  await unlink(path);
  printJson({ ok: true, data: { removed: name } });
}

export async function sceneLoad(projectDir: string, name: string): Promise<void> {
  const port = await findInstancePort(projectDir, 'edit');
  const path = sceneFilePath(resolve(projectDir, 'scenes'), name);
  const tree = await loadScene(path);
  const resp = await sendCommand('localhost', port, makeMessage('scene.load', { sceneData: tree.root.toJSON() }));
  printJson(resp.payload);
}

export async function sceneTree(projectDir: string): Promise<void> {
  const inst = await getAttachedInstance(projectDir);
  const port = await findInstancePort(projectDir, inst);
  const resp = await sendCommand('localhost', port, makeMessage('scene.tree'));
  printJson(resp.payload);
}

export async function sceneSave(projectDir: string, name?: string): Promise<void> {
  const port = await findInstancePort(projectDir, 'edit');
  const resp = await sendCommand('localhost', port, makeMessage('scene.tree'));
  if (!resp.payload.ok) { printJson(resp.payload); return; }

  const sceneName = name ?? 'untitled';
  const root = Node.fromJSON(resp.payload.data as NodeData);
  const tree = new SceneTree(root);
  await saveScene(tree, sceneFilePath(resolve(projectDir, 'scenes'), sceneName), sceneName);
  printJson({ ok: true, data: { saved: sceneName } });
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
