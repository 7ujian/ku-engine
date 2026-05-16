import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { readDiscovery, isAlive } from '../../server/discovery.js';
import { waitForInstance } from './edit.js';

export async function playCommand(projectDir: string, hotReload = false): Promise<void> {
  const disc = await readDiscovery(projectDir);
  const info = disc.edit;
  if (!info || !isAlive(info.pid)) {
    printJson({ ok: false, error: 'editor instance is not running' });
    return;
  }

  const editorPort = info.port;

  const serverPath = resolve(import.meta.dirname, '../../server/main.js');
  const args = ['--mode', 'play', '--dir', projectDir, '--port', '21201', '--sync-from', String(editorPort)];
  if (hotReload) args.push('--hot-reload');

  const child = fork(serverPath, args, { stdio: 'ignore' });

  await waitForInstance(projectDir, 'play', 3000);
  printJson({ ok: true, data: { spawned: 'play', syncFrom: editorPort, hotReload } });

  // Keep CLI alive — Ctrl-C kills the play child too
  const onSigint = () => {
    child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', onSigint);

  child.on('exit', () => process.exit(0));
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
