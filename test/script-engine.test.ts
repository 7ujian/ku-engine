import { describe, it, expect } from 'vitest';
import { evaluateExpression } from '../src/engine/expression-evaluator.js';
import { evaluateCondition } from '../src/engine/conditions.js';
import { EventBus } from '../src/engine/event-bus.js';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { ScriptEngine } from '../src/engine/script-engine.js';

describe('evaluateExpression', () => {
  const props = { x: 100, y: 200, speed: 5, velocity: { x: 10, y: -3 } };

  it('returns literals unchanged', () => {
    expect(evaluateExpression(42, props)).toBe(42);
    expect(evaluateExpression('hello', props)).toBe('hello');
    expect(evaluateExpression(true, props)).toBe(true);
  });

  it('returns strings without templates unchanged', () => {
    expect(evaluateExpression('player.png', props)).toBe('player.png');
  });

  it('resolves property references', () => {
    expect(evaluateExpression('{{speed}}', props)).toBe(5);
  });

  it('resolves negated property references', () => {
    expect(evaluateExpression('{{-speed}}', props)).toBe(-5);
  });

  it('resolves nested property references', () => {
    expect(evaluateExpression('{{velocity.x}}', props)).toBe(10);
  });

  it('resolves arithmetic expressions', () => {
    expect(evaluateExpression('{{x + 10}}', props)).toBe(110);
    expect(evaluateExpression('{{speed * 2}}', props)).toBe(10);
    expect(evaluateExpression('{{x - 50}}', props)).toBe(50);
  });

  it('resolves context references', () => {
    const ctx = { id: 'coin_0', x: 50 };
    expect(evaluateExpression('{{other.id}}', props, ctx)).toBe('coin_0');
  });

  it('resolves random function', () => {
    const result = evaluateExpression('{{random(0, 100)}}', props);
    const num = parseFloat(result as string);
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(100);
  });

  it('returns undefined for missing properties', () => {
    expect(evaluateExpression('{{missing}}', props)).toBeUndefined();
  });
});

describe('evaluateCondition', () => {
  const props = { x: 100, y: 200, speed: 5 };

  it('evaluates eq', () => {
    expect(evaluateCondition(props, { speed: { eq: 5 } })).toBe(true);
    expect(evaluateCondition(props, { speed: { eq: 3 } })).toBe(false);
  });

  it('evaluates neq', () => {
    expect(evaluateCondition(props, { speed: { neq: 0 } })).toBe(true);
  });

  it('evaluates gt/lt/gte/lte', () => {
    expect(evaluateCondition(props, { x: { gt: 50 } })).toBe(true);
    expect(evaluateCondition(props, { x: { lt: 50 } })).toBe(false);
    expect(evaluateCondition(props, { x: { gte: 100 } })).toBe(true);
    expect(evaluateCondition(props, { x: { lte: 100 } })).toBe(true);
  });

  it('evaluates in', () => {
    expect(evaluateCondition(props, { speed: { in: [1, 3, 5] } })).toBe(true);
    expect(evaluateCondition(props, { speed: { in: [1, 3] } })).toBe(false);
  });

  it('evaluates between', () => {
    expect(evaluateCondition(props, { x: { between: [50, 150] } })).toBe(true);
    expect(evaluateCondition(props, { x: { between: [200, 300] } })).toBe(false);
  });

  it('combines multiple conditions with AND', () => {
    expect(evaluateCondition(props, { x: { gt: 0 }, speed: { eq: 5 } })).toBe(true);
    expect(evaluateCondition(props, { x: { gt: 0 }, speed: { eq: 0 } })).toBe(false);
  });
});

describe('EventBus', () => {
  it('emits events to subscribers', () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on('test', (data) => received.push(data));
    bus.emit('test', { value: 42 });
    expect(received).toEqual([{ value: 42 }]);
  });

  it('supports multiple subscribers', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('test', () => count++);
    bus.on('test', () => count++);
    bus.emit('test');
    expect(count).toBe(2);
  });

  it('unsubscribes handlers', () => {
    const bus = new EventBus();
    let count = 0;
    const handler = () => count++;
    bus.on('test', handler);
    bus.off('test', handler);
    bus.emit('test');
    expect(count).toBe(0);
  });
});

describe('ScriptEngine', () => {
  function makeScene(): { tree: SceneTree; engine: ScriptEngine; player: Node } {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 100, y: 300, speed: 200 });
    player.scripts = [
      {
        event: 'on_key',
        filter: { key: 'right' },
        actions: [
          { set: 'x', to: '{{x + speed}}' },
        ],
      },
      {
        event: 'on_key',
        filter: { key: 'left' },
        actions: [
          { set: 'x', to: '{{x - speed}}' },
        ],
      },
      {
        event: 'on_collision',
        filter: { with: 'coin' },
        actions: [
          { destroy: '{{other}}' },
          { emit: 'coin_collected' },
          { log: 'got a coin!' },
        ],
      },
      {
        event: 'on_frame',
        condition: { speed: { gt: 0 } },
        actions: [
          { move: { x: 1, y: 0 } },
        ],
      },
    ];
    root.addChild(player);
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();
    return { tree, engine, player };
  }

  it('executes set action from event', () => {
    const { engine, player } = makeScene();
    engine.evaluateEvent('on_key', { key: 'right' });
    expect(player.getProperty('x')).toBe(300);
  });

  it('respects event filter', () => {
    const { engine, player } = makeScene();
    engine.evaluateEvent('on_key', { key: 'up' });
    expect(player.getProperty('x')).toBe(100);
  });

  it('executes multiple actions in order', () => {
    const { engine, player } = makeScene();
    engine.evaluateEvent('on_key', { key: 'right' });
    engine.evaluateEvent('on_key', { key: 'left' });
    expect(player.getProperty('x')).toBe(100);
  });

  it('executes destroy action', () => {
    const { tree, engine } = makeScene();
    const coin = new Node('coin_0', 'Sprite', { texture: 'coin.png' });
    tree.add('/', coin);
    engine.evaluateEvent('on_collision', { with: 'coin', other: 'coin_0' });
    expect(() => tree.get('coin_0')).toThrow('node not found');
  });

  it('emits custom events', () => {
    const { engine } = makeScene();
    const received: Record<string, unknown>[] = [];
    engine.getEventBus().on('coin_collected', (data) => received.push(data));
    engine.evaluateEvent('on_collision', { with: 'coin', other: 'coin_0' });
    expect(received).toEqual([{}]);
  });

  it('logs messages', () => {
    const { engine } = makeScene();
    engine.evaluateEvent('on_collision', { with: 'coin', other: 'coin_0' });
    expect(engine.getLogs()).toContain('got a coin!');
  });

  it('respects conditions', () => {
    const { engine, player } = makeScene();
    engine.evaluateEvent('on_frame', {});
    expect(player.getProperty('x')).toBe(101);
  });

  it('skips when condition is false', () => {
    const { engine, player } = makeScene();
    player.setProperty('speed', 0);
    engine.evaluateEvent('on_frame', {});
    expect(player.getProperty('x')).toBe(100);
  });

  it('move action adds to position', () => {
    const { engine, player } = makeScene();
    player.setProperty('speed', 0);
    player.setProperty('x', 50);
    player.setProperty('y', 50);
    player.scripts = [{
      event: 'on_frame',
      actions: [{ move: { x: 10, y: -5 } }],
    }];
    const engine2 = new ScriptEngine(new SceneTree(player.parent!));
    engine2.registerNode(player);
    engine2.evaluateEvent('on_frame', {});
    expect(player.getProperty('x')).toBe(60);
    expect(player.getProperty('y')).toBe(45);
  });
});
