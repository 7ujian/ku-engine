import { Node } from './node.js';

export interface Transform2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export const IDENTITY: Transform2D = Object.freeze({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

export function getLocalTransform(node: Node): Transform2D {
  const x = node.getProperty('x') as number | undefined;
  if (x === undefined) return { ...IDENTITY };
  return {
    x,
    y: (node.getProperty('y') as number) ?? 0,
    rotation: (node.getProperty('rotation') as number) ?? 0,
    scaleX: (node.getProperty('scale_x') as number) ?? 1,
    scaleY: (node.getProperty('scale_y') as number) ?? 1,
  };
}

export function composeTransform(parent: Transform2D, local: Transform2D): Transform2D {
  const cosR = Math.cos(parent.rotation);
  const sinR = Math.sin(parent.rotation);
  return {
    x: parent.x + cosR * local.x * parent.scaleX - sinR * local.y * parent.scaleY,
    y: parent.y + sinR * local.x * parent.scaleX + cosR * local.y * parent.scaleY,
    rotation: parent.rotation + local.rotation,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY,
  };
}

export function getWorldTransform(node: Node): Transform2D {
  const chain: Node[] = [];
  let current: Node | null = node;
  while (current !== null) {
    chain.push(current);
    current = current.parent;
  }
  let result: Transform2D = { ...IDENTITY };
  for (let i = chain.length - 1; i >= 0; i--) {
    result = composeTransform(result, getLocalTransform(chain[i]));
  }
  return result;
}

export function localToWorld(node: Node, localX: number, localY: number): { x: number; y: number } {
  const world = getWorldTransform(node);
  const cosR = Math.cos(world.rotation);
  const sinR = Math.sin(world.rotation);
  return {
    x: world.x + cosR * localX * world.scaleX - sinR * localY * world.scaleY,
    y: world.y + sinR * localX * world.scaleX + cosR * localY * world.scaleY,
  };
}

export function worldToLocal(node: Node, worldX: number, worldY: number): { x: number; y: number } {
  const parent = node.parent;
  if (!parent) return { x: worldX, y: worldY };
  const parentWorld = getWorldTransform(parent);
  return worldToLocalDirect(parentWorld, worldX, worldY);
}

export function worldToLocalDirect(parentWorld: Transform2D, worldX: number, worldY: number): { x: number; y: number } {
  const dx = worldX - parentWorld.x;
  const dy = worldY - parentWorld.y;
  const cosR = Math.cos(-parentWorld.rotation);
  const sinR = Math.sin(-parentWorld.rotation);
  return {
    x: (cosR * dx - sinR * dy) / parentWorld.scaleX,
    y: (sinR * dx + cosR * dy) / parentWorld.scaleY,
  };
}
