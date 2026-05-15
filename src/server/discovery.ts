import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface InstanceInfo {
  pid: number;
  port: number;
}

export interface DiscoveryData {
  edit?: InstanceInfo;
  play?: InstanceInfo;
}

const files = {
  edit: { pid: '.ku.edit.pid', port: '.ku.edit.port' },
  play: { pid: '.ku.play.pid', port: '.ku.play.port' },
} as const;

export type InstanceType = 'edit' | 'play';

export function discoveryPath(projectDir: string, instance: InstanceType, kind: 'pid' | 'port'): string {
  return join(projectDir, files[instance][kind]);
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

export async function readDiscovery(projectDir: string): Promise<DiscoveryData> {
  const result: DiscoveryData = {};
  for (const inst of ['edit', 'play'] as InstanceType[]) {
    const pidPath = discoveryPath(projectDir, inst, 'pid');
    const portPath = discoveryPath(projectDir, inst, 'port');
    if (existsSync(pidPath) && existsSync(portPath)) {
      const pid = parseInt(await readFile(pidPath, 'utf-8'), 10);
      const port = parseInt(await readFile(portPath, 'utf-8'), 10);
      result[inst] = { pid, port };
    }
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
