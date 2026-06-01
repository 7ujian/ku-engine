import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { ScriptEngine } from '../src/engine/script-engine.js';

describe('ScriptEngine UI events', () => {
  it('on_mouse_enter fires when cursor enters node', () => {
    const tree = new SceneTree();
    const engine = new ScriptEngine(tree);
    const panel = new Node('p', 'Panel', { visible: true });
    panel.scripts = [{
      event: 'on_mouse_enter',
      actions: [{ set: 'hovered', to: true }],
    }];
    tree.root.addChild(panel);
    engine.registerTree();

    engine.evaluateEvent('on_mouse_enter', { node: 'p' });
    expect(panel.getProperty('hovered')).toBe(true);
  });

  it('on_mouse_exit fires when cursor leaves node', () => {
    const tree = new SceneTree();
    const engine = new ScriptEngine(tree);
    const panel = new Node('p', 'Panel', { visible: true, hovered: true });
    panel.scripts = [{
      event: 'on_mouse_exit',
      actions: [{ set: 'hovered', to: false }],
    }];
    tree.root.addChild(panel);
    engine.registerTree();

    engine.evaluateEvent('on_mouse_exit', { node: 'p' });
    expect(panel.getProperty('hovered')).toBe(false);
  });

  it('on_gui_input receives any input while node is hovered', () => {
    const tree = new SceneTree();
    const engine = new ScriptEngine(tree);
    const panel = new Node('p', 'Panel', { visible: true });
    panel.scripts = [{
      event: 'on_gui_input',
      actions: [{ set: 'last_input', to: 'click' }],
    }];
    tree.root.addChild(panel);
    engine.registerTree();

    engine.evaluateEvent('on_gui_input', { node: 'p', input_type: 'click' });
    expect(panel.getProperty('last_input')).toBe('click');
  });
});
