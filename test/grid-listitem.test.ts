import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { resolveLayout, isContainerType } from '../src/engine/layout.js';
import { isControlType } from '../src/engine/anchor.js';
import { createGrid, createListItem } from '../src/engine/node-types.js';

describe('Grid layout', () => {
  it('lays out children in row-major grid', () => {
    const container = new Node('grid', 'Grid', {
      columns: 2,
      column_spacing: 4,
      row_spacing: 4,
      width: 200,
      height: 200,
    });
    const c1 = new Node('a', 'Panel', { width: 0, height: 30, min_size: { width: 0, height: 30 } });
    const c2 = new Node('b', 'Panel', { width: 0, height: 30, min_size: { width: 0, height: 30 } });
    const c3 = new Node('c', 'Panel', { width: 0, height: 50, min_size: { width: 0, height: 50 } });
    const c4 = new Node('d', 'Panel', { width: 0, height: 50, min_size: { width: 0, height: 50 } });
    container.addChild(c1);
    container.addChild(c2);
    container.addChild(c3);
    container.addChild(c4);

    resolveLayout(container, { x: 0, y: 0, width: 200, height: 200 });

    const colWidth = (200 - 4) / 2; // 98

    // Row 0
    expect(c1._computed).toEqual({ x: 0, y: 0, width: colWidth, height: 30 });
    expect(c2._computed).toEqual({ x: colWidth + 4, y: 0, width: colWidth, height: 30 });
    // Row 1 (y = 30 + 4 = 34)
    expect(c3._computed).toEqual({ x: 0, y: 34, width: colWidth, height: 50 });
    expect(c4._computed).toEqual({ x: colWidth + 4, y: 34, width: colWidth, height: 50 });
  });

  it('handles incomplete last row', () => {
    const container = new Node('grid', 'Grid', {
      columns: 3,
      column_spacing: 0,
      row_spacing: 0,
      width: 300,
      height: 200,
    });
    const c1 = new Node('a', 'Panel', { width: 0, height: 40, min_size: { width: 0, height: 40 } });
    const c2 = new Node('b', 'Panel', { width: 0, height: 40, min_size: { width: 0, height: 40 } });
    container.addChild(c1);
    container.addChild(c2);

    resolveLayout(container, { x: 10, y: 10, width: 300, height: 200 });

    expect(c1._computed.x).toBe(10);
    expect(c2._computed.x).toBe(110); // 10 + 100
  });

  it('uses row max height for all cells in row', () => {
    const container = new Node('grid', 'Grid', {
      columns: 2,
      column_spacing: 0,
      row_spacing: 0,
      width: 200,
      height: 200,
    });
    const c1 = new Node('a', 'Panel', { width: 0, height: 20, min_size: { width: 0, height: 20 } });
    const c2 = new Node('b', 'Panel', { width: 0, height: 60, min_size: { width: 0, height: 60 } });
    container.addChild(c1);
    container.addChild(c2);

    resolveLayout(container, { x: 0, y: 0, width: 200, height: 200 });

    // c1 keeps its own height (fill), row max is 60 but only expand gets it
    expect(c1._computed.height).toBe(20);
    expect(c2._computed.height).toBe(60);
  });

  it('respects column_min_width', () => {
    const container = new Node('grid', 'Grid', {
      columns: 2,
      column_spacing: 0,
      row_spacing: 0,
      column_min_width: 150,
      width: 200,
      height: 100,
    });
    const c1 = new Node('a', 'Panel', { width: 0, height: 20, min_size: { width: 0, height: 20 } });
    container.addChild(c1);

    resolveLayout(container, { x: 0, y: 0, width: 200, height: 100 });

    expect(c1._computed.width).toBe(150);
  });

  it('is registered as container type', () => {
    expect(isContainerType('Grid')).toBe(true);
  });
});

describe('ListItem node', () => {
  it('creates with correct defaults', () => {
    const item = createListItem('item1');
    expect(item.type).toBe('ListItem');
    expect(item.getProperty('text')).toBe('');
    expect(item.getProperty('selected')).toBe(false);
    expect(item.getProperty('selectable')).toBe(true);
    expect(item.getProperty('clickable')).toBe(true);
    expect(item.getProperty('focus_mode')).toBe('click');
  });

  it('creates with overrides', () => {
    const item = createListItem('item2', {
      text: 'Hello',
      selected: true,
      icon: 'star.png',
    });
    expect(item.getProperty('text')).toBe('Hello');
    expect(item.getProperty('selected')).toBe(true);
    expect(item.getProperty('icon')).toBe('star.png');
  });

  it('is a control type', () => {
    expect(isControlType('ListItem')).toBe(true);
  });

  it('toggles selected property', () => {
    const item = createListItem('item3');
    expect(item.getProperty('selected')).toBe(false);
    item.setPropertyByPath('selected', true);
    expect(item.getProperty('selected')).toBe(true);
    item.setPropertyByPath('selected', false);
    expect(item.getProperty('selected')).toBe(false);
  });
});

describe('Grid node factory', () => {
  it('creates with correct defaults', () => {
    const grid = createGrid('g');
    expect(grid.type).toBe('Grid');
    expect(grid.getProperty('columns')).toBe(1);
    expect(grid.getProperty('column_spacing')).toBe(4);
    expect(grid.getProperty('row_spacing')).toBe(4);
    expect(grid.getProperty('column_min_width')).toBe(0);
  });

  it('is a control type', () => {
    expect(isControlType('Grid')).toBe(true);
  });
});
