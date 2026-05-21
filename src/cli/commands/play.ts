import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readDiscovery, isAlive, normalizePlayName } from '../../server/discovery.js';
import { waitForInstance, setAttachedInstance } from './edit.js';
import { buildCommand } from './build.js';

function pickNextPlayName(disc: Record<string, { pid: number; port: number }>): string {
  for (let i = 1; i <= 100; i++) {
    const name = `play${i}`;
    const info = disc[name];
    if (!info || !isAlive(info.pid)) return name;
  }
  throw new Error('too many play instances');
}

export async function playCommand(projectDir: string, opts: { interactive?: boolean; scene?: string; name?: string; watch?: boolean } = {}): Promise<void> {
  const disc = await readDiscovery(projectDir);
  const playName = opts.name ? normalizePlayName(opts.name) : pickNextPlayName(disc);

  const serverPath = resolve(import.meta.dirname, '../../server/main.js');
  const args = ['--mode', playName, '--dir', projectDir, '--port', '0'];
  if (opts.scene) args.push('--load-scene', opts.scene);
  if (opts.watch) args.push('--watch');

  const child = fork(serverPath, args, { stdio: 'inherit' });

  await waitForInstance(projectDir, playName, 5000, child);

  if (opts.interactive) {
    await setAttachedInstance(projectDir, playName);
    process.on('exit', () => { try { child.kill('SIGTERM'); } catch {} });
    child.on('exit', () => process.exit(0));
    await runInteractiveShell(projectDir);
    return;
  }

  printJson({ ok: true, data: { spawned: playName, scene: opts.scene ?? '(entry)' } });

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
