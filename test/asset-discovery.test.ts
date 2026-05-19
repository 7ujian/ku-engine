import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverAssets } from '../src/persistence/asset-discovery.js';

describe('discoverAssets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ku-build-test-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('discovers textures from sprite nodes', async () => {
    mkdirSync(resolve(tmpDir, 'scenes'), { recursive: true });
    mkdirSync(resolve(tmpDir, 'assets'), { recursive: true });

    writeFileSync(resolve(tmpDir, 'project.json'), JSON.stringify({ entry: 'main' }));
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

    const assets = await discoverAssets(tmpDir);
    expect(assets.textures).toHaveLength(1);
    expect(assets.textures[0]).toContain('assets/player.png');
  });

  it('discovers atlas references', async () => {
    mkdirSync(resolve(tmpDir, 'scenes'), { recursive: true });

    writeFileSync(resolve(tmpDir, 'project.json'), JSON.stringify({ entry: 'main' }));
    writeFileSync(resolve(tmpDir, 'scenes', 'main.json'), JSON.stringify({
      scene: 'main',
      root: {
        id: 'root',
        type: 'Node',
        properties: {},
        children: [{
          id: 'player',
          type: 'Sprite',
          properties: { atlas: 'assets/player.atlas.json' },
          children: [],
          scripts: [],
        }],
        scripts: [],
      },
    }));

    const assets = await discoverAssets(tmpDir);
    expect(assets.atlases).toHaveLength(1);
  });

  it('discovers JS scripts', async () => {
    mkdirSync(resolve(tmpDir, 'scenes'), { recursive: true });

    writeFileSync(resolve(tmpDir, 'project.json'), JSON.stringify({ entry: 'main' }));
    writeFileSync(resolve(tmpDir, 'scenes', 'main.json'), JSON.stringify({
      scene: 'main',
      root: {
        id: 'root',
        type: 'Node',
        properties: {},
        children: [{
          id: 'player',
          type: 'RigidBody',
          properties: {},
          children: [],
          scripts: [],
          js_script: 'scripts/player.js',
        }],
        scripts: [],
      },
    }));

    const assets = await discoverAssets(tmpDir);
    expect(assets.scripts).toHaveLength(1);
    expect(assets.scripts[0]).toContain('scripts/player.js');
  });

  it('discovers AnimatedSprite frames', async () => {
    mkdirSync(resolve(tmpDir, 'scenes'), { recursive: true });

    writeFileSync(resolve(tmpDir, 'project.json'), JSON.stringify({ entry: 'main' }));
    writeFileSync(resolve(tmpDir, 'scenes', 'main.json'), JSON.stringify({
      scene: 'main',
      root: {
        id: 'root',
        type: 'Node',
        properties: {},
        children: [{
          id: 'anim',
          type: 'AnimatedSprite',
          properties: { frames: ['f1.png', 'f2.png'] },
          children: [],
          scripts: [],
        }],
        scripts: [],
      },
    }));

    const assets = await discoverAssets(tmpDir);
    expect(assets.textures).toHaveLength(2);
  });

  it('discovers audio streams', async () => {
    mkdirSync(resolve(tmpDir, 'scenes'), { recursive: true });

    writeFileSync(resolve(tmpDir, 'project.json'), JSON.stringify({ entry: 'main' }));
    writeFileSync(resolve(tmpDir, 'scenes', 'main.json'), JSON.stringify({
      scene: 'main',
      root: {
        id: 'root',
        type: 'Node',
        properties: {},
        children: [{
          id: 'bgm',
          type: 'AudioPlayer',
          properties: { stream: 'assets/music.mp3' },
          children: [],
          scripts: [],
        }],
        scripts: [],
      },
    }));

    const assets = await discoverAssets(tmpDir);
    expect(assets.audio).toHaveLength(1);
  });

  it('throws on missing project.json', async () => {
    await expect(discoverAssets(tmpDir)).rejects.toThrow();
  });
});
