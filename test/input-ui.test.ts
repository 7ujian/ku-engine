import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { FocusManager } from '../src/engine/focus.js';

describe('Input integration', () => {
  it('Toggle toggles pressed on click', () => {
    const toggle = new Node('chk', 'Toggle', { pressed: false, group: '' });
    const pressed = toggle.getProperty('pressed') as boolean;
    toggle.setProperty('pressed', !pressed);
    expect(toggle.getProperty('pressed')).toBe(true);
    toggle.setProperty('pressed', !(toggle.getProperty('pressed') as boolean));
    expect(toggle.getProperty('pressed')).toBe(false);
  });

  it('Slider value changes on drag', () => {
    const slider = new Node('vol', 'Slider', {
      min_value: 0, max_value: 100, value: 0,
    });
    slider._computed = { x: 0, y: 0, width: 200, height: 20 };
    const t = 100 / 200;
    const newVal = 0 + t * (100 - 0);
    slider.setProperty('value', newVal);
    expect(slider.getProperty('value')).toBe(50);
  });

  it('FocusManager integrates with Tab key', () => {
    const fm = new FocusManager();
    const root = new Node('root', 'Node');
    const b1 = new Node('b1', 'Button', { focus_mode: 'click' });
    const b2 = new Node('b2', 'Button', { focus_mode: 'click' });
    root.addChild(b1);
    root.addChild(b2);

    fm.setFocus(b1);
    const next = fm.findNextFocus(b1, root, 1);
    expect(next?.id).toBe('b2');
  });
});
