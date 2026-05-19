import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readDiscovery, isAlive } from '../../server/discovery.js';
import { waitForInstance, setAttachedInstance } from './edit.js';
import { buildCommand } from './build.js';

export async function playCommand(projectDir: string, interactive = false): Promise<void> {
  // Ensure editor is running; auto-start if needed
  let disc = await readDiscovery(projectDir);
  if (!disc.edit || !isAlive(disc.edit.pid)) {
    // Launch editor
    const serverPath = resolve(import.meta.dirname, '../../server/main.js');
    const editArgs = ['--mode', 'edit', '--dir', projectDir, '--port', '21200'];
    const editChild = fork(serverPath, editArgs, { stdio: 'ignore' });
    await waitForInstance(projectDir, 'edit', 5000);
    // Don't wait for editChild — it stays running
    editChild.unref();
  }

  disc = await readDiscovery(projectDir);
  const editorPort = disc.edit!.port;

  const serverPath = resolve(import.meta.dirname, '../../server/main.js');
  const args = ['--mode', 'play', '--dir', projectDir, '--port', '21201', '--sync-from', String(editorPort)];

  const child = fork(serverPath, args, { stdio: 'ignore' });

  await waitForInstance(projectDir, 'play', 3000);

  if (interactive) {
    await setAttachedInstance(projectDir, 'play');
    process.on('exit', () => { try { child.kill('SIGTERM'); } catch {} });
    child.on('exit', () => process.exit(0));
    await runInteractiveShell(projectDir);
    return;
  }

  printJson({ ok: true, data: { spawned: 'play', mode: 'preview' } });

  const onSigint = () => {
    child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', onSigint);

  child.on('exit', () => process.exit(0));
}

export async function runCommand(projectDir: string, interactive = false): Promise<void> {
  const outputDir = resolve(projectDir, 'build');
  const runScript = resolve(outputDir, 'run.sh');

  // Build if no build exists
  if (!existsSync(runScript)) {
    printJson({ ok: true, data: { status: 'building...' } });
    await buildCommand(projectDir, outputDir);
  }

  // Run the built player
  const playerPath = resolve(outputDir, 'runtime', 'dist', 'player', 'main.js');
  const gameDir = resolve(outputDir, 'game');

  if (!existsSync(playerPath)) {
    printJson({ ok: false, error: `player not found at ${playerPath}. Run 'ku build' first.` });
    return;
  }

  const child = fork(playerPath, [gameDir], { stdio: 'ignore' });

  if (interactive) {
    process.on('exit', () => { try { child.kill('SIGTERM'); } catch {} });
    child.on('exit', () => process.exit(0));
    await runInteractiveShell(projectDir);
    return;
  }

  printJson({ ok: true, data: { spawned: 'run' } });

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

async function runInteractiveShell(projectDir: string): Promise<void> {
  process.removeAllListeners('SIGINT');
  const { shellCommand } = await import('./shell.js');
  await shellCommand(projectDir);
}
