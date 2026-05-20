import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

export interface InstanceInfo {
  pid: number;
  port: number;
}

export type DiscoveryData = Record<string, InstanceInfo>;

export type InstanceType = string;

const PLAY_RE = /^play\d*$/;

export function isPlayInstance(name: string): boolean {
  return PLAY_RE.test(name);
}

export function isEditInstance(name: string): boolean {
  return name === 'edit';
}

export function normalizePlayName(name: string): string {
  return name === 'play' ? 'play1' : name;
}

export function isValidInstanceName(name: string): boolean {
  return name === 'edit' || PLAY_RE.test(name);
}

export function discoveryPath(projectDir: string, instance: InstanceType, kind: 'pid' | 'port'): string {
  return join(projectDir, `.ku.${instance}.${kind}`);
}

export async function writeDiscovery(projectDir: string, instance: InstanceType, pid: number, port: number): Promise<void> {
  await writeFile(discoveryPath(projectDir, instance, 'pid'), String(pid), 'utf-8');
  await writeFile(discoveryPath(projectDir, instance, 'port'), String(port), 'utf-8');
}

export async function cleanDiscovery(projectDir: string, instance: InstanceType): Promise<void> {
  for (const kind of ['pid', 'port'] as const) {
    const p = discoveryPath(projectDir, instance, kind);
    if (existsSync(p)) await unlink(p);
  }
}

const DISCOVERY_RE = /^\.ku\.(edit|play\d+)\.pid$/;

export async function readDiscovery(projectDir: string): Promise<DiscoveryData> {
  const result: DiscoveryData = {};
  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch {
    return result;
  }
  for (const name of entries) {
    const m = name.match(DISCOVERY_RE);
    if (!m) continue;
    const inst = m[1];
    const pidPath = join(projectDir, name);
    const portPath = discoveryPath(projectDir, inst, 'port');
    if (!existsSync(portPath)) continue;
    const pid = parseInt(await readFile(pidPath, 'utf-8'), 10);
    const port = parseInt(await readFile(portPath, 'utf-8'), 10);
    result[inst] = { pid, port };
  }
  return result;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
