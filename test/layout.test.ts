import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { resolveLayout, computeControlRect } from '../src/engine/layout.js';

describe('computeControlRect', () => {
  it('computes rect for anchored node within parent', () => {
    const node = new Node('btn', 'Button', {
      anchor_left: 0, anchor_right: 1,
      anchor_top: 0, anchor_bottom: 0,
      margin_left: 0, margin_right: 0,
      margin_top: 0, margin_bottom: 40,
      width: 800, height: 40,
    });
    const rect = computeControlRect(node, { x: 0, y: 0, width: 800, height: 600 });
    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 40 });
  });

  it('falls back to x/y for legacy nodes', () => {
    const node = new Node('p', 'Panel', {
      x: 10, y: 20, width: 100, height: 50,
    });
    const rect = computeControlRect(node, { x: 0, y: 0, width: 800, height: 600 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });
});

describe('VBoxContainer layout', () => {
  it('stacks children vertically with separation', () => {
    const container = new Node('vbox', 'VBoxContainer', {
      separation: 4,
      width: 200, height: 200,
    });
    const child1 = new Node('a', 'Panel', { width: 100, height: 30, min_size: { width: 0, height: 30 } });
    const child2 = new Node('b', 'Panel', { width: 100, height: 50, min_size: { width: 0, height: 50 } });
    container.addChild(child1);
    container.addChild(child2);

    resolveLayout(container, { x: 0, y: 0, width: 200, height: 200 });

    expect(child1._computed).toEqual({ x: 0, y: 0, width: 200, height: 30 });
    expect(child2._computed).toEqual({ x: 0, y: 34, width: 200, height: 50 });
  });

  it('distributes extra space to expand children', () => {
    const container = new Node('vbox', 'VBoxContainer', {
      separation: 0,
      width: 200, height: 200,
    });
    const child1 = new Node('a', 'Panel', {
      height: 40, size_flags_vertical: 'expand',
      min_size: { width: 0, height: 40 },
    });
    const child2 = new Node('b', 'Panel', {
      height: 40, size_flags_vertical: 'fill',
      min_size: { width: 0, height: 40 },
    });
    container.addChild(child1);
    container.addChild(child2);

    resolveLayout(container, { x: 0, y: 0, width: 200, height: 200 });

    expect(child1._computed.height).toBe(160); // 40 min + 120 extra
    expect(child2._computed.height).toBe(40);
    expect(child2._computed.y).toBe(160);
  });
});

describe('HBoxContainer layout', () => {
  it('stacks children horizontally with separation', () => {
    const container = new Node('hbox', 'HBoxContainer', {
      separation: 8,
      width: 300, height: 50,
    });
    const child1 = new Node('a', 'Panel', { width: 100, height: 50, min_size: { width: 100, height: 0 } });
    const child2 = new Node('b', 'Panel', { width: 100, height: 50, min_size: { width: 100, height: 0 } });
    container.addChild(child1);
    container.addChild(child2);

    resolveLayout(container, { x: 10, y: 20, width: 300, height: 50 });

    expect(child1._computed).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(child2._computed).toEqual({ x: 118, y: 20, width: 100, height: 50 });
  });
});

describe('MarginContainer layout', () => {
  it('applies padding to single child', () => {
    const container = new Node('mc', 'MarginContainer', {
      padding_left: 10, padding_right: 20,
      padding_top: 5, padding_bottom: 15,
      width: 200, height: 100,
    });
    const child = new Node('a', 'Panel', { width: 0, height: 0 });
    container.addChild(child);

    resolveLayout(container, { x: 0, y: 0, width: 200, height: 100 });

    expect(child._computed).toEqual({ x: 10, y: 5, width: 170, height: 80 });
  });
});

describe('CenterContainer layout', () => {
  it('centers child within container', () => {
    const container = new Node('cc', 'CenterContainer', {
      width: 200, height: 100,
    });
    const child = new Node('a', 'Panel', { width: 60, height: 40, min_size: { width: 60, height: 40 } });
    container.addChild(child);

    resolveLayout(container, { x: 0, y: 0, width: 200, height: 100 });

    expect(child._computed).toEqual({ x: 70, y: 30, width: 60, height: 40 });
  });
});
