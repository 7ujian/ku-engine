import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sendCommand, makeMessage } from '../client.js';
import { getAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';
import { sceneFilePath } from '../../persistence/scene-io.js';

export async function nodeAdd(projectDir: string, path: string, type: string, nodeId: string, propsJson?: string): Promise<void> {
  const port = await getPort(projectDir);
  const properties = propsJson ? JSON.parse(propsJson) : undefined;
  const resp = await sendCommand('localhost', port, makeMessage('node.add', {
    path, nodeType: type, nodeId, properties,
  }));
  printJson(resp.payload);
}

export async function nodeRm(projectDir: string, path: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('node.rm', { path }));
  printJson(resp.payload);
}

export async function nodeSet(projectDir: string, pathAndProp: string, valueJson: string): Promise<void> {
  const port = await getPort(projectDir);
  const dotIndex = pathAndProp.indexOf('.');
  if (dotIndex === -1) {
    printJson({ ok: false, error: 'expected format: path.property' });
    return;
  }
  const path = pathAndProp.slice(0, dotIndex);
  const property = pathAndProp.slice(dotIndex + 1);
  const value = JSON.parse(valueJson);
  const resp = await sendCommand('localhost', port, makeMessage('node.set', { path, property, value }));
  printJson(resp.payload);
}

export async function nodeGet(projectDir: string, pathAndProp?: string): Promise<void> {
  const port = await getPort(projectDir);
  if (!pathAndProp) {
    printJson({ ok: false, error: 'expected: path or path.property' });
    return;
  }
  const dotIndex = pathAndProp.indexOf('.');
  let path: string;
  let property: string | undefined;
  if (dotIndex === -1) {
    path = pathAndProp;
    property = undefined;
  } else {
    path = pathAndProp.slice(0, dotIndex);
    property = pathAndProp.slice(dotIndex + 1);
  }
  const resp = await sendCommand('localhost', port, makeMessage('node.get', { path, property }));
  printJson(resp.payload);
}

export async function nodeList(projectDir: string, path: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('node.list', { path }));
  printJson(resp.payload);
}

export async function nodeMove(projectDir: string, path: string, newParent: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('node.move', { path, newParent }));
  printJson(resp.payload);
}

export async function nodeNew(projectDir: string, type: string, path?: string, id?: string): Promise<void> {
  const port = await getPort(projectDir);
  const parentPath = path || '/';
  const nodeId = id || `${type}_1`;
  const resp = await sendCommand('localhost', port, makeMessage('node.add', {
    path: parentPath, nodeType: type, nodeId,
  }));
  printJson(resp.payload);
}

export async function nodeInstance(projectDir: string, scenePath: string, parentPath?: string, id?: string): Promise<void> {
  const port = await getPort(projectDir);
  const nodeId = id ?? scenePath.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
  const path = parentPath || '/';
  let nodeType = 'Node';
  try {
    const p = sceneFilePath(resolve(projectDir, 'scenes'), scenePath);
    const raw = readFileSync(p, 'utf-8');
    const sceneData = JSON.parse(raw);
    if (sceneData?.root?.type) nodeType = sceneData.root.type;
  } catch { /* use default Node type */ }
  const resp = await sendCommand('localhost', port, makeMessage('node.add', {
    path, nodeType, nodeId, properties: { instance: scenePath },
  }));
  printJson(resp.payload);
}

export async function nodeDuplicate(projectDir: string, path: string, parent?: string, newId?: string): Promise<void> {
  const port = await getPort(projectDir);
  const srcResp = await sendCommand('localhost', port, makeMessage('node.get', { path }));
  const srcData = srcResp.payload as { data?: { id: string } } | undefined;
  const srcName = srcData?.data?.id ?? path.split('/').filter(Boolean).pop() ?? 'node';
  const id = newId || `${srcName}_copy`;
  const resp = await sendCommand('localhost', port, makeMessage('node.duplicate', { path, newId: id }));
  printJson(resp.payload);
  if (parent) {
    // Move to new parent
    const moveResp = await sendCommand('localhost', port, makeMessage('node.move', { path: `${parent === '/' ? '' : parent}/${id}`, newParent: parent }));
    printJson(moveResp.payload);
  }
}

export async function nodeSave(projectDir: string, path: string, sceneName?: string): Promise<void> {
  const port = await getPort(projectDir);
  const name = sceneName ?? path.split('/').filter(Boolean).pop() ?? 'untitled';
  const resp = await sendCommand('localhost', port, makeMessage('node.save', { path, sceneName: name, projectDir }));
  printJson(resp.payload);
}

async function getPort(projectDir: string): Promise<number> {
  const inst = await getAttachedInstance(projectDir);
  return findInstancePort(projectDir, inst);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
