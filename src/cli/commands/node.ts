import { sendCommand, makeMessage } from '../client.js';
import { getAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';

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

async function getPort(projectDir: string): Promise<number> {
  const inst = await getAttachedInstance(projectDir);
  return findInstancePort(projectDir, inst);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
