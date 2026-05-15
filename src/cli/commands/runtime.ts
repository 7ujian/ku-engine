import { sendCommand, makeMessage } from '../client.js';
import { getAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';

export async function pauseCommand(projectDir: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('runtime.pause'));
  printJson(resp.payload);
}

export async function resumeCommand(projectDir: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('runtime.resume'));
  printJson(resp.payload);
}

export async function stepCommand(projectDir: string): Promise<void> {
  const port = await getPort(projectDir);
  const resp = await sendCommand('localhost', port, makeMessage('runtime.step'));
  printJson(resp.payload);
}

async function getPort(projectDir: string): Promise<number> {
  const inst = await getAttachedInstance(projectDir);
  return findInstancePort(projectDir, inst);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
