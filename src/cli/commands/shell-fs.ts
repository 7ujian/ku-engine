import { createInterface } from 'node:readline';
import type { InstanceType } from '../../server/discovery.js';
import type { ShellSession } from './shell.js';

// ---------------------------------------------------------------------------
// Tiny parser for FS mode (simpler than the shell parser — no two-word keys)
// ---------------------------------------------------------------------------

interface FsServerResult {
  kind: 'server';
  action: string;
  params: Record<string, unknown>;
}

interface FsBuiltinResult {
  kind: 'builtin';
  name: string;
  args: string[];
}

interface FsErrorResult {
  kind: 'error';
  message: string;
}

type FsParseResult = FsServerResult | FsBuiltinResult | FsErrorResult | { kind: 'empty' };

type FsHandlerFn = (args: string[]) => FsParseResult;

class FsParser {
  private handlers = new Map<string, FsHandlerFn>();

  register(key: string, fn: FsHandlerFn): void {
    this.handlers.set(key, fn);
  }

  parse(input: string): FsParseResult {
    const trimmed = input.trim();
    if (!trimmed) return { kind: 'empty' };

    const tokens = this.tokenize(trimmed);
    if (tokens.length === 0) return { kind: 'empty' };

    const cmd = tokens[0];
    const handler = this.handlers.get(cmd);
    if (handler) return handler(tokens.slice(1));

    return { kind: 'error', message: `Unknown command: '${cmd}'. Type 'help' for available commands.` };
  }

  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const val = m[1] ?? m[2] ?? m[3];
      if (val !== undefined) tokens.push(val);
    }
    return tokens;
  }
}

function fErr(expected: string): FsErrorResult {
  return { kind: 'error', message: expected };
}

function fSvr(action: string, params: Record<string, unknown>): FsServerResult {
  return { kind: 'server', action, params };
}

function fBlt(name: string, args: string[]): FsBuiltinResult {
  return { kind: 'builtin', name, args };
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function parentPath(cwd: string): string {
  // If cwd contains a dot, it's a property chain — pop last segment
  const dotIdx = cwd.indexOf('.');
  if (dotIdx > 0) {
    const propChain = cwd.slice(dotIdx + 1);
    const lastDot = propChain.lastIndexOf('.');
    if (lastDot >= 0) return cwd.slice(0, dotIdx + 1 + lastDot);
    return cwd.slice(0, dotIdx); // back to node
  }
  // Node path — pop last / segment
  if (cwd === '/' || cwd === '') return '/';
  const lastSlash = cwd.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return cwd.slice(0, lastSlash);
}

function resolvePath(cwd: string, input: string): string {
  if (!input || input === '.') return cwd;
  if (input === '..') return parentPath(cwd);
  if (input.startsWith('/')) return input;

  // Relative: join cwd + / + input, then normalize segments
  const raw = cwd === '/' ? `/${input}` : `${cwd}/${input}`;
  const segments = raw.split('/').filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '..') out.pop();
    else if (seg !== '.') out.push(seg);
  }
  return '/' + out.join('/');
}

function parseJsonValue(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(raw) }; } catch { /* fall through */ }
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return { ok: true, value: num };
  if (raw === 'true') return { ok: true, value: true };
  if (raw === 'false') return { ok: true, value: false };
  if (raw === 'null') return { ok: true, value: null };
  return { ok: true, value: raw };
}

// ---------------------------------------------------------------------------
// FS help text
// ---------------------------------------------------------------------------

const FS_HELP = `
Filesystem mode commands:

  Navigation:
    cd <path>            Change working directory (/ for root, .. for parent)
    cd -                 Go to previous directory
    pwd                  Print working directory

  Listing:
    ls [path]            List children (nodes)
    ls -l [path]         Long format with key properties
    ls -a [path]         Include properties as entries

  Read/write:
    cat <path[.prop]>    Print node JSON or property value
    set <prop> <value>    Set property on current node
    touch <prop> [val]   Set property (default: "")

  Mutation:
    rm <path>            Remove node
    mv <src> <dst>       Move/reparent node
    mkdir <type> <id>    Create child node (Sprite, Label, etc.)

  Inspection:
    tree [path]          Print subtree
    find <type|*name*>   Search nodes
    stat [path]          Print node metadata

  Shell:
    help                 Show this help
    exit / quit          Return to normal shell
`;

// ---------------------------------------------------------------------------
// FsSession
// ---------------------------------------------------------------------------

export class FsSession {
  private parent: ShellSession;
  private cwd = '/';
  private prevCwd = '/';
  private rl: ReturnType<typeof createInterface> | null = null;
  private parser: FsParser;
  private sigintCount = 0;
  private sigintTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveExit: (() => void) | null = null;

  constructor(parent: ShellSession) {
    this.parent = parent;
    this.parser = this.buildParser();
  }

  async start(): Promise<void> {
    this.parent.pauseReadline();

    // Save and replace SIGINT handler for FS mode
    const prevListeners = process.listeners('SIGINT');
    process.removeAllListeners('SIGINT');

    const sigintHandler = () => {
      this.sigintCount++;
      if (this.sigintTimer) clearTimeout(this.sigintTimer);
      if (this.sigintCount >= 2) {
        console.log('');
        this.exitFs();
        return;
      }
      this.sigintTimer = setTimeout(() => { this.sigintCount = 0; }, 500);
      // readline clears the current line automatically
    };
    process.on('SIGINT', sigintHandler);

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 100,
    });

    return new Promise<void>((resolve) => {
      this.resolveExit = resolve;

      this.rl!.on('line', async (line: string) => {
        this.sigintCount = 0;
        const trimmed = line.trim();
        if (trimmed) {
          await this.execute(trimmed);
        }
        this.prompt();
      });

      this.rl!.on('close', () => {
        process.removeAllListeners('SIGINT');
        for (const fn of prevListeners) process.on('SIGINT', fn as (...args: any[]) => void);
        this.parent.resumeReadline();
        this.rl = null;
        resolve();
      });

      console.log('Entering filesystem mode. Type "exit" to return to normal shell.');
      this.prompt();
    });
  }

  private exitFs(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
      // resolveExit will be called by the 'close' handler
    }
  }

  private async execute(input: string): Promise<void> {
    const result = this.parser.parse(input);
    if (result.kind === 'empty') return;
    if (result.kind === 'error') {
      console.error(`Error: ${result.message}`);
      return;
    }

    if (result.kind === 'builtin') {
      await this.executeBuiltin(result.name, result.args);
      return;
    }

    try {
      const data = await this.parent.send(result.action, result.params);
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
    }
  }

  private async executeBuiltin(name: string, args: string[]): Promise<void> {
    switch (name) {
      case 'cd': {
        const target = args[0];
        if (!target) {
          this.cwd = '/';
          break;
        }
        if (target === '-') {
          if (this.prevCwd === this.cwd) {
            console.error('Error: no previous directory');
            return;
          }
          const tmp = this.cwd;
          this.cwd = this.prevCwd;
          this.prevCwd = tmp;
          console.log(this.cwd);
          break;
        }
        const resolved = resolvePath(this.cwd, target);
        // Validate the path exists by trying to get the node
        try {
          // Resolve node path (strip property chain for validation)
          const dotIdx = resolved.indexOf('.');
          const nodePath = dotIdx > 0 ? resolved.slice(0, dotIdx) : resolved;
          const data = await this.parent.send('node.get', { path: nodePath }) as { ok?: boolean; error?: string; type?: string };
          if (data && data.error) {
            console.error(`Error: ${data.error}`);
            return;
          }
          if (data && !data.ok && (data as any).ok === false) {
            console.error(`Error: node not found: ${nodePath}`);
            return;
          }
          this.prevCwd = this.cwd;
          this.cwd = resolved;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'pwd': {
        console.log(this.cwd);
        break;
      }
      case 'ls': {
        let listPath = this.cwd;
        let long = false;
        let all = false;
        const positional: string[] = [];
        for (const a of args) {
          if (a === '-l') long = true;
          else if (a === '-a') all = true;
          else if (a === '-la' || a === '-al') { long = true; all = true; }
          else positional.push(a);
        }
        if (positional.length > 0) listPath = resolvePath(this.cwd, positional[0]);
        // Resolve node path from property chain
        const dotIdx = listPath.indexOf('.');
        const nodePath = dotIdx > 0 ? listPath.slice(0, dotIdx) : listPath;

        try {
          // Get children
          const listData = await this.parent.send('node.list', { path: nodePath }) as { ok?: boolean; error?: string } | Array<{ id: string; type: string }>;
          if ((listData as any)?.error) {
            console.error(`Error: ${(listData as any).error}`);
            return;
          }
          const children = Array.isArray(listData) ? listData : [];
          // Get node info for long format
          let nodeData: any = null;
          if (long) {
            try {
              nodeData = await this.parent.send('node.get', { path: nodePath });
            } catch { /* ignore */ }
          }

          console.log(`  ${nodePath}/`);
          for (const child of children) {
            const prefix = '  ├── ';
            if (long && nodeData && (nodeData as any).data) {
              const fullNode = (nodeData as any).data;
              // Try to get child details for long format
              const childPath = nodePath === '/' ? `/${child.id}` : `${nodePath}/${child.id}`;
              try {
                const childData = await this.parent.send('node.get', { path: childPath }) as any;
                const props = childData?.data?.properties || {};
                const brief = Object.entries(props)
                  .filter(([, v]) => typeof v !== 'object' || v === null)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(', ');
                console.log(`${prefix}${child.id}/  (${child.type})${brief ? ' ' + brief : ''}`);
              } catch {
                console.log(`${prefix}${child.id}/  (${child.type})`);
              }
            } else {
              console.log(`${prefix}${child.id}/  (${child.type})`);
            }
          }

          if (all) {
            // List properties of the node
            try {
              const fullNode = await this.parent.send('node.get', { path: nodePath }) as any;
              const props = fullNode?.data?.properties || {};
              for (const [key, val] of Object.entries(props)) {
                if (typeof val === 'object' && val !== null) {
                  console.log(`  .${key} = ${JSON.stringify(val)}  (object)`);
                } else {
                  console.log(`  .${key} = ${JSON.stringify(val)}`);
                }
              }
            } catch { /* ignore */ }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'cat': {
        if (args.length < 1) {
          console.error('Usage: cat <path[.property]>');
          return;
        }
        let target = args[0];
        if (!target.startsWith('/') && !target.startsWith('.')) {
          // Resolve relative to cwd
          const dotIdx = target.indexOf('.');
          if (dotIdx < 0) {
            target = resolvePath(this.cwd, target);
          } else {
            const nodePart = resolvePath(this.cwd, target.slice(0, dotIdx));
            target = nodePart + target.slice(dotIdx);
          }
        }
        // Split into path + optional property
        const dotIdx = target.indexOf('.');
        const path = dotIdx > 0 ? target.slice(0, dotIdx) : target;
        const property = dotIdx > 0 ? target.slice(dotIdx + 1) : undefined;

        try {
          const params: Record<string, unknown> = { path };
          if (property) params.property = property;
          const data = await this.parent.send('node.get', params);
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'set': {
        if (args.length < 2) {
          console.error('Usage: set <prop> <value>');
          return;
        }
        const prop = args[0];
        const parsed = parseJsonValue(args[1]);
        if (!parsed.ok) {
          console.error(`Error: ${parsed.error}`);
          return;
        }
        const nodePath = this.cwd.indexOf('.') > 0 ? this.cwd.slice(0, this.cwd.indexOf('.')) : this.cwd;
        try {
          const data = await this.parent.send('node.set', {
            path: nodePath,
            property: prop,
            value: parsed.value,
          });
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'touch': {
        if (args.length < 1) {
          console.error('Usage: touch <prop> [value]');
          return;
        }
        const prop = args[0];
        let value: unknown = '';
        if (args.length > 1) {
          const parsed = parseJsonValue(args[1]);
          if (!parsed.ok) {
            console.error(`Error: ${parsed.error}`);
            return;
          }
          value = parsed.value;
        }
        const nodePath = this.cwd.indexOf('.') > 0 ? this.cwd.slice(0, this.cwd.indexOf('.')) : this.cwd;
        try {
          const data = await this.parent.send('node.set', {
            path: nodePath,
            property: prop,
            value,
          });
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'rm': {
        if (args.length < 1) {
          console.error('Usage: rm <path>');
          return;
        }
        const target = resolvePath(this.cwd, args[0]);
        const dotIdx = target.indexOf('.');
        if (dotIdx > 0) {
          // Removing a property — use node.set with null/undefined? No, properties can't be "removed" easily.
          // For now, just remove the node portion.
          console.error('Error: cannot remove a property. Use rm on a node path.');
          return;
        }
        if (target === '/' || target === '') {
          console.error('Error: cannot remove root');
          return;
        }
        try {
          const data = await this.parent.send('node.rm', { path: target });
          console.log(JSON.stringify(data, null, 2));
          // If we're inside the removed node, cd to parent
          if (this.cwd === target || this.cwd.startsWith(target + '/') || this.cwd.startsWith(target + '.')) {
            this.cwd = parentPath(target);
            console.log(`cd to ${this.cwd}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'mv': {
        if (args.length < 2) {
          console.error('Usage: mv <src> <dst>');
          return;
        }
        const src = resolvePath(this.cwd, args[0]);
        const dst = resolvePath(this.cwd, args[1]);
        try {
          const data = await this.parent.send('node.move', { path: src, newParent: dst });
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'mkdir': {
        if (args.length < 2) {
          console.error('Usage: mkdir <type> <id>');
          return;
        }
        const nodeType = args[0];
        const nodeId = args[1];
        try {
          const data = await this.parent.send('node.add', {
            path: this.cwd,
            nodeType,
            nodeId,
          });
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'tree': {
        const target = args.length > 0 ? resolvePath(this.cwd, args[0]) : this.cwd;
        const dotIdx = target.indexOf('.');
        const nodePath = dotIdx > 0 ? target.slice(0, dotIdx) : target;
        try {
          const data = await this.parent.send('scene.tree', {});
          // Print the full tree starting from the target node
          const root = (data as any)?.data?.root || (data as any)?.root;
          if (root) {
            printTree(root, nodePath);
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'find': {
        if (args.length < 1) {
          console.error('Usage: find <type|*name*>');
          return;
        }
        const query = args[0];
        // Try as type filter first, then as name wildcard
        if (query.includes('*')) {
          // Wildcard search — get full tree and filter manually
          try {
            const data = await this.parent.send('scene.tree', {}) as any;
            const root = data?.data?.root || data?.root;
            if (root) {
              findNodes(root, '/', query, []);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
          }
        } else {
          // Type search
          try {
            const data = await this.parent.send('query.nodes', { nodeType: query });
            console.log(JSON.stringify(data, null, 2));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
          }
        }
        break;
      }
      case 'stat': {
        const target = args.length > 0 ? resolvePath(this.cwd, args[0]) : this.cwd;
        const dotIdx = target.indexOf('.');
        const nodePath = dotIdx > 0 ? target.slice(0, dotIdx) : target;
        try {
          const data = await this.parent.send('node.get', { path: nodePath }) as any;
          const node = data?.data || data;
          if (node && node.type) {
            console.log(`  Path:     ${nodePath}`);
            console.log(`  Type:     ${node.type}`);
            console.log(`  Children: ${node.children?.length ?? 0}`);
            console.log(`  Scripts:  ${node.scripts?.length ?? 0}`);
            if (node.js_script) console.log(`  JS:       ${node.js_script}`);
            const props = node.properties ?? {};
            const keys = Object.keys(props);
            console.log(`  Props:    ${keys.length > 0 ? keys.join(', ') : '(none)'}`);
            if (keys.length > 0) {
              for (const [k, v] of Object.entries(props)) {
                const preview = typeof v === 'object' ? JSON.stringify(v) : String(v);
                console.log(`    .${k} = ${preview}`);
              }
            }
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'help': {
        console.log(FS_HELP);
        break;
      }
      case 'exit':
      case 'quit': {
        this.exitFs();
        break;
      }
    }
  }

  private prompt(): void {
    const inst = this.parent.getCurrentInstance();
    this.rl?.setPrompt(`ku:${inst} ${this.cwd}> `);
    this.rl?.prompt();
  }

  private buildParser(): FsParser {
    const p = new FsParser();
    p.register('cd', () => fBlt('cd', []));
    p.register('pwd', () => fBlt('pwd', []));
    p.register('ls', (args) => fBlt('ls', args));
    p.register('cat', (args) => fBlt('cat', args));
    p.register('set', (args) => fBlt('set', args));
    p.register('touch', (args) => fBlt('touch', args));
    p.register('rm', (args) => fBlt('rm', args));
    p.register('mv', (args) => fBlt('mv', args));
    p.register('mkdir', (args) => fBlt('mkdir', args));
    p.register('tree', (args) => fBlt('tree', args));
    p.register('find', (args) => fBlt('find', args));
    p.register('stat', (args) => fBlt('stat', args));
    p.register('help', () => fBlt('help', []));
    p.register('exit', () => fBlt('exit', []));
    p.register('quit', () => fBlt('quit', []));
    return p;
  }
}

// ---------------------------------------------------------------------------
// Tree printing helpers
// ---------------------------------------------------------------------------

function printTree(node: any, targetPath: string, indent = ''): void {
  const nodePath = '/' + (node.id === 'root' ? '' : node.id);
  const fullPath = node.id === 'root' ? '/' : nodePath;

  // Check if this node is in the target subtree
  if (targetPath !== '/' && targetPath !== '/root') {
    if (fullPath === targetPath || fullPath.startsWith(targetPath + '/') || targetPath.startsWith(fullPath + '/')) {
      // Print this node and continue
    } else if (fullPath === '/') {
      // Root is always printed, then we filter children
    } else {
      return; // skip
    }
  }

  const prefix = indent ? indent : '';
  console.log(`${prefix}${node.id}/  (${node.type})`);

  if (node.children && Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLast = i === node.children.length - 1;
      const childIndent = indent + (isLast ? '  └── ' : '  ├── ');
      const childPath = fullPath === '/' ? `/${child.id}` : `${fullPath}/${child.id}`;
      printTreeChild(child, childPath, targetPath, indent + (isLast ? '    ' : '  │ '));
    }
  }
}

function printTreeChild(node: any, nodePath: string, targetPath: string, indent: string): void {
  console.log(`${indent.slice(0, -2)}${indent.slice(-2) === '  ' ? '├── ' : '└── '}${node.id}/  (${node.type})`);

  if (node.children && Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLast = i === node.children.length - 1;
      const childPath = `${nodePath}/${child.id}`;
      const childIndent = indent + (isLast ? '  └── ' : '  ├── ');
      printTreeChild(child, childPath, targetPath, indent + (isLast ? '    ' : '  │ '));
    }
  }
}

function findNodes(node: any, path: string, query: string, results: string[]): void {
  const pattern = query.replace(/\*/g, '.*');
  const re = new RegExp(pattern, 'i');
  if (re.test(node.id) || re.test(node.type)) {
    console.log(`  ${path}  (${node.type})`);
  }
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const childPath = path === '/' ? `/${child.id}` : `${path}/${child.id}`;
      findNodes(child, childPath, query, results);
    }
  }
}
