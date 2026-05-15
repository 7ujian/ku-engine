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

async function getPort(projectDir: string): Promise<number> {
  const inst = await getAttachedInstance(projectDir);
  return findInstancePort(projectDir, inst);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
