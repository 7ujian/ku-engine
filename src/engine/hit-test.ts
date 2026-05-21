import { Node } from './node.js';
import { SceneTree } from './scene-tree.js';
import { getLocalTransform, composeTransform, IDENTITY, type Transform2D } from './transform.js';
import type { CameraState } from '../renderer/camera.js';

export interface HitResult {
  node: Node;
  localX: number;
  localY: number;
}

const GUI_TYPES = new Set(['Panel', 'Button', 'ImageRect', 'ScrollView']);
const DIMENSIONED_TYPES = new Set(['Block', 'RigidBody', 'CollisionShape', 'Area']);

function screenToWorld(
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  cam: CameraState,
): { x: number; y: number } {
  return {
    x: (screenX - screenW / 2) / cam.zoom + cam.x,
    y: (screenY - screenH / 2) / cam.zoom + cam.y,
  };
}

function pointInRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

function hitTestNode(
  node: Node,
  worldX: number,
  worldY: number,
  world: Transform2D,
): { hit: boolean; localX: number; localY: number } {
  const w = (node.getProperty('width') as number) ?? 0;
  const h = (node.getProperty('height') as number) ?? 0;
  if (w <= 0 || h <= 0) return { hit: false, localX: 0, localY: 0 };

  if (GUI_TYPES.has(node.type)) {
    const localX = worldX - world.x;
    const localY = worldY - world.y;
    return {
      hit: pointInRect(worldX, worldY, world.x, world.y, w * world.scaleX, h * world.scaleY),
      localX,
      localY,
    };
  }

  if (DIMENSIONED_TYPES.has(node.type)) {
    const localX = worldX - world.x;
    const localY = worldY - world.y;
    return {
      hit: pointInRect(
        worldX, worldY,
        world.x - (w * world.scaleX) / 2,
        world.y - (h * world.scaleY) / 2,
        w * world.scaleX,
        h * world.scaleY,
      ),
      localX,
      localY,
    };
  }

  return { hit: false, localX: 0, localY: 0 };
}

function scrollViewChildTransform(parentWorld: Transform2D, svNode: Node): Transform2D {
  const scrollX = (svNode.getProperty('scroll_x') as number) ?? 0;
  const scrollY = (svNode.getProperty('scroll_y') as number) ?? 0;
  const zoom = (svNode.getProperty('zoom') as number) ?? 1;

  // Children are in ScrollView local coords: translate(wx,wy), scale(zoom), translate(-scrollX,-scrollY)
  // Relative to parent: position = (wx, wy) + zoom * (child_local - scroll)
  return {
    x: parentWorld.x - scrollX * zoom * parentWorld.scaleX,
    y: parentWorld.y - scrollY * zoom * parentWorld.scaleY,
    rotation: parentWorld.rotation,
    scaleX: parentWorld.scaleX * zoom,
    scaleY: parentWorld.scaleY * zoom,
  };
}

function hitTestRecursive(
  node: Node,
  parentWorld: Transform2D,
  screenX: number,
  screenY: number,
): HitResult | null {
  const visible = node.getProperty('visible');
  if (visible === false) return null;

  const local = getLocalTransform(node);
  const world = composeTransform(parentWorld, local);

  // Check children first (reverse order — last child renders on top)
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    const childParent = node.type === 'ScrollView'
      ? scrollViewChildTransform(world, node)
      : world;
    const result = hitTestRecursive(child, childParent, screenX, screenY);
    if (result) return result;
  }

  // Check this node
  if (node.getProperty('clickable') === true) {
    const test = hitTestNode(node, screenX, screenY, world);
    if (test.hit) {
      return { node, localX: test.localX, localY: test.localY };
    }
  }

  return null;
}

/**
 * Hit test: checks GUI nodes in screen space first, then game nodes in world space.
 * GUI nodes are direct children of root with GUI types — rendered in screen space.
 * Game nodes use camera-transformed world coordinates.
 */
export function hitTest(
  tree: SceneTree,
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  cam: CameraState,
): HitResult | null {
  // Pass 1: GUI nodes (screen space, no camera transform)
  for (let i = tree.root.children.length - 1; i >= 0; i--) {
    const child = tree.root.children[i];
    if (!GUI_TYPES.has(child.type)) continue;
    const result = hitTestRecursive(child, IDENTITY, screenX, screenY);
    if (result) return result;
  }

  // Pass 2: Game nodes (world space with camera transform)
  const world = screenToWorld(screenX, screenY, screenW, screenH, cam);
  for (let i = tree.root.children.length - 1; i >= 0; i--) {
    const child = tree.root.children[i];
    if (GUI_TYPES.has(child.type)) continue;
    const result = hitTestRecursive(child, IDENTITY, world.x, world.y);
    if (result) return result;
  }

  return null;
}
