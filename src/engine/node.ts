import type { NodeData, PropertyMap, ScriptRule } from './types.js';

export class Node {
  id: string;
  type: string;
  properties: PropertyMap;
  children: Node[];
  scripts: ScriptRule[];
  instance?: string;
  js_script?: string;
  parent: Node | null = null;

  constructor(id: string, type: string, properties?: PropertyMap) {
    this.id = id;
    this.type = type;
    this.properties = properties ?? {};
    this.children = [];
    this.scripts = [];
  }

  getProperty(name: string): unknown {
    return this.properties[name];
  }

  getPropertyByPath(dotPath: string): unknown {
    const parts = dotPath.split('.');
    let current: unknown = this.properties;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as PropertyMap)[part];
    }
    return current;
  }

  setProperty(name: string, value: unknown): void {
    this.properties[name] = value as PropertyMap[string];
  }

  setPropertyByPath(dotPath: string, value: unknown): void {
    const parts = dotPath.split('.');
    if (parts.length === 1) {
      this.properties[parts[0]] = value as PropertyMap[string];
      return;
    }
    let current = this.properties;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || typeof current[part] !== 'object') {
        current[part] = {} as PropertyMap[string];
      }
      current = current[part] as PropertyMap;
    }
    current[parts[parts.length - 1]] = value as PropertyMap[string];
  }

  addChild(node: Node): void {
    this.children.push(node);
    node.parent = this;
  }

  removeChild(id: string): Node | undefined {
    const index = this.children.findIndex(c => c.id === id);
    if (index === -1) return undefined;
    const removed = this.children.splice(index, 1)[0];
    removed.parent = null;
    return removed;
  }

  findChild(id: string): Node | undefined {
    return this.children.find(c => c.id === id);
  }

  toJSON(): NodeData {
    return {
      id: this.id,
      type: this.type,
      properties: { ...this.properties },
      ...(this.children.length > 0 ? { children: this.children.map(c => c.toJSON()) } : {}),
      scripts: this.scripts.map(s => ({ ...s, filter: s.filter ? { ...s.filter } : undefined, actions: [...s.actions] })),
      ...(this.instance ? { instance: this.instance } : {}),
      ...(this.js_script ? { js_script: this.js_script } : {}),
    };
  }

  static fromJSON(data: NodeData): Node {
    const node = new Node(data.id, data.type, { ...data.properties });
    node.children = (data.children ?? []).map(c => {
      const child = Node.fromJSON(c);
      child.parent = node;
      return child;
    });
    node.scripts = data.scripts ?? [];
    if (data.instance) node.instance = data.instance;
    if (data.js_script) node.js_script = data.js_script;
    return node;
  }

  clone(): Node {
    return Node.fromJSON(this.toJSON());
  }
}
