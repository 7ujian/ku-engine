import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { createNodeByType } from '../src/engine/node-types.js';

describe('Node', () => {
  it('creates with id and type', () => {
    const node = new Node('test', 'Node2D');
    expect(node.id).toBe('test');
    expect(node.type).toBe('Node2D');
    expect(node.children).toEqual([]);
    expect(node.scripts).toEqual([]);
  });

  it('creates with properties', () => {
    const node = new Node('player', 'Node2D', { x: 100, y: 200 });
    expect(node.getProperty('x')).toBe(100);
    expect(node.getProperty('y')).toBe(200);
  });

  it('sets and gets properties', () => {
    const node = new Node('a', 'Node2D');
    node.setProperty('x', 50);
    expect(node.getProperty('x')).toBe(50);
  });

  it('sets and gets nested properties by dot path', () => {
    const node = new Node('a', 'Node2D');
    node.setPropertyByPath('velocity.x', 10);
    expect(node.getPropertyByPath('velocity.x')).toBe(10);
  });

  it('returns undefined for missing properties', () => {
    const node = new Node('a', 'Node2D');
    expect(node.getProperty('missing')).toBeUndefined();
    expect(node.getPropertyByPath('a.b.c')).toBeUndefined();
  });

  it('adds and finds children', () => {
    const parent = new Node('parent', 'Node');
    const child = new Node('child', 'Node2D');
    parent.addChild(child);
    expect(parent.findChild('child')).toBe(child);
    expect(parent.findChild('missing')).toBeUndefined();
  });

  it('removes children', () => {
    const parent = new Node('parent', 'Node');
    const child = new Node('child', 'Node2D');
    parent.addChild(child);
    const removed = parent.removeChild('child');
    expect(removed).toBe(child);
    expect(parent.findChild('child')).toBeUndefined();
  });

  it('round-trips through JSON', () => {
    const original = new Node('player', 'Node2D', { x: 100, y: 300 });
    const sprite = new Node('sprite', 'Sprite', { texture: 'player.png' });
    original.addChild(sprite);

    const json = original.toJSON();
    const restored = Node.fromJSON(json);

    expect(restored.id).toBe('player');
    expect(restored.type).toBe('Node2D');
    expect(restored.getProperty('x')).toBe(100);
    expect(restored.children).toHaveLength(1);
    expect(restored.children[0].id).toBe('sprite');
    expect(restored.children[0].getProperty('texture')).toBe('player.png');
  });

  it('clones deeply', () => {
    const original = new Node('a', 'Node', { x: 1 });
    original.addChild(new Node('b', 'Node', { y: 2 }));
    const clone = original.clone();

    clone.setProperty('x', 99);
    clone.children[0].setProperty('y', 99);

    expect(original.getProperty('x')).toBe(1);
    expect(original.children[0].getProperty('y')).toBe(2);
  });
});

describe('createNodeByType', () => {
  it('creates all built-in types', () => {
    const types = ['Node', 'Node2D', 'Sprite', 'AnimatedSprite', 'RigidBody', 'Area',
      'CollisionShape', 'Camera2D', 'Label', 'TileMap', 'Timer', 'AudioPlayer'];
    for (const type of types) {
      const node = createNodeByType(type, `test_${type}`);
      expect(node.type).toBe(type);
      expect(node.id).toBe(`test_${type}`);
    }
  });

  it('throws for unknown type', () => {
    expect(() => createNodeByType('Unknown', 'x')).toThrow('unknown node type: Unknown');
  });

  it('applies overrides', () => {
    const node = createNodeByType('Node2D', 'player', { x: 100, y: 200 });
    expect(node.getProperty('x')).toBe(100);
    expect(node.getProperty('y')).toBe(200);
    expect(node.getProperty('visible')).toBe(true);
  });
});

describe('SceneTree', () => {
  function makeTree(): SceneTree {
    const root = new Node('root', 'Node');
    const world = new Node('world', 'Node');
    const player = new Node('player', 'Node2D', { x: 100, y: 300 });
    const sprite = new Node('sprite', 'Sprite', { texture: 'player.png' });
    const hitbox = new Node('hitbox', 'CollisionShape', { shape: 'rect', width: 32, height: 48 });
    player.addChild(sprite);
    player.addChild(hitbox);
    world.addChild(player);
    root.addChild(world);
    return new SceneTree(root);
  }

  it('gets root by "/" or ""', () => {
    const tree = makeTree();
    expect(tree.get('/')).toBe(tree.root);
    expect(tree.get('')).toBe(tree.root);
  });

  it('gets nodes by path', () => {
    const tree = makeTree();
    expect(tree.get('world').id).toBe('world');
    expect(tree.get('world/player').id).toBe('player');
    expect(tree.get('world/player/sprite').id).toBe('sprite');
  });

  it('throws for missing path', () => {
    const tree = makeTree();
    expect(() => tree.get('nonexistent')).toThrow('node not found: nonexistent');
    expect(() => tree.get('world/missing')).toThrow('node not found: world/missing');
  });

  it('adds nodes', () => {
    const tree = makeTree();
    const coin = new Node('coin', 'Sprite', { texture: 'coin.png' });
    tree.add('world', coin);
    expect(tree.get('world/coin').id).toBe('coin');
  });

  it('adds nodes to root', () => {
    const tree = makeTree();
    const ui = new Node('ui', 'Node');
    tree.add('/', ui);
    expect(tree.get('ui').id).toBe('ui');
  });

  it('rejects duplicate child id', () => {
    const tree = makeTree();
    const dup = new Node('player', 'Node2D');
    expect(() => tree.add('world', dup)).toThrow('child already exists: player');
  });

  it('removes nodes', () => {
    const tree = makeTree();
    const removed = tree.remove('world/player/sprite');
    expect(removed.id).toBe('sprite');
    expect(() => tree.get('world/player/sprite')).toThrow('node not found');
  });

  it('refuses to remove root', () => {
    const tree = makeTree();
    expect(() => tree.remove('/')).toThrow('cannot remove root');
  });

  it('moves (reparents) nodes', () => {
    const tree = makeTree();
    tree.move('world/player/sprite', '/');
    expect(tree.get('sprite').id).toBe('sprite');
    expect(() => tree.get('world/player/sprite')).toThrow('node not found');
  });

  it('finds nodes by type', () => {
    const tree = makeTree();
    const sprites = tree.findByType('Sprite');
    expect(sprites).toHaveLength(1);
    expect(sprites[0].id).toBe('sprite');
  });

  it('traverses depth-first', () => {
    const tree = makeTree();
    const visited: string[] = [];
    tree.traverse((_node, path) => visited.push(path));
    expect(visited).toEqual([
      '/',
      '/world',
      '/world/player',
      '/world/player/sprite',
      '/world/player/hitbox',
    ]);
  });

  it('clones deeply', () => {
    const tree = makeTree();
    const clone = tree.clone();
    clone.remove('world/player/sprite');
    expect(() => tree.get('world/player/sprite')).not.toThrow();
    expect(() => clone.get('world/player/sprite')).toThrow('node not found');
  });
});
