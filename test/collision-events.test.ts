import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { CollisionEvents } from '../src/engine/collision-events.js';
import { EventBus } from '../src/engine/event-bus.js';

describe('CollisionEvents', () => {
  it('emits on_collision for new pairs', () => {
    const bus = new EventBus();
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const ce = new CollisionEvents(tree, (event, data) => {
      events.push({ event, data });
    });

    ce.update([{ nodeA: 'a', nodeB: 'b' }]);

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('on_collision');
    expect(events[0].data.node).toBe('a');
    expect(events[1].event).toBe('on_collision');
    expect(events[1].data.node).toBe('b');
  });

  it('does not re-emit on_collision for persistent pairs', () => {
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const ce = new CollisionEvents(tree, (event, data) => {
      events.push({ event, data });
    });

    ce.update([{ nodeA: 'a', nodeB: 'b' }]);
    expect(events).toHaveLength(2);

    ce.update([{ nodeA: 'a', nodeB: 'b' }]);
    // Should not re-emit
    expect(events).toHaveLength(2);
  });

  it('emits on_collision_exit when pair disappears', () => {
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const ce = new CollisionEvents(tree, (event, data) => {
      events.push({ event, data });
    });

    ce.update([{ nodeA: 'a', nodeB: 'b' }]);
    ce.update([]); // pair gone

    expect(events).toHaveLength(4); // 2 enter + 2 exit
    expect(events[2].event).toBe('on_collision_exit');
    expect(events[2].data.node).toBe('a');
    expect(events[3].event).toBe('on_collision_exit');
    expect(events[3].data.node).toBe('b');
  });

  it('handles multiple pairs independently', () => {
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const ce = new CollisionEvents(tree, (event, data) => {
      events.push({ event, data });
    });

    ce.update([
      { nodeA: 'a', nodeB: 'b' },
      { nodeA: 'c', nodeB: 'd' },
    ]);

    expect(events).toHaveLength(4);

    events.length = 0;
    ce.update([{ nodeA: 'a', nodeB: 'b' }]); // c-d exits

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('on_collision_exit');
  });

  it('reset clears previous state', () => {
    const root = new Node('root', 'Node');
    const tree = new SceneTree(root);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const ce = new CollisionEvents(tree, (event, data) => {
      events.push({ event, data });
    });

    ce.update([{ nodeA: 'a', nodeB: 'b' }]);
    ce.reset();
    ce.update([{ nodeA: 'a', nodeB: 'b' }]); // re-enter after reset

    expect(events).toHaveLength(4); // 2 enter + 2 re-enter
  });
});
