import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCommand } from '../src/cli/commands/build.js';

describe('build command', () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ku-build-cmd-'));
    outputDir = join(tmpDir, 'output');

    // Set up a minimal project
    mkdirSync(resolve(tmpDir, 'scenes'), { recursive: true });
    mkdirSync(resolve(tmpDir, 'assets'), { recursive: true });

    writeFileSync(resolve(tmpDir, 'project.json'), JSON.stringify({
      name: 'test-game',
      entry: 'main',
      window: { width: 320, height: 240 },
    }));

    writeFileSync(resolve(tmpDir, 'scenes', 'main.json'), JSON.stringify({
      scene: 'main',
      root: {
        id: 'root',
        type: 'Node',
        properties: {},
        children: [{
          id: 'player',
          type: 'Sprite',
          properties: { texture: 'assets/player.png' },
          children: [],
          scripts: [],
        }],
        scripts: [],
      },
    }));

    writeFileSync(resolve(tmpDir, 'assets', 'player.png'), '');
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('creates output directory structure', async () => {
    await buildCommand(tmpDir, outputDir);

    expect(existsSync(resolve(outputDir, 'runtime'))).toBe(true);
    expect(existsSync(resolve(outputDir, 'game'))).toBe(true);
    expect(existsSync(resolve(outputDir, 'run.sh'))).toBe(true);
    expect(existsSync(resolve(outputDir, 'run.bat'))).toBe(true);
  });

  it('copies game assets', async () => {
    await buildCommand(tmpDir, outputDir);

    expect(existsSync(resolve(outputDir, 'game', 'project.json'))).toBe(true);
    expect(existsSync(resolve(outputDir, 'game', 'scenes', 'main.json'))).toBe(true);
    expect(existsSync(resolve(outputDir, 'game', 'assets', 'player.png'))).toBe(true);
  });

  it('generates valid launcher script', async () => {
    await buildCommand(tmpDir, outputDir);

    const runSh = readFileSync(resolve(outputDir, 'run.sh'), 'utf-8');
    expect(runSh).toContain('node');
    expect(runSh).toContain('runtime/dist/player/main.js');
    expect(runSh).toContain('game');
  });

  it('generates runtime package.json', async () => {
    await buildCommand(tmpDir, outputDir);

    const pkg = JSON.parse(readFileSync(resolve(outputDir, 'runtime', 'package.json'), 'utf-8'));
    expect(pkg.type).toBe('module');
  });

  it('throws on missing project.json', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'ku-empty-'));
    try {
      await expect(buildCommand(emptyDir, join(emptyDir, 'build'))).rejects.toThrow('project.json not found');
    } finally {
      rmSync(emptyDir, { recursive: true });
    }
  });
});
