import { Node } from './node.js';
import { getWorldTransform, worldToLocalDirect } from './transform.js';

export class SceneTree {
  root: Node;
  private _nodeCount = 0;

  constructor(root?: Node) {
    this.root = root ?? new Node('root', 'Node');
  }

  get nodeCount(): number {
    if (this._nodeCount === 0) {
      this.traverse(() => { this._nodeCount++; });
    }
    return this._nodeCount;
  }

  get(path: string): Node {
    if (path === '/' || path === '') return this.root;
    const parts = path.split('/').filter(p => p.length > 0);
    let current = this.root;
    for (const part of parts) {
      const child = current.findChild(part);
      if (!child) throw new Error(`node not found: ${path}`);
      current = child;
    }
    return current;
  }

  add(path: string, node: Node): void {
    const parent = path === '/' || path === '' ? this.root : this.get(path);
    if (parent.findChild(node.id)) {
      throw new Error(`child already exists: ${node.id}`);
    }
    parent.addChild(node);
    this._nodeCount = 0;
  }

  remove(path: string): Node {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length === 0) throw new Error('cannot remove root');
    const childId = parts.pop()!;
    const parent = parts.length === 0 ? this.root : this.get(parts.join('/'));
    const removed = parent.removeChild(childId);
    if (!removed) throw new Error(`node not found: ${path}`);
    this._nodeCount = 0;
    return removed;
  }

  move(path: string, newParentPath: string): void {
    const node = this.get(path);
    const worldBefore = getWorldTransform(node);
    const hadPos = node.properties['x'] !== undefined || node.properties['y'] !== undefined;
    this.remove(path);
    this.add(newParentPath, node);
    if (hadPos) {
      const newParent = newParentPath === '/' || newParentPath === '' ? this.root : this.get(newParentPath);
      const parentWorld = getWorldTransform(newParent);
      const local = worldToLocalDirect(parentWorld, worldBefore.x, worldBefore.y);
      node.setProperty('x', local.x);
      node.setProperty('y', local.y);
    }
  }

  findByType(type: string): Node[] {
    const results: Node[] = [];
    this.traverse((node) => {
      if (node.type === type) results.push(node);
    });
    return results;
  }

  traverse(visitor: (node: Node, path: string) => void): void {
    const walk = (node: Node, path: string) => {
      visitor(node, path);
      for (const child of node.children) {
        walk(child, path === '/' ? `/${child.id}` : `${path}/${child.id}`);
      }
    };
    walk(this.root, '/');
  }

  clone(): SceneTree {
    return new SceneTree(this.root.clone());
  }
}
