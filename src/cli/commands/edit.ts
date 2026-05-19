import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { readDiscovery, isAlive, type InstanceType } from '../../server/discovery.js';
import { findInstancePort } from './instances.js';
import { sendCommand, makeMessage } from '../client.js';
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ATTACH_FILE = '.ku.attach';

function getAttachFile(projectDir: string): string {
  return resolve(projectDir, ATTACH_FILE);
}

export async function getAttachedInstance(projectDir: string): Promise<InstanceType> {
  const file = getAttachFile(projectDir);
  if (existsSync(file)) {
    const content = await readFile(file, 'utf-8').catch(() => '');
    if (content === 'edit' || content === 'play') return content;
  }
  return 'edit';
}

export async function setAttachedInstance(projectDir: string, instance: InstanceType): Promise<void> {
  await writeFile(getAttachFile(projectDir), instance, 'utf-8');
}

export async function editCommand(projectDir: string, scene?: string, interactive = false, autosave = false): Promise<void> {
  const disc = await readDiscovery(projectDir);
  const info = disc.edit;

  if (info && isAlive(info.pid)) {
    await setAttachedInstance(projectDir, 'edit');
    if (interactive) {
      await runInteractiveShell(projectDir, scene);
      return;
    }
    printJson({ ok: true, data: { status: 'attached', port: info.port } });
    return;
  }

  const serverPath = resolve(import.meta.dirname, '../../server/main.js');
  const args = ['--mode', 'edit', '--dir', projectDir, '--port', '21200'];
  if (scene) args.push('--scene', scene);
  if (autosave) args.push('--autosave');

  const child = fork(serverPath, args, { stdio: 'ignore' });

  await waitForInstance(projectDir, 'edit', 3000);
  await setAttachedInstance(projectDir, 'edit');

  if (interactive) {
    // Register cleanup: kill child when shell exits
    process.on('exit', () => { try { child.kill('SIGTERM'); } catch {} });
    child.on('exit', () => process.exit(0));
    await runInteractiveShell(projectDir, scene);
    return;
  }

  const disc2 = await readDiscovery(projectDir);
  printJson({ ok: true, data: { status: 'started', pid: disc2.edit!.pid, port: disc2.edit!.port } });

  // Keep CLI alive — Ctrl-C kills the editor child too
  const onSigint = () => {
    child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', onSigint);

  child.on('exit', () => process.exit(0));
}

export async function stopCommand(projectDir: string, instance?: string): Promise<void> {
  const inst = (instance ?? 'play') as InstanceType;
  const disc = await readDiscovery(projectDir);
  const info = disc[inst];
  if (!info || !isAlive(info.pid)) {
    printJson({ ok: false, error: `${inst} instance is not running` });
    return;
  }
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    printJson({ ok: false, error: `failed to stop ${inst} instance` });
    return;
  }
  printJson({ ok: true, data: { stopped: inst } });
}

export async function attachCommand(projectDir: string, instance: InstanceType): Promise<void> {
  await findInstancePort(projectDir, instance);
  await setAttachedInstance(projectDir, instance);
  printJson({ ok: true, data: { attached: instance } });
}

export async function detachCommand(projectDir: string): Promise<void> {
  const file = getAttachFile(projectDir);
  if (existsSync(file)) {
    const { unlink } = await import('node:fs/promises');
    await unlink(file);
  }
  printJson({ ok: true, data: { detached: true } });
}

export async function waitForInstance(projectDir: string, inst: InstanceType, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const disc = await readDiscovery(projectDir);
    const info = disc[inst];
    if (info && isAlive(info.pid)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${inst} instance`);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}

async function runInteractiveShell(projectDir: string, scene?: string): Promise<void> {
  // Remove any prior SIGINT listeners so the shell's double-Ctrl+C logic works
  process.removeAllListeners('SIGINT');
  const { shellCommand } = await import('./shell.js');
  await shellCommand(projectDir, { scene });
}
