import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { ScriptEngine } from '../src/engine/script-engine.js';

describe('ScriptEngine — spawn action', () => {
  it('spawns a new node at specified position', () => {
    const root = new Node('root', 'Node');
    const spawner = new Node('spawner', 'Node2D', { x: 100, y: 200 });
    spawner.scripts = [{
      event: 'on_custom',
      actions: [{ spawn: 'Sprite', as: 'bullet', at: { x: 0, y: 0 } }],
    }];
    root.addChild(spawner);
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();

    engine.evaluateEvent('on_custom', {});

    const bullet = tree.get('bullet');
    expect(bullet).toBeDefined();
    expect(bullet.type).toBe('Sprite');
    expect(bullet.getProperty('x')).toBe(0);
    expect(bullet.getProperty('y')).toBe(0);
  });

  it('spawns at node position when no at specified', () => {
    const root = new Node('root', 'Node');
    const spawner = new Node('spawner', 'Node2D', { x: 100, y: 200 });
    spawner.scripts = [{
      event: 'on_custom',
      actions: [{ spawn: 'Node2D', as: 'child' }],
    }];
    root.addChild(spawner);
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();

    engine.evaluateEvent('on_custom', {});

    const child = tree.get('child');
    expect(child).toBeDefined();
    expect(child.getProperty('x')).toBe(100);
    expect(child.getProperty('y')).toBe(200);
  });
});

describe('ScriptEngine — call action', () => {
  it('calls a named script', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 0, speed: 10 });
    player.scripts = [
      {
        event: 'on_key',
        name: 'move_right',
        actions: [{ set: 'x', to: '{{x + speed}}' }],
      },
      {
        event: 'on_custom',
        actions: [{ call: 'move_right' }],
      },
    ];
    root.addChild(player);
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();

    engine.evaluateEvent('on_custom', {});
    expect(player.getProperty('x')).toBe(10);
  });

  it('ignores unknown script names', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 5 });
    player.scripts = [{
      event: 'on_custom',
      actions: [{ call: 'nonexistent' }],
    }];
    root.addChild(player);
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();

    engine.evaluateEvent('on_custom', {});
    expect(player.getProperty('x')).toBe(5); // unchanged
  });
});

describe('ScriptEngine — play/stop actions', () => {
  it('play sets playing to true on target node', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 0 });
    const anim = new Node('walk_anim', 'AnimatedSprite', { playing: false });
    root.addChild(player);
    root.addChild(anim);
    player.scripts = [{
      event: 'on_key',
      actions: [{ play: 'walk_anim' }],
    }];
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();

    engine.evaluateEvent('on_key', {});
    expect(anim.getProperty('playing')).toBe(true);
  });

  it('play sets frame with from property', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 0 });
    const anim = new Node('anim', 'AnimatedSprite', { playing: false, frame: 0 });
    root.addChild(player);
    root.addChild(anim);
    player.scripts = [{
      event: 'on_key',
      actions: [{ play: 'anim', from: 3 }],
    }];
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();

    engine.evaluateEvent('on_key', {});
    expect(anim.getProperty('playing')).toBe(true);
    expect(anim.getProperty('frame')).toBe(3);
  });

  it('stop sets playing to false on target node', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 0 });
    const anim = new Node('anim', 'AnimatedSprite', { playing: true });
    root.addChild(player);
    root.addChild(anim);
    player.scripts = [{
      event: 'on_key',
      actions: [{ stop: 'anim' }],
    }];
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();

    engine.evaluateEvent('on_key', {});
    expect(anim.getProperty('playing')).toBe(false);
  });
});
