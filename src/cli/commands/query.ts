import { sendCommand, makeMessage } from '../client.js';
import { getAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';

export async function queryScene(projectDir: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('query.scene'));
  printJson(resp.payload);
}

export async function queryNodes(projectDir: string, type?: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('query.nodes', { nodeType: type }));
  printJson(resp.payload);
}

export async function queryDiff(projectDir: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('query.diff'));
  printJson(resp.payload);
}

export async function queryCollisions(projectDir: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('query.collisions'));
  printJson(resp.payload);
}

export async function queryLogs(projectDir: string, clear = false): Promise<void> {
  const port = await getPort(projectDir);
  const action = clear ? 'query.logs_clear' : 'query.logs';
  const resp = await sendCommand('localhost', port, makeMessage(action));
  printJson(resp.payload);
}

export async function queryNode(projectDir: string, path: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('query.node', { path }));
  printJson(resp.payload);
}

export async function queryProfile(projectDir: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('query.profile'));
  printJson(resp.payload);
}

async function getPort(projectDir: string): Promise<number> {
  const inst = await getAttachedInstance(projectDir);
  return findInstancePort(projectDir, inst);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
