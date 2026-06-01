import { describe, it, expect } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { hitTest } from '../src/engine/hit-test.js';
import type { CameraState } from '../src/renderer/camera.js';

const DEFAULT_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

describe('Control hit testing with _computed rects', () => {
  it('hits a Panel using _computed rect', () => {
    const tree = new SceneTree();
    const panel = new Node('p', 'Panel', { visible: true, clickable: true });
    panel._computed = { x: 50, y: 50, width: 100, height: 80 };
    tree.root.addChild(panel);

    const result = hitTest(tree, 100, 80, 800, 600, DEFAULT_CAM);
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('p');
  });

  it('misses when click outside _computed rect', () => {
    const tree = new SceneTree();
    const panel = new Node('p', 'Panel', { visible: true, clickable: true });
    panel._computed = { x: 50, y: 50, width: 100, height: 80 };
    tree.root.addChild(panel);

    const result = hitTest(tree, 30, 30, 800, 600, DEFAULT_CAM);
    expect(result).toBeNull();
  });

  it('hits Slider using _computed rect', () => {
    const tree = new SceneTree();
    const slider = new Node('vol', 'Slider', { visible: true, clickable: true });
    slider._computed = { x: 0, y: 0, width: 200, height: 20 };
    tree.root.addChild(slider);

    const result = hitTest(tree, 100, 10, 800, 600, DEFAULT_CAM);
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('vol');
  });

  it('hits nested Control inside container', () => {
    const tree = new SceneTree();
    const container = new Node('vbox', 'VBoxContainer', { visible: true });
    container._computed = { x: 0, y: 0, width: 200, height: 100 };
    const btn = new Node('btn', 'Button', { visible: true, clickable: true });
    btn._computed = { x: 0, y: 50, width: 200, height: 30 };
    container.addChild(btn);
    tree.root.addChild(container);

    const result = hitTest(tree, 100, 60, 800, 600, DEFAULT_CAM);
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('btn');
  });
});
