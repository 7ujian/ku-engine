import { SceneTree } from '../engine/scene-tree.js';
import { Node } from '../engine/node.js';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

function isNodeInTree(node: Node, root: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

export function findCamera(tree: SceneTree, cached: { node: Node | null; cam: CameraState }): CameraState {
  if (cached.node && cached.node.type === 'Camera2D' && isNodeInTree(cached.node, tree.root)) {
    cached.cam.x = (cached.node.getProperty('offset_x') as number) ?? 0;
    cached.cam.y = (cached.node.getProperty('offset_y') as number) ?? 0;
    cached.cam.zoom = (cached.node.getProperty('zoom') as number) ?? 1;
    return cached.cam;
  }

  tree.traverse((node) => {
    if (node.type === 'Camera2D') {
      cached.node = node;
    }
  });

  if (cached.node) {
    cached.cam.x = (cached.node.getProperty('offset_x') as number) ?? 0;
    cached.cam.y = (cached.node.getProperty('offset_y') as number) ?? 0;
    cached.cam.zoom = (cached.node.getProperty('zoom') as number) ?? 1;
  } else {
    cached.cam.x = 0;
    cached.cam.y = 0;
    cached.cam.zoom = 1;
  }
  return cached.cam;
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
