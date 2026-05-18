import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import {
  IDENTITY,
  getLocalTransform,
  composeTransform,
  getWorldTransform,
  localToWorld,
  worldToLocal,
  worldToLocalDirect,
} from '../src/engine/transform.js';

describe('Transform2D', () => {
  describe('getLocalTransform', () => {
    it('returns identity for node without x/y', () => {
      const node = new Node('root', 'Node');
      const t = getLocalTransform(node);
      expect(t).toEqual(IDENTITY);
    });

    it('reads x/y from node properties', () => {
      const node = new Node('player', 'Node2D', { x: 100, y: 200 });
      const t = getLocalTransform(node);
      expect(t.x).toBe(100);
      expect(t.y).toBe(200);
      expect(t.rotation).toBe(0);
      expect(t.scaleX).toBe(1);
      expect(t.scaleY).toBe(1);
    });

    it('reads rotation and scale', () => {
      const node = new Node('player', 'Node2D', { x: 50, y: 50, rotation: 1.57, scale_x: 2, scale_y: 0.5 });
      const t = getLocalTransform(node);
      expect(t.x).toBe(50);
      expect(t.y).toBe(50);
      expect(t.rotation).toBeCloseTo(1.57);
      expect(t.scaleX).toBe(2);
      expect(t.scaleY).toBe(0.5);
    });
  });

  describe('composeTransform', () => {
    it('identity composed with local returns local', () => {
      const local = { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 };
      const result = composeTransform(IDENTITY, local);
      expect(result.x).toBe(10);
      expect(result.y).toBe(20);
    });

    it('translates child position by parent position', () => {
      const parent = { x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1 };
      const child = { x: 10, y: 5, rotation: 0, scaleX: 1, scaleY: 1 };
      const result = composeTransform(parent, child);
      expect(result.x).toBe(110);
      expect(result.y).toBe(55);
    });

    it('rotates child position around parent', () => {
      const parent = { x: 100, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 };
      const child = { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      const result = composeTransform(parent, child);
      expect(result.x).toBeCloseTo(100, 4);
      expect(result.y).toBeCloseTo(10, 4);
    });

    it('scales child position by parent scale', () => {
      const parent = { x: 100, y: 0, rotation: 0, scaleX: 2, scaleY: 1 };
      const child = { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      const result = composeTransform(parent, child);
      expect(result.x).toBe(120);
      expect(result.y).toBe(0);
    });

    it('composes rotation', () => {
      const parent = { x: 0, y: 0, rotation: Math.PI / 4, scaleX: 1, scaleY: 1 };
      const child = { x: 0, y: 0, rotation: Math.PI / 4, scaleX: 1, scaleY: 1 };
      const result = composeTransform(parent, child);
      expect(result.rotation).toBeCloseTo(Math.PI / 2);
    });

    it('composes scale', () => {
      const parent = { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 3 };
      const child = { x: 0, y: 0, rotation: 0, scaleX: 0.5, scaleY: 2 };
      const result = composeTransform(parent, child);
      expect(result.scaleX).toBe(1);
      expect(result.scaleY).toBe(6);
    });
  });

  describe('getWorldTransform', () => {
    it('flat child under root has world == local', () => {
      const root = new Node('root', 'Node');
      const child = new Node('player', 'Node2D', { x: 100, y: 200 });
      root.addChild(child);
      const world = getWorldTransform(child);
      expect(world.x).toBe(100);
      expect(world.y).toBe(200);
    });

    it('single-level parent offset', () => {
      const root = new Node('root', 'Node');
      const parent = new Node('parent', 'Node2D', { x: 50, y: 50 });
      const child = new Node('child', 'Node2D', { x: 10, y: 10 });
      root.addChild(parent);
      parent.addChild(child);
      const world = getWorldTransform(child);
      expect(world.x).toBe(60);
      expect(world.y).toBe(60);
    });

    it('multi-level nesting', () => {
      const root = new Node('root', 'Node');
      const gp = new Node('gp', 'Node2D', { x: 100, y: 0 });
      const p = new Node('p', 'Node2D', { x: 0, y: 50 });
      const c = new Node('c', 'Node2D', { x: 10, y: 10 });
      root.addChild(gp);
      gp.addChild(p);
      p.addChild(c);
      const world = getWorldTransform(c);
      expect(world.x).toBe(110);
      expect(world.y).toBe(60);
    });

    it('rotation composition', () => {
      const root = new Node('root', 'Node');
      const parent = new Node('parent', 'Node2D', { x: 100, y: 0, rotation: Math.PI / 2 });
      const child = new Node('child', 'Node2D', { x: 10, y: 0 });
      root.addChild(parent);
      parent.addChild(child);
      const world = getWorldTransform(child);
      expect(world.x).toBeCloseTo(100, 4);
      expect(world.y).toBeCloseTo(10, 4);
    });

    it('scale composition', () => {
      const root = new Node('root', 'Node');
      const parent = new Node('parent', 'Node2D', { x: 100, y: 0, scale_x: 2, scale_y: 1 });
      const child = new Node('child', 'Node2D', { x: 10, y: 0 });
      root.addChild(parent);
      parent.addChild(child);
      const world = getWorldTransform(child);
      expect(world.x).toBe(120);
      expect(world.y).toBe(0);
    });

    it('root node with no parent returns identity', () => {
      const root = new Node('root', 'Node');
      const world = getWorldTransform(root);
      expect(world).toEqual(IDENTITY);
    });
  });

  describe('localToWorld', () => {
    it('converts origin to world position', () => {
      const root = new Node('root', 'Node');
      const node = new Node('player', 'Node2D', { x: 100, y: 200 });
      root.addChild(node);
      const result = localToWorld(node, 0, 0);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    it('converts offset in node space to world', () => {
      const root = new Node('root', 'Node');
      const node = new Node('player', 'Node2D', { x: 100, y: 200 });
      root.addChild(node);
      const result = localToWorld(node, 10, 5);
      expect(result.x).toBe(110);
      expect(result.y).toBe(205);
    });
  });

  describe('worldToLocal', () => {
    it('roundtrip: local → world → local', () => {
      const root = new Node('root', 'Node');
      const parent = new Node('parent', 'Node2D', { x: 50, y: 50 });
      const child = new Node('child', 'Node2D', { x: 10, y: 10 });
      root.addChild(parent);
      parent.addChild(child);

      const worldPos = getWorldTransform(child);
      const localPos = worldToLocal(child, worldPos.x, worldPos.y);
      expect(localPos.x).toBeCloseTo(10);
      expect(localPos.y).toBeCloseTo(10);
    });

    it('roundtrip with rotation', () => {
      const root = new Node('root', 'Node');
      const parent = new Node('parent', 'Node2D', { x: 100, y: 0, rotation: Math.PI / 4 });
      const child = new Node('child', 'Node2D', { x: 20, y: 0 });
      root.addChild(parent);
      parent.addChild(child);

      const worldPos = getWorldTransform(child);
      const localPos = worldToLocal(child, worldPos.x, worldPos.y);
      expect(localPos.x).toBeCloseTo(20);
      expect(localPos.y).toBeCloseTo(0);
    });

    it('roundtrip with scale', () => {
      const root = new Node('root', 'Node');
      const parent = new Node('parent', 'Node2D', { x: 0, y: 0, scale_x: 3, scale_y: 2 });
      const child = new Node('child', 'Node2D', { x: 10, y: 5 });
      root.addChild(parent);
      parent.addChild(child);

      const worldPos = getWorldTransform(child);
      const localPos = worldToLocal(child, worldPos.x, worldPos.y);
      expect(localPos.x).toBeCloseTo(10);
      expect(localPos.y).toBeCloseTo(5);
    });

    it('node without parent returns input', () => {
      const node = new Node('orphan', 'Node2D', { x: 100, y: 200 });
      const result = worldToLocal(node, 300, 400);
      expect(result).toEqual({ x: 300, y: 400 });
    });
  });

  describe('worldToLocalDirect', () => {
    it('inverts parent transform', () => {
      const parentWorld = { x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1 };
      const result = worldToLocalDirect(parentWorld, 110, 55);
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(5);
    });

    it('inverts with scale', () => {
      const parentWorld = { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 3 };
      const result = worldToLocalDirect(parentWorld, 20, 30);
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(10);
    });
  });

  describe('parent backlink', () => {
    it('addChild sets parent', () => {
      const root = new Node('root', 'Node');
      const child = new Node('child', 'Node2D', { x: 10, y: 20 });
      root.addChild(child);
      expect(child.parent).toBe(root);
    });

    it('removeChild clears parent', () => {
      const root = new Node('root', 'Node');
      const child = new Node('child', 'Node2D', { x: 10, y: 20 });
      root.addChild(child);
      root.removeChild('child');
      expect(child.parent).toBeNull();
    });

    it('fromJSON sets parent backlinks', () => {
      const root = Node.fromJSON({
        id: 'root', type: 'Node', properties: {},
        children: [
          { id: 'child', type: 'Node2D', properties: { x: 10, y: 20 }, children: [
            { id: 'grandchild', type: 'Node2D', properties: { x: 5, y: 5 }, children: [] },
          ], scripts: [] },
        ],
        scripts: [],
      });
      const child = root.findChild('child')!;
      const grandchild = child.findChild('grandchild')!;
      expect(child.parent).toBe(root);
      expect(grandchild.parent).toBe(child);
    });
  });
});
