import { Node } from './node.js';

export class SceneTree {
  root: Node;

  constructor(root?: Node) {
    this.root = root ?? new Node('root', 'Node');
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
  }

  remove(path: string): Node {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length === 0) throw new Error('cannot remove root');
    const childId = parts.pop()!;
    const parent = parts.length === 0 ? this.root : this.get(parts.join('/'));
    const removed = parent.removeChild(childId);
    if (!removed) throw new Error(`node not found: ${path}`);
    return removed;
  }

  move(path: string, newParentPath: string): void {
    const node = this.remove(path);
    this.add(newParentPath, node);
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
