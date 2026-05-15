import { sendCommand, makeMessage } from '../client.js';
import { getAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';

export async function inputKey(projectDir: string, key: string, direction?: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('input.key', {
    key, direction: direction ?? 'down',
  }));
  printJson(resp.payload);
}

export async function inputClick(projectDir: string, x: number, y: number): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('input.click', { x, y }));
  printJson(resp.payload);
}

export async function inputAxis(projectDir: string, name: string, value: number): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('input.axis', { name, value }));
  printJson(resp.payload);
}

async function getPort(projectDir: string): Promise<number> {
  const inst = await getAttachedInstance(projectDir);
  return findInstancePort(projectDir, inst);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
