import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { FocusManager } from '../src/engine/focus.js';

describe('FocusManager', () => {
  it('starts with no focus', () => {
    const fm = new FocusManager();
    expect(fm.focusedNode).toBeNull();
  });

  it('setFocus updates focused node', () => {
    const fm = new FocusManager();
    const node = new Node('btn', 'Button', { focus_mode: 'click' });
    fm.setFocus(node);
    expect(fm.focusedNode).toBe(node);
  });

  it('setFocus rejects focus_mode=none', () => {
    const fm = new FocusManager();
    const node = new Node('panel', 'Panel', { focus_mode: 'none' });
    fm.setFocus(node);
    expect(fm.focusedNode).toBeNull();
  });

  it('clearFocus resets to null', () => {
    const fm = new FocusManager();
    const node = new Node('btn', 'Button', { focus_mode: 'click' });
    fm.setFocus(node);
    fm.clearFocus();
    expect(fm.focusedNode).toBeNull();
  });

  it('pushModal / popModal manages focus stack', () => {
    const fm = new FocusManager();
    const modal = new Node('dialog', 'Panel', { focus_mode: 'none', modal: true });
    const btn = new Node('ok', 'Button', { focus_mode: 'click' });
    modal.addChild(btn);

    fm.pushModal(modal);
    const outsideBtn = new Node('out', 'Button', { focus_mode: 'click' });
    fm.setFocus(outsideBtn);
    expect(fm.focusedNode).toBeNull();

    fm.setFocus(btn);
    expect(fm.focusedNode).toBe(btn);

    fm.popModal();
    fm.setFocus(outsideBtn);
    expect(fm.focusedNode).toBe(outsideBtn);
  });

  it('findNextFocus traverses tree order', () => {
    const fm = new FocusManager();
    const root = new Node('root', 'Node');
    const btn1 = new Node('b1', 'Button', { focus_mode: 'click' });
    const btn2 = new Node('b2', 'Button', { focus_mode: 'click' });
    const panel = new Node('p', 'Panel', { focus_mode: 'none' });
    const btn3 = new Node('b3', 'Button', { focus_mode: 'all' });
    root.addChild(btn1);
    root.addChild(panel);
    root.addChild(btn2);
    panel.addChild(btn3);

    const next = fm.findNextFocus(btn1, root, 1);
    expect(next?.id).toBe('b3');

    const next2 = fm.findNextFocus(btn3, root, 1);
    expect(next2?.id).toBe('b2');

    const next3 = fm.findNextFocus(btn2, root, 1);
    expect(next3?.id).toBe('b1');
  });
});
