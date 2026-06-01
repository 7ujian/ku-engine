import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { isControlType } from '../src/engine/anchor.js';

describe('Rendering pipeline classification', () => {
  it('Control types are recognized', () => {
    expect(isControlType('Panel')).toBe(true);
    expect(isControlType('Button')).toBe(true);
    expect(isControlType('Slider')).toBe(true);
    expect(isControlType('VBoxContainer')).toBe(true);
    expect(isControlType('CanvasLayer')).toBe(false);
    expect(isControlType('Sprite')).toBe(false);
  });

  it('CanvasLayer nodes are distinct from Controls', () => {
    const layer = new Node('hud', 'CanvasLayer', { layer: 1 });
    expect(layer.type).toBe('CanvasLayer');
    expect(isControlType(layer.type)).toBe(false);
  });
});
