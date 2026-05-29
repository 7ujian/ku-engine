import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { loadScene, saveScene, listScenes, sceneFilePath } from '../src/persistence/scene-io.js';

describe('scene-file', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ku-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('saves and loads a scene', async () => {
    const root = new Node('world', 'Node');
    const player = new Node('player', 'Node2D', { x: 100, y: 300, speed: 200 });
    root.addChild(player);

    const tree = new SceneTree(root);
    const path = sceneFilePath(testDir, 'test');

    await saveScene(tree, path, 'test');
    const loaded = await loadScene(path);

    expect(loaded.root.id).toBe('world');
    expect(loaded.root.children).toHaveLength(1);
    expect(loaded.root.children[0].id).toBe('player');
    expect(loaded.root.children[0].getProperty('x')).toBe(100);
  });

  it('round-trips a complex scene', async () => {
    const root = new Node('world', 'Node');
    const player = new Node('player', 'Node2D', { x: 80, y: 200 });
    player.addChild(new Node('sprite', 'Sprite', { texture: 'player.png' }));
    player.addChild(new Node('hitbox', 'CollisionShape', { shape: 'rect', width: 32, height: 48 }));
    root.addChild(player);

    const tree = new SceneTree(root);
    const path = sceneFilePath(testDir, 'complex');

    await saveScene(tree, path, 'complex');
    const loaded = await loadScene(path);

    const stripOid = (obj: any): any => {
      if (Array.isArray(obj)) return obj.map(stripOid);
      if (obj && typeof obj === 'object') {
        const { _object_id, ...rest } = obj;
        for (const k of Object.keys(rest)) rest[k] = stripOid(rest[k]);
        return rest;
      }
      return obj;
    };
    expect(stripOid(loaded.root.toJSON())).toEqual(stripOid(root.toJSON()));
  });

  it('round-trips scripts', async () => {
    const root = new Node('player', 'Node2D', { x: 0, y: 0 });
    root.scripts = [
      {
        event: 'on_key',
        filter: { key: 'right' },
        actions: [
          { set: 'velocity.x', to: 200 },
        ],
      },
    ];

    const tree = new SceneTree(root);
    const path = sceneFilePath(testDir, 'scripted');

    await saveScene(tree, path, 'scripted');
    const loaded = await loadScene(path);

    expect(loaded.root.scripts).toHaveLength(1);
    expect(loaded.root.scripts[0].event).toBe('on_key');
    expect(loaded.root.scripts[0].actions).toHaveLength(1);
  });

  it('lists scene files', async () => {
    const tree = new SceneTree(new Node('root', 'Node'));
    await saveScene(tree, sceneFilePath(testDir, 'scene_a'), 'a');
    await saveScene(tree, sceneFilePath(testDir, 'scene_b'), 'b');

    const scenes = await listScenes(testDir);
    expect(scenes).toEqual(['scene_a.json', 'scene_b.json']);
  });

  it('returns empty list for missing directory', async () => {
    const scenes = await listScenes('/nonexistent/path');
    expect(scenes).toEqual([]);
  });

  it('creates parent directories on save', async () => {
    const deepPath = join(testDir, 'nested', 'dir', 'scene.json');
    const tree = new SceneTree(new Node('root', 'Node'));
    await saveScene(tree, deepPath, 'deep');
    const loaded = await loadScene(deepPath);
    expect(loaded.root.id).toBe('root');
  });
});
