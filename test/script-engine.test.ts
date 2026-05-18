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

  it('supports operator chaining', () => {
    expect(evaluateExpression('{{speed * 2 + 10}}', props)).toBe(20);
    expect(evaluateExpression('{{x - speed + 5}}', props)).toBe(100);
  });

  it('supports parentheses', () => {
    expect(evaluateExpression('{{(x + 10) * 2}}', props)).toBe(220);
    expect(evaluateExpression('{{(speed + 1) * (x - 50)}}', props)).toBe(300);
  });

  it('supports cross-node refs with tree', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 100, y: 200 });
    root.addChild(player);
    const tree = new SceneTree(root);
    expect(evaluateExpression('{{/player/x}}', {}, {}, tree)).toBe(100);
    expect(evaluateExpression('{{/player/x + 50}}', {}, {}, tree)).toBe(150);
    expect(evaluateExpression('{{/player/y * 2}}', {}, {}, tree)).toBe(400);
  });

  it('supports cross-node refs in string interpolation', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 100, y: 200 });
    root.addChild(player);
    const tree = new SceneTree(root);
    expect(evaluateExpression('pos: {{/player/x}}, {{/player/y}}', {}, {}, tree)).toBe('pos: 100, 200');
  });

  it('supports new functions', () => {
    expect(evaluateExpression('{{min(3, 7)}}', {})).toBe(3);
    expect(evaluateExpression('{{max(3, 7)}}', {})).toBe(7);
    expect(evaluateExpression('{{abs(-5)}}', {})).toBe(5);
    expect(evaluateExpression('{{floor(3.7)}}', {})).toBe(3);
    expect(evaluateExpression('{{ceil(3.2)}}', {})).toBe(4);
  });

  it('supports modulo', () => {
    expect(evaluateExpression('{{x % 30}}', props)).toBe(10);
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

  it('resolves cross-node condition paths', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { dead: true, score: 42 });
    root.addChild(player);
    const tree = new SceneTree(root);
    expect(evaluateCondition({}, { '/player/dead': { eq: true } }, {}, tree)).toBe(true);
    expect(evaluateCondition({}, { '/player/dead': { eq: false } }, {}, tree)).toBe(false);
    expect(evaluateCondition({}, { '/player/score': { gt: 40 } }, {}, tree)).toBe(true);
  });

  it('cross-node conditions with nested props', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { velocity: { x: 5 } });
    root.addChild(player);
    const tree = new SceneTree(root);
    expect(evaluateCondition({}, { '/player/velocity.x': { gt: 0 } }, {}, tree)).toBe(true);
  });

  it('backward compat: local conditions work without tree', () => {
    expect(evaluateCondition(props, { speed: { eq: 5 } })).toBe(true);
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

describe('ScriptEngine error reporting', () => {
  it('records error when set_on targets non-existent node', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 0 });
    player.scripts = [{ event: 'on_frame', actions: [{ set_on: 'missing', key: 'v', to: 1 }] }];
    root.addChild(player);
    const tree = new SceneTree(root);
    const engine = new ScriptEngine(tree);
    engine.registerTree();
    engine.evaluateEvent('on_frame', {});
    const errors = engine.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].action_type).toBe('set_on');
    expect(errors[0].reason).toContain('missing');
  });

  it('records error when destroy targets missing node', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D');
    player.scripts = [{ event: 'on_frame', actions: [{ destroy: 'ghost' }] }];
    root.addChild(player);
    const engine = new ScriptEngine(new SceneTree(root));
    engine.registerTree();
    engine.evaluateEvent('on_frame', {});
    expect(engine.getErrors()).toHaveLength(1);
    expect(engine.getErrors()[0].action_type).toBe('destroy');
  });

  it('records error when spawn uses unknown type', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D');
    player.scripts = [{ event: 'on_frame', actions: [{ spawn: 'BadType', as: 'x' }] }];
    root.addChild(player);
    const engine = new ScriptEngine(new SceneTree(root));
    engine.registerTree();
    engine.evaluateEvent('on_frame', {});
    expect(engine.getErrors()).toHaveLength(1);
    expect(engine.getErrors()[0].action_type).toBe('spawn');
  });

  it('clearErrors resets errors', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D');
    player.scripts = [{ event: 'on_frame', actions: [{ destroy: 'ghost' }] }];
    root.addChild(player);
    const engine = new ScriptEngine(new SceneTree(root));
    engine.registerTree();
    engine.evaluateEvent('on_frame', {});
    expect(engine.getErrors()).toHaveLength(1);
    engine.clearErrors();
    expect(engine.getErrors()).toHaveLength(0);
  });

  it('errors do not throw — engine continues', () => {
    const root = new Node('root', 'Node');
    const player = new Node('player', 'Node2D', { x: 0 });
    player.scripts = [
      { event: 'on_frame', actions: [{ destroy: 'ghost' }] },
      { event: 'on_frame', actions: [{ set: 'x', to: '{{x + 1}}' }] },
    ];
    root.addChild(player);
    const engine = new ScriptEngine(new SceneTree(root));
    engine.registerTree();
    engine.evaluateEvent('on_frame', {});
    expect(player.getProperty('x')).toBe(1); // second script still runs
    expect(engine.getErrors()).toHaveLength(1);
  });
});
