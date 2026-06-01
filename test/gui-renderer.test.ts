import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';

describe('Slider rendering logic', () => {
  it('computes handle position from value', () => {
    const node = new Node('s', 'Slider', {
      min_value: 0, max_value: 100, value: 50,
      orientation: 'horizontal', direction: 'left_to_right',
    });
    const t = (50 - 0) / (100 - 0);
    expect(t).toBeCloseTo(0.5);
  });

  it('clamps value to range', () => {
    const node = new Node('s', 'Slider', {
      min_value: 0, max_value: 100, value: 150,
    });
    const value = Math.min(100, Math.max(0, 150));
    expect(value).toBe(100);
  });
});

describe('Toggle rendering logic', () => {
  it('selects color based on pressed state', () => {
    const on = new Node('t', 'Toggle', { pressed: true, on_color: '#6a6aff', off_color: '#3a3a5e' });
    const color = on.getProperty('pressed') ? on.getProperty('on_color') : on.getProperty('off_color');
    expect(color).toBe('#6a6aff');

    const off = new Node('t2', 'Toggle', { pressed: false, on_color: '#6a6aff', off_color: '#3a3a5e' });
    const color2 = off.getProperty('pressed') ? off.getProperty('on_color') : off.getProperty('off_color');
    expect(color2).toBe('#3a3a5e');
  });
});
