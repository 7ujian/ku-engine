import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export function findCamera(tree: SceneTree): CameraState {
  const cam: CameraState = { x: 0, y: 0, zoom: 1 };
  tree.traverse((node) => {
    if (node.type === 'Camera2D') {
      cam.x = (node.getProperty('offset_x') as number) ?? 0;
      cam.y = (node.getProperty('offset_y') as number) ?? 0;
      cam.zoom = (node.getProperty('zoom') as number) ?? 1;
    }
  });
  return cam;
}

export function findCameraTarget(tree: SceneTree): Node | null {
  let target: Node | null = null;
  tree.traverse((node) => {
    if (node.type === 'Camera2D' && node.getProperty('target')) {
      const targetPath = node.getProperty('target') as string;
      try { target = tree.get(targetPath); } catch { /* ignore */ }
    }
  });
  return target;
}
