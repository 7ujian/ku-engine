import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { ScriptEngine } from '../src/engine/script-engine.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { SyncClient } from '../src/server/sync-client.js';
import type { SyncOp } from '../src/server/message-handler.js';

describe('SyncClient.applySnapshot', () => {
  it('replaces tree root with snapshot data', () => {
    const tree = new SceneTree(new Node('root', 'Node'));
    const client = new SyncClient(tree, 21200);

    client.applySnapshot({
      id: 'root',
      type: 'Node',
      properties: {},
      children: [
        { id: 'player', type: 'Node2D', properties: { x: 100, y: 200 }, children: [], scripts: [] },
      ],
      scripts: [],
    });

    const player = tree.get('player');
    expect(player).toBeDefined();
    expect(player.type).toBe('Node2D');
    expect(player.getProperty('x')).toBe(100);
  });

  it('registers scripts after snapshot', () => {
    const tree = new SceneTree(new Node('root', 'Node'));
    const scripts = new ScriptEngine(tree);
    const client = new SyncClient(tree, 21200);
    client.scripts = scripts;

    client.applySnapshot({
      id: 'root',
      type: 'Node',
      properties: {},
      children: [
        {
          id: 'player',
          type: 'Node2D',
          properties: { x: 0 },
          children: [],
          scripts: [{ event: 'on_key', actions: [{ set: 'x', to: 10 }] }],
        },
      ],
      scripts: [],
    });

    scripts.evaluateEvent('on_key', {});
    expect(tree.get('player').getProperty('x')).toBe(10);
  });
});

describe('SyncClient.applyDelta', () => {
  it('applies add op', () => {
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200);

    client.applyDelta([{
      op: 'add',
      path: '/',
      node: { id: 'enemy', type: 'Node2D', properties: { x: 50 }, children: [], scripts: [] },
    }]);

    expect(tree.get('enemy')).toBeDefined();
    expect(tree.get('enemy').getProperty('x')).toBe(50);
  });

  it('applies remove op', () => {
    const root = new Node('root', 'Node');
    root.addChild(new Node('enemy', 'Node2D', { x: 50 }));
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200);

    client.applyDelta([{ op: 'remove', path: 'enemy' }]);
    expect(() => tree.get('enemy')).toThrow('node not found');
  });

  it('applies set op', () => {
    const root = new Node('root', 'Node');
    root.addChild(new Node('player', 'Node2D', { x: 0, speed: 100 }));
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200);

    client.applyDelta([{ op: 'set', path: 'player', property: 'speed', value: 200 }]);
    expect(tree.get('player').getProperty('speed')).toBe(200);
  });

  it('applies move op', () => {
    const root = new Node('root', 'Node');
    const parent1 = new Node('group_a', 'Node');
    const parent2 = new Node('group_b', 'Node');
    parent1.addChild(new Node('item', 'Node2D', { x: 10 }));
    root.addChild(parent1);
    root.addChild(parent2);
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200);

    client.applyDelta([{ op: 'move', from: 'group_a/item', to: 'group_b' }]);
    expect(tree.get('group_b/item')).toBeDefined();
    expect(() => tree.get('group_a/item')).toThrow();
  });

  it('applies replace_all op (full resync)', () => {
    const root = new Node('root', 'Node');
    root.addChild(new Node('old_node', 'Node'));
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200);

    client.applyDelta([{
      op: 'replace_all',
      root: {
        id: 'root',
        type: 'Node',
        properties: {},
        children: [
          { id: 'new_node', type: 'Node2D', properties: { x: 99 }, children: [], scripts: [] },
        ],
        scripts: [],
      },
    }]);

    expect(() => tree.get('old_node')).toThrow();
    expect(tree.get('new_node').getProperty('x')).toBe(99);
  });

  it('skips guarded properties on RigidBody during hot-reload', () => {
    const root = new Node('root', 'Node');
    root.addChild(new Node('bird', 'RigidBody', { x: 100, y: 200, velocity: { x: 0, y: 0 }, mass: 1, gravity_scale: 1, linear_damping: 0 }));
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200, true); // hotReload = true

    client.applyDelta([
      { op: 'set', path: 'bird', property: 'x', value: 999 }, // guarded
      { op: 'set', path: 'bird', property: 'speed', value: 300 }, // not guarded
    ]);

    expect(tree.get('bird').getProperty('x')).toBe(100); // unchanged
    expect(tree.get('bird').getProperty('speed')).toBe(300); // applied
  });

  it('allows guarded properties when not in hot-reload mode', () => {
    const root = new Node('root', 'Node');
    root.addChild(new Node('bird', 'RigidBody', { x: 100, y: 200 }));
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200, false); // hotReload = false

    client.applyDelta([{ op: 'set', path: 'bird', property: 'x', value: 999 }]);
    expect(tree.get('bird').getProperty('x')).toBe(999);
  });

  it('applies replace_scripts op', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 0 });
    player.scripts = [{ event: 'on_key', actions: [{ set: 'x', to: 10 }] }];
    root.addChild(player);
    const tree = new SceneTree(root);
    const scripts = new ScriptEngine(tree);
    scripts.registerTree();
    const client = new SyncClient(tree, 21200);
    client.scripts = scripts;

    client.applyDelta([{
      op: 'replace_scripts',
      path: 'player',
      scripts: [{ event: 'on_key', actions: [{ set: 'x', to: 50 }] }],
    }]);

    scripts.evaluateEvent('on_key', {});
    expect(player.getProperty('x')).toBe(50);
  });

  it('ignores failing ops gracefully', () => {
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const client = new SyncClient(tree, 21200);

    // Should not throw
    client.applyDelta([
      { op: 'remove', path: 'nonexistent' },
      { op: 'set', path: 'also_missing', property: 'x', value: 1 },
    ]);
  });
});
