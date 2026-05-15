import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readDiscovery, isAlive } from '../../server/discovery.js';
import { waitForInstance } from './edit.js';

export async function playCommand(projectDir: string): Promise<void> {
  const disc = await readDiscovery(projectDir);
  const info = disc.edit;
  if (!info || !isAlive(info.pid)) {
    printJson({ ok: false, error: 'editor instance is not running' });
    return;
  }

  // Read project entry scene
  let scene: string | undefined;
  try {
    const projectJson = JSON.parse(await readFile(resolve(projectDir, 'project.json'), 'utf-8'));
    scene = projectJson.entry?.replace(/^scenes\//, '').replace(/\.json$/, '');
  } catch {
    // no project.json or no entry
  }

  const serverPath = resolve(import.meta.dirname, '../../server/main.js');
  const args = ['--mode', 'play', '--dir', projectDir, '--port', '21201'];
  if (scene) args.push('--scene', scene);

  const child = fork(serverPath, args, { detached: true, stdio: 'ignore' });
  child.unref();

  await waitForInstance(projectDir, 'play', 3000);
  printJson({ ok: true, data: { spawned: 'play' } });
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
