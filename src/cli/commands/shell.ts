import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import { getAttachedInstance, setAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';
import { makeMessage } from '../client.js';
import { readDiscovery, isAlive, isPlayInstance, normalizePlayName, isValidInstanceName } from '../../server/discovery.js';
import { loadScene, saveScene, listSceneInfos, sceneFilePath } from '../../persistence/scene-io.js';
import type { InstanceType } from '../../server/discovery.js';

// ---------------------------------------------------------------------------
// Command parser
// ---------------------------------------------------------------------------

interface ServerResult {
  kind: 'server';
  action: string;
  params: Record<string, unknown>;
}

interface BuiltinResult {
  kind: 'builtin';
  name: string;
  args: string[];
}

interface ErrorResult {
  kind: 'error';
  message: string;
}

type ParseResult = ServerResult | BuiltinResult | ErrorResult | { kind: 'empty' };

type HandlerFn = (args: string[], projectDir: string) => ParseResult;

class CommandParser {
  private handlers = new Map<string, HandlerFn>();

  register(key: string, fn: HandlerFn): void {
    this.handlers.set(key, fn);
  }

  parse(input: string): ParseResult {
    const trimmed = input.trim();
    if (!trimmed) return { kind: 'empty' };

    const tokens = this.tokenize(trimmed);
    if (tokens.length === 0) return { kind: 'empty' };

    const group = tokens[0];
    const sub = tokens[1] ?? '';
    const key = `${group} ${sub}`;

    // Try two-word key first, then single-word key
    const handler = this.handlers.get(key) ?? this.handlers.get(group);
    if (handler) {
      const args = this.handlers.get(key) ? tokens.slice(2) : tokens.slice(1);
      return handler(args, '');
    }

    // Passthrough: unrecognized commands exec as CLI subcommand
    return { kind: 'builtin', name: group, args: sub ? [sub, ...tokens.slice(2)] : tokens.slice(1) };
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

function err(expected: string): ErrorResult {
  return { kind: 'error', message: expected };
}

function svr(action: string, params: Record<string, unknown>): ServerResult {
  return { kind: 'server', action, params };
}

function blt(name: string, args: string[]): BuiltinResult {
  return { kind: 'builtin', name, args };
}

// ---------------------------------------------------------------------------
// Dispatch table helpers
// ---------------------------------------------------------------------------

function splitPathProp(raw: string): { path: string; property?: string } {
  // Split on first dot so nested properties work (e.g. boss_hp_label.data.properties)
  const firstDot = raw.indexOf('.');
  if (firstDot <= 0 || raw[firstDot - 1] === '/') {
    return { path: raw };
  }
  return { path: raw.slice(0, firstDot), property: raw.slice(firstDot + 1) };
}

function parseJsonValue(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // Try JSON parse first
  try { return { ok: true, value: JSON.parse(raw) }; } catch { /* fall through */ }
  // Try as number
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return { ok: true, value: num };
  // Try boolean
  if (raw === 'true') return { ok: true, value: true };
  if (raw === 'false') return { ok: true, value: false };
  if (raw === 'null') return { ok: true, value: null };
  // Treat as string
  return { ok: true, value: raw };
}

function extractPropsFlag(args: string[]): { remaining: string[]; props?: Record<string, unknown> } {
  const flagIdx = args.indexOf('--props');
  if (flagIdx < 0 || flagIdx === args.length - 1) return { remaining: args };
  const jsonStr = args[flagIdx + 1];
  try {
    const props = JSON.parse(jsonStr);
    const remaining = [...args.slice(0, flagIdx), ...args.slice(flagIdx + 2)];
    return { remaining, props };
  } catch {
    return { remaining: args }; // bad JSON, let handler deal
  }
}

// ---------------------------------------------------------------------------
// FS helpers (path resolution, tree printing, etc.)
// ---------------------------------------------------------------------------

function resolvePropertyTarget(cwd: string, arg: string): { path: string; prop: string } | null {
  let tp: string;
  let tprop: string;
  if (arg.startsWith('.')) {
    tp = cwd.indexOf('.') > 0 ? cwd.slice(0, cwd.indexOf('.')) : cwd;
    tprop = arg.slice(1);
  } else {
    const target = resolveTarget(cwd, [arg]);
    if (target === null) return null;
    const td = target.indexOf('.');
    if (td <= 0) {
      console.error('Usage: <command> <path.prop> <value> — must specify a property');
      return null;
    }
    tp = target.slice(0, td);
    tprop = target.slice(td + 1);
  }
  return { path: tp, prop: tprop };
}

function parentPath(cwd: string): string {
  const dotIdx = cwd.indexOf('.');
  if (dotIdx > 0) {
    const propChain = cwd.slice(dotIdx + 1);
    const lastDot = propChain.lastIndexOf('.');
    if (lastDot >= 0) return cwd.slice(0, dotIdx + 1 + lastDot);
    return cwd.slice(0, dotIdx);
  }
  if (cwd === '/' || cwd === '') return '/';
  const lastSlash = cwd.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return cwd.slice(0, lastSlash);
}

function resolvePath(cwd: string, input: string): string {
  if (!input || input === '.') return cwd;
  if (input === '..') return parentPath(cwd);
  if (input.startsWith('/')) return input;
  const raw = cwd === '/' ? `/${input}` : `${cwd}/${input}`;
  const segments = raw.split('/').filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '..') out.pop();
    else if (seg !== '.') out.push(seg);
  }
  return '/' + out.join('/');
}

function resolveTarget(cwd: string, args: string[]): string | null {
  if (args.length < 1) {
    console.error('Usage: <command> <path[.property]>');
    return null;
  }
  let target = args[0];
  if (target === '.') return cwd;
  if (target === '..') return parentPath(cwd);
  if (target.startsWith('./')) return cwd === '/' ? target.slice(1) : cwd + target.slice(1);
  if (target.startsWith('../')) {
    const parent = parentPath(cwd);
    return parent === '/' ? '/' + target.slice(3) : parent + '/' + target.slice(3);
  }
  if (!target.startsWith('/') && !target.startsWith('.')) {
    const dotIdx = target.indexOf('.');
    if (dotIdx < 0) return resolvePath(cwd, target);
    const nodePart = resolvePath(cwd, target.slice(0, dotIdx));
    return nodePart + target.slice(dotIdx);
  }
  return target;
}

function formatValue(val: unknown): string {
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function dirName(name: string, childCount: number): string {
  return childCount > 0 ? `${BLUE}${name}${RESET}` : name;
}

function findNodeByPath(root: any, targetPath: string): any | null {
  if (targetPath === '/' || targetPath === '/root') return root;
  const parts = targetPath.split('/').filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (!current.children) return null;
    current = current.children.find((c: any) => c.id === part);
    if (!current) return null;
  }
  return current;
}

function printGnuTree(node: any, maxDepth: number = Infinity): void {
  const childCount = node.children?.length ?? 0;
  if (node.id === 'root') {
    console.log('/');
  } else {
    console.log(`${dirName(node.id, childCount)} (${node.type})`);
  }
  const counts = { dirs: 0, files: 0 };
  if (maxDepth <= 0) return;
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    const c = printGnuTreeChild(children[i], '', i === children.length - 1, maxDepth - 1);
    counts.dirs += c.dirs;
    counts.files += c.files;
  }
  const total = counts.dirs + counts.files;
  if (total > 0) {
    const dLabel = counts.dirs === 1 ? 'directory' : 'directories';
    const fLabel = counts.files === 1 ? 'file' : 'files';
    console.log(`\n${counts.dirs} ${dLabel}, ${counts.files} ${fLabel}`);
  }
}

function printGnuTreeChild(node: any, prefix: string, isLast: boolean, maxDepth: number): { dirs: number; files: number } {
  const childCount = node.children?.length ?? 0;
  const connector = isLast ? '└── ' : '├── ';
  console.log(`${prefix}${connector}${dirName(node.id, childCount)} (${node.type})`);
  const counts = { dirs: childCount > 0 ? 1 : 0, files: childCount > 0 ? 0 : 1 };
  if (maxDepth <= 0) return counts;
  const children = node.children || [];
  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  for (let i = 0; i < children.length; i++) {
    const c = printGnuTreeChild(children[i], childPrefix, i === children.length - 1, maxDepth - 1);
    counts.dirs += c.dirs;
    counts.files += c.files;
  }
  return counts;
}

export function autoGenId(type: string, existing: string[]): string {
  let n = 1;
  while (existing.includes(`${type}_${n}`)) n++;
  return `${type}_${n}`;
}

function findNodes(node: any, path: string, query: string, _results: string[]): void {
  const pattern = query.replace(/\*/g, '.*');
  const re = new RegExp(pattern, 'i');
  if (re.test(node.id) || re.test(node.type)) {
    console.log(`  ${path}  (${node.type})`);
  }
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const childPath = path === '/' ? `/${child.id}` : `${path}/${child.id}`;
      findNodes(child, childPath, query, _results);
    }
  }
}

// ---------------------------------------------------------------------------
// Shell session
// ---------------------------------------------------------------------------

const HELP = `
Available commands:

  Navigation:
    cd <path>            Change working directory (/ for root, .. for parent)
    cd -                 Go to previous directory
    pwd                  Print working directory

  Listing:
    ls [path]            List children names
    ls -l [path]         List with child count and type columns

  Read/write:
    cat <path[.prop]>    List node properties (or single prop value)
    get <path[.prop]>    Print node JSON (or single prop value)
    set <prop> <value>   Set property on current node
    touch <prop> [val]   Set property (default: "")

  Mutation:
    rm <path>            Remove node
    mv <src> <dst>       Move/reparent node
    mkdir <type> <id>    Create child node (Sprite, Label, etc.)

  Prefab:
    node new <type> [parent] [id] [props]    Create node from type (auto-id, parent=.)
    node instance <scene> [parent] [id] [props]  Instance scene as node
    node duplicate <path> [parent] [new-id]  Clone sub-tree
    node save <path> [scene-name]            Save sub-tree as scene

  Inspection:
    tree [-L N] [path]   Print subtree (limit depth with -L)
    find <type|*name*>   Search nodes
    stat [path]          Print node metadata

  Instance:
    edit <scene>         Load/replace scene in editor (alias: scene load)
    play [scene]         Launch play instance (loads scene, or entry scene if omitted)
    run                  Build and run standalone player
    attach <edit|playN>  Connect to an instance
    detach               Disconnect from current instance
    instances            List running instances

  Node (full paths):
    node add <path> <type> <id> [--props <json>]
    node rm <path>
    node set <path.property> <value>
    node get <path[.property]>
    node list <path>
    node move <path> <newParent>

  Scene:
    scene tree           Print current node tree
    scene create <name>  Create empty scene file
    scene list           List all scenes
    scene load <name>    Load scene into editor
    scene save [name]    Save editor state to file
    scene rm <name>      Delete a scene file

  Runtime:
    pause / runtime pause
    resume / runtime resume
    step / runtime step
    status / runtime status

  Input (play instance):
    input key <key> [down|up]
    input click <x> <y>
    input axis <name> <value>
    input touch <phase> <x> <y> [pointerId]

  Query:
    query scene          Full scene state as JSON
    query nodes [type]   List nodes, optionally filtered
    query diff           Frame-over-frame deltas
    query collisions     Active collision pairs
    query logs [--clear] Script engine log output
    query node <path>    Show node properties

  Plugin:
    plugin list          List installed plugins
    plugin install <pkg> Install plugin from npm
    plugin remove <name> Remove a plugin
    plugin create <name> Create new plugin scaffold
    plugin info <name>   Show plugin details
    plugin check <path>  Validate a plugin module
    plugin disable <n>   Disable plugin (keep files)
    plugin enable <n>    Re-enable disabled plugin

  Shell:
    help                 Show this help
    exit / quit          Exit the shell

  Tip: ku edit -i / ku play -i  Start instance with interactive shell
        ku play main --name play2  Launch specific scene with named instance
`;

export async function shellCommand(projectDir: string, opts?: { command?: string; scene?: string }): Promise<void> {
  const session = new ShellSession(projectDir);
  if (opts?.scene) session.setCurrentScene(opts.scene);
  if (opts?.command) {
    await session.connect();
    await session.execute(opts.command);
    session.shutdown();
    return;
  }
  await session.start();
}

export class ShellSession {
  private projectDir: string;
  private currentInstance: InstanceType;
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private rl: ReturnType<typeof createInterface> | null = null;
  private parser: CommandParser;
  private cwd = '/';
  private prevCwd = '/';
  private currentScene = '';
  private childPids: number[] = [];

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.currentInstance = 'edit'; // default, will be set properly in start()
    this.parser = this.buildParser();
  }

  getProjectDir(): string { return this.projectDir; }
  getCurrentInstance(): InstanceType { return this.currentInstance; }

  setCurrentScene(name: string): void { this.currentScene = name; }

  resolvePath(input: string): string {
    return resolvePath(this.cwd, input);
  }

  async start(): Promise<void> {
    this.currentInstance = await getAttachedInstance(this.projectDir);
    const connected = await this.connect();
    if (!connected) {
      console.log(`No instance running. Use 'play' or 'edit' to start, then 'attach'.`);
    }

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 100,
      completer: (line: string, cb: (err: any, result: [string[], string]) => void) => {
        this.complete(line).then(r => cb(null, r), err => cb(err, [[], line]));
      },
    });

    this.rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      if (trimmed) {
        await this.execute(trimmed);
      }
      this.prompt();
    });

    this.rl.on('close', () => {
      console.log('Goodbye.');
      this.shutdown();
      process.exit(0);
    });

    // Ctrl+C handling — first press closes readline (restores terminal),
    // second press within 1s exits. Prevents raw-mode leak.
    process.on('SIGINT', () => {
      if (!this.rl) {
        // Already closed — second Ctrl+C, exit immediately
        process.exit(0);
      }
      // First Ctrl+C: close readline to restore terminal, show hint
      this.rl.close();
      this.rl = null;
      process.stdout.write('^C\n(Press Ctrl+C again to exit)\n');

      const exitTimer = setTimeout(() => {
        // Timeout: restore readline and resume
        this.rl = createInterface({
          input: process.stdin,
          output: process.stdout,
          historySize: 100,
          completer: (line: string, cb: (err: any, result: [string[], string]) => void) => {
            this.complete(line).then(r => cb(null, r), err => cb(err, [[], line]));
          },
        });
        this.rl.on('line', async (line: string) => {
          const trimmed = line.trim();
          if (trimmed) await this.execute(trimmed);
          this.prompt();
        });
        this.rl.on('close', () => {
          console.log('Goodbye.');
          this.shutdown();
          process.exit(0);
        });
        this.prompt();
      }, 1000);
      exitTimer.unref();
    });

    this.prompt();
  }

  async connect(): Promise<boolean> {
    try {
      const port = await findInstancePort(this.projectDir, this.currentInstance);
      const ws = new WebSocket(`ws://localhost:${port}`);
      this.ws = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connection timeout')), 5000);

        ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });

        ws.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'response' && this.pending.has(msg.id)) {
              const p = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              p.resolve(msg.payload);
            }
          } catch { /* ignore malformed messages */ }
        });

        ws.on('close', () => {
          // Only clear if this is still the active socket (prevent race on reconnect)
          if (this.ws !== ws) return;
          for (const [, p] of this.pending) {
            p.reject(new Error('connection closed'));
          }
          this.pending.clear();
          this.ws = null;
          // Auto-fallback to edit when play instance dies
          if (isPlayInstance(this.currentInstance)) {
            console.log(`${this.currentInstance} instance disconnected.`);
            this.pruneChildPids();
            void this.switchInstance('edit');
          }
        });
      });

      console.log(`Connected to ${this.currentInstance} instance.`);

      // Fetch scene name for prompt
      try {
        const info = await this.send('instance.info', {});
        const scene = (info as any)?.data?.scene;
        if (scene) this.currentScene = scene;
      } catch { /* non-critical */ }

      return true;
    } catch {
      this.ws = null;
      return false;
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'user disconnected');
      this.ws = null;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error('disconnected'));
    }
    this.pending.clear();
    console.log(`Disconnected from ${this.currentInstance}.`);
  }

  async switchInstance(inst: InstanceType): Promise<void> {
    this.disconnect();
    setAttachedInstance(this.projectDir, inst);
    this.currentInstance = inst;
    const connected = await this.connect();
    if (!connected) {
      console.log(`'${inst}' instance is not running. Start it first.`);
    }
  }

  async send(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) {
      throw new Error('Not connected. Use attach <edit|playN> to connect.');
    }

    const msg = makeMessage(action, params);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(msg.id);
        reject(new Error('request timed out'));
      }, 10000);

      this.pending.set(msg.id, {
        resolve: (v: unknown) => { clearTimeout(timeout); resolve(v); },
        reject: (e: Error) => { clearTimeout(timeout); reject(e); },
      });

      try {
        this.ws!.send(JSON.stringify(msg));
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(msg.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async execute(input: string): Promise<void> {
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

    // Server command
    try {
      const data = await this.send(result.action, result.params);
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
    }
  }

  private async executeBuiltin(name: string, args: string[]): Promise<void> {
    switch (name) {
      case 'play': {
        const { fork } = await import('node:child_process');
        const { resolve } = await import('node:path');
        const { readDiscovery, isAlive } = await import('../../server/discovery.js');
        const { waitForInstance } = await import('./edit.js');

        const disc = await readDiscovery(this.projectDir);

        // Parse: play [scene] [--name <name>] [--watch]
        let scene: string | undefined;
        let playName: string | undefined;
        let doWatch = false;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--name' && args[i + 1]) { playName = normalizePlayName(args[++i]); }
          else if (args[i] === '--watch') { doWatch = true; }
          else if (!scene) { scene = args[i]; }
        }
        if (!playName) {
          playName = 'play1';
          for (let i = 1; i <= 100; i++) {
            const name = `play${i}`;
            const info = disc[name];
            if (!info || !isAlive(info.pid)) { playName = name; break; }
          }
        }

        // Spawn play instance (loads scene or entry scene)
        const srvPath = resolve(import.meta.dirname, '../../server/main.js');
        const forkArgs = ['--mode', playName, '--dir', this.projectDir, '--port', '0'];
        if (scene) forkArgs.push('--load-scene', scene);
        if (doWatch) forkArgs.push('--watch');
        const pl = fork(srvPath, forkArgs, { silent: true });
        if (pl.pid) this.childPids.push(pl.pid);
        pl.stderr?.on('data', (data: Buffer) => process.stderr.write(data));
        await waitForInstance(this.projectDir, playName, 5000, pl);
        await this.switchInstance(playName);
        break;
      }
      case 'run': {
        const { fork } = await import('node:child_process');
        const { resolve } = await import('node:path');
        const { existsSync } = await import('node:fs');

        const outputDir = resolve(this.projectDir, 'build');
        const playerPath = resolve(outputDir, 'runtime', 'dist', 'player', 'main.js');
        const gameDir = resolve(outputDir, 'game');

        if (!existsSync(playerPath)) {
          console.log('No build found. Building...');
          const { buildCommand } = await import('./build.js');
          await buildCommand(this.projectDir, outputDir);
        }

        console.log('Starting player...');
        const pl = fork(playerPath, [gameDir], { stdio: 'ignore' });
        if (pl.pid) this.childPids.push(pl.pid);
        break;
      }
      case 'attach': {
        const inst = args[0];
        if (!inst || !isValidInstanceName(inst)) {
          console.error('Usage: attach <edit|playN>');
          return;
        }
        await this.switchInstance(normalizePlayName(inst));
        break;
      }
      case 'detach': {
        this.disconnect();
        break;
      }
      case 'instances': {
        const disc = await readDiscovery(this.projectDir);
        const keys = Object.keys(disc).sort((a, b) => {
          if (a === 'edit') return -1;
          if (b === 'edit') return 1;
          return a.localeCompare(b, undefined, { numeric: true });
        });
        for (const inst of keys) {
          const info = disc[inst];
          if (!info) continue;
          if (!isAlive(info.pid)) {
            console.log(`${inst}:  stopped (stale)`);
          } else {
            console.log(`${inst}:  running (pid=${info.pid}, port=${info.port})`);
          }
        }
        break;
      }
      case 'plugin': {
        const sub = args[0];
        if (!sub) {
          console.log(HELP.split('\n').slice(13, 22).join('\n'));
          break;
        }
        switch (sub) {
          case 'list': {
            const { pluginListCommand } = await import('./plugin.js');
            await pluginListCommand(this.projectDir);
            break;
          }
          case 'install': {
            if (args.length < 2) { console.error('Usage: plugin install <package>'); break; }
            const { pluginInstallCommand } = await import('./plugin.js');
            await pluginInstallCommand(this.projectDir, args[1]);
            break;
          }
          case 'remove': {
            if (args.length < 2) { console.error('Usage: plugin remove <name>'); break; }
            const { pluginRemoveCommand } = await import('./plugin.js');
            await pluginRemoveCommand(this.projectDir, args[1]);
            break;
          }
          case 'create': {
            if (args.length < 2) { console.error('Usage: plugin create <name>'); break; }
            const { pluginCreateCommand } = await import('./plugin.js');
            await pluginCreateCommand(this.projectDir, args[1]);
            break;
          }
          case 'info': {
            if (args.length < 2) { console.error('Usage: plugin info <name>'); break; }
            const { pluginInfoCommand } = await import('./plugin.js');
            await pluginInfoCommand(this.projectDir, args[1]);
            break;
          }
          case 'check': {
            if (args.length < 2) { console.error('Usage: plugin check <path>'); break; }
            const { pluginCheckCommand } = await import('./plugin.js');
            await pluginCheckCommand(args[1]);
            break;
          }
          case 'disable': {
            if (args.length < 2) { console.error('Usage: plugin disable <name>'); break; }
            const { pluginDisableCommand } = await import('./plugin.js');
            await pluginDisableCommand(this.projectDir, args[1]);
            break;
          }
          case 'enable': {
            if (args.length < 2) { console.error('Usage: plugin enable <name>'); break; }
            const { pluginEnableCommand } = await import('./plugin.js');
            await pluginEnableCommand(this.projectDir, args[1]);
            break;
          }
          default: {
            console.error(`Unknown plugin subcommand: ${sub}. Type 'help' for available commands.`);
            break;
          }
        }
        break;
      }
      case 'help': {
        console.log(HELP);
        break;
      }
      case 'exit':
      case 'quit': {
        console.log('Goodbye.');
        this.shutdown();
        process.exit(0);
      }
      case 'edit': {
        if (args.length < 1) {
          console.error('Usage: edit <scene>');
          return;
        }
        if (this.currentInstance !== 'edit') await this.switchInstance('edit');
        const path = sceneFilePath(resolve(this.projectDir, 'scenes'), args[0]);
        const content = readFileSync(path, 'utf-8');
        const sceneData = JSON.parse(content);
        try {
          const data = await this.send('scene.load', { sceneData: sceneData.root });
          console.log(JSON.stringify(data, null, 2));
          this.currentScene = args[0];
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error loading scene: ${msg}`);
        }
        break;
      }
      case 'scene.create': {
        if (args.length < 1) {
          console.error('Usage: scene create <name>');
          return;
        }
        const tree = new (await import('../../engine/scene-tree.js')).SceneTree(
          new (await import('../../engine/node.js')).Node('root', 'Node'),
        );
        const path = sceneFilePath(resolve(this.projectDir, 'scenes'), args[0]);
        await saveScene(tree, path, args[0]);
        console.log(JSON.stringify({ created: args[0], path }));
        break;
      }
      case 'scene.rm': {
        if (args.length < 1) {
          console.error('Usage: scene rm <name>');
          return;
        }
        try {
          const { unlink } = await import('node:fs/promises');
          const path = sceneFilePath(resolve(this.projectDir, 'scenes'), args[0]);
          await unlink(path);
          console.log(JSON.stringify({ removed: args[0] }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error removing scene: ${msg}`);
        }
        break;
      }
      case 'scene.list': {
        const scenes = await listSceneInfos(resolve(this.projectDir, 'scenes'));
        for (const s of scenes) console.log(`${s.name.padEnd(30)} ${s.type}`);
        break;
      }
      case 'scene.load': {
        if (args.length < 1) {
          console.error('Usage: scene load <name>');
          return;
        }
        const path = sceneFilePath(resolve(this.projectDir, 'scenes'), args[0]);
        const content = readFileSync(path, 'utf-8');
        const sceneData = JSON.parse(content);
        try {
          const data = await this.send('scene.load', { sceneData: sceneData.root });
          console.log(JSON.stringify(data, null, 2));
          this.currentScene = args[0];
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error loading scene: ${msg}`);
        }
        break;
      }
      // -- FS navigation --
      case 'cd': {
        if (args.length === 0) { this.prevCwd = this.cwd; this.cwd = '/'; break; }
        let target = args[0];
        if (target === '-') {
          if (this.prevCwd === this.cwd) { console.error('Error: no previous directory'); break; }
          const tmp = this.cwd; this.cwd = this.prevCwd; this.prevCwd = tmp;
          console.log(this.cwd);
          break;
        }
        const resolved = resolvePath(this.cwd, target);
        try {
          const dotIdx = resolved.indexOf('.');
          const nodePath = dotIdx > 0 ? resolved.slice(0, dotIdx) : resolved;
          const data = await this.send('node.get', { path: nodePath }) as any;
          if (data?.ok === false) { console.error(`Error: ${data.error}`); break; }
          this.prevCwd = this.cwd;
          this.cwd = resolved;
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'pwd': { console.log(this.cwd); break; }
      case 'ls': {
        let listPath = this.cwd;
        let long = false;
        const positional: string[] = [];
        for (const a of args) {
          if (a === '-l' || a === '-la' || a === '-al') long = true;
          else positional.push(a);
        }
        if (positional.length > 0) listPath = resolvePath(this.cwd, positional[0]);
        const dotIdx = listPath.indexOf('.');
        const nodePath = dotIdx > 0 ? listPath.slice(0, dotIdx) : listPath;
        try {
          const resp = await this.send('node.list', { path: nodePath }) as any;
          if (resp?.error) { console.error(`Error: ${resp.error}`); break; }
          const children = resp?.data ?? [];
          if (long) {
            console.log(`total ${children.length}`);
            for (const child of children) {
              const cc = child.childCount ?? 0;
              console.log(`${String(cc).padStart(3)} ${child.type.padEnd(16)} ${dirName(child.id, cc)}`);
            }
          } else {
            const names = children.map((c: any) => dirName(c.id, c.childCount ?? 0));
            if (names.length > 0) console.log(names.join('  '));
          }
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'cat':
      case 'get': {
        const target = resolveTarget(this.cwd, args);
        if (target === null) break;
        if (target.startsWith('.') && target.length > 1 && target[1] !== '/') {
          const np = this.cwd.indexOf('.') > 0 ? this.cwd.slice(0, this.cwd.indexOf('.')) : this.cwd;
          try {
            const resp = await this.send('node.get', { path: np, property: target.slice(1) }) as any;
            if (resp?.ok === false) { console.error(`Error: ${resp.error}`); }
            else { console.log(formatValue(resp?.data?.value)); }
          } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
          break;
        }
        const td = target.indexOf('.');
        const tp = td > 0 ? target.slice(0, td) : target;
        const tprop = td > 0 ? target.slice(td + 1) : undefined;
        try {
          if (name === 'cat') {
            const resp = await this.send('node.get', { path: tp }) as any;
            if (resp?.ok === false) { console.error(`Error: ${resp.error}`); break; }
            const node = resp?.data;
            if (tprop) {
              console.log(formatValue(node?.properties?.[tprop]));
            } else {
              const props: Record<string, unknown> = node?.properties || {};
              const entries = Object.entries(props);
              if (entries.length === 0) { console.log('(no properties)'); }
              else { for (const [k, v] of entries) console.log(`.${k} = ${typeof v === 'object' && v !== null ? JSON.stringify(v) : JSON.stringify(v)}`); }
            }
          } else {
            const params: Record<string, unknown> = { path: tp };
            if (tprop) params.property = tprop;
            const resp = await this.send('node.get', params) as any;
            if (resp?.ok === false) { console.error(`Error: ${resp.error}`); }
            else {
              const d = resp?.data;
              if (tprop && d && 'value' in d) { console.log(formatValue(d.value)); }
              else { console.log(JSON.stringify(d, null, 2)); }
            }
          }
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'set': {
        if (args.length < 2) { console.error('Usage: set <path.prop> <value>'); break; }
        const parsed = parseJsonValue(args[1]);
        if (!parsed.ok) { console.error(`Error: ${parsed.error}`); break; }
        const target = resolvePropertyTarget(this.cwd, args[0]);
        if (!target) break;
        try {
          const data = await this.send('node.set', { path: target.path, property: target.prop, value: parsed.value });
          if ((data as any)?.ok === false) console.error(`Error: ${(data as any).error}`);
          else console.log(JSON.stringify(data, null, 2));
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'touch': {
        if (args.length < 1) { console.error('Usage: touch <path.prop> [value]'); break; }
        const val = args.length >= 2 ? parseJsonValue(args[1]) : { ok: true as const, value: '' };
        if (!val.ok) { console.error(`Error: ${val.error}`); break; }
        const target = resolvePropertyTarget(this.cwd, args[0]);
        if (!target) break;
        try {
          await this.send('node.set', { path: target.path, property: target.prop, value: val.value });
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'rm': {
        if (args.length < 1) { console.error('Usage: rm <path>'); break; }
        let target = resolvePath(this.cwd, args[0]);
        const td = target.indexOf('.');
        if (td > 0) { console.error('Error: cannot remove a property'); break; }
        if (target === '/' || target === '') { console.error('Error: cannot remove root'); break; }
        try {
          const data = await this.send('node.rm', { path: target });
          console.log(JSON.stringify(data, null, 2));
          if (this.cwd === target || this.cwd.startsWith(target + '/') || this.cwd.startsWith(target + '.')) {
            this.cwd = parentPath(target);
            console.log(`cd to ${this.cwd}`);
          }
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'mv': {
        if (args.length < 2) { console.error('Usage: mv <src> <dst>'); break; }
        const src = resolvePath(this.cwd, args[0]);
        const dst = resolvePath(this.cwd, args[1]);
        try {
          const data = await this.send('node.move', { path: src, newParent: dst });
          console.log(JSON.stringify(data, null, 2));
          if (this.cwd === src || this.cwd.startsWith(src + '/')) {
            this.cwd = dst + '/' + src.split('/').pop();
            console.log(`cd to ${this.cwd}`);
          }
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'mkdir': {
        if (args.length < 2) { console.error('Usage: mkdir <type> <id>'); break; }
        try {
          const data = await this.send('node.add', { path: this.cwd, nodeType: args[0], nodeId: args[1] });
          console.log(JSON.stringify(data, null, 2));
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'tree': {
        let maxDepth = Infinity;
        const positional: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-L' && i + 1 < args.length) {
            const lv = parseInt(args[i + 1], 10);
            if (!isNaN(lv) && lv >= 0) { maxDepth = lv; i++; }
          } else if (args[i].startsWith('-L')) {
            const lv = parseInt(args[i].slice(2), 10);
            if (!isNaN(lv) && lv >= 0) maxDepth = lv;
          } else { positional.push(args[i]); }
        }
        const target = positional.length > 0 ? resolvePath(this.cwd, positional[0]) : this.cwd;
        const td = target.indexOf('.');
        const nodePath = td > 0 ? target.slice(0, td) : target;
        try {
          const data = await this.send('scene.tree', {}) as any;
          const root = data?.data;
          if (root) {
            const targetNode = findNodeByPath(root, nodePath);
            if (targetNode) { printGnuTree(targetNode, maxDepth); }
            else { console.error(`Error: node not found: ${nodePath}`); }
          } else { console.log(JSON.stringify(data, null, 2)); }
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'find': {
        if (args.length < 1) { console.error('Usage: find <type|*name*>'); break; }
        const query = args[0];
        if (query.includes('*')) {
          try {
            const data = await this.send('scene.tree', {}) as any;
            const root = data?.data;
            if (root) findNodes(root, '/', query, []);
          } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        } else {
          try {
            const data = await this.send('query.nodes', { nodeType: query });
            console.log(JSON.stringify(data, null, 2));
          } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        }
        break;
      }
      case 'stat': {
        const target = args.length > 0 ? resolvePath(this.cwd, args[0]) : this.cwd;
        const td = target.indexOf('.');
        const nodePath = td > 0 ? target.slice(0, td) : target;
        try {
          const data = await this.send('node.get', { path: nodePath }) as any;
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
            if (keys.length > 0) { for (const [k, v] of Object.entries(props)) { console.log(`    .${k} = ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`); } }
          } else { console.log(JSON.stringify(data, null, 2)); }
        } catch (err) { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); }
        break;
      }
      case 'scene.save': {
        const name = args[0];
        try {
          const data = await this.send('scene.tree', {}) as { ok?: boolean; data?: unknown } | undefined;
          if (data?.data) {
            const path = sceneFilePath(resolve(this.projectDir, 'scenes'), name || 'untitled');
            await mkdir(resolve(this.projectDir, 'scenes'), { recursive: true });
            const { writeFile: wf } = await import('node:fs/promises');
            const sceneFile = { scene: name ?? 'untitled', root: data.data };
            await wf(path, JSON.stringify(sceneFile, null, 2) + '\n', 'utf-8');
            console.log(JSON.stringify({ saved: true, name: name || 'untitled' }));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error saving scene: ${msg}`);
        }
        break;
      }
      case 'node.new': {
        // Usage: node new <type> [parent] [id] [props]
        if (args.length < 1) {
          console.error('Usage: node new <type> [parent] [id] [props]');
          return;
        }
        const nodeType = args[0];
        if (nodeType.startsWith('/') || nodeType.startsWith('{') || nodeType.startsWith('[')) {
          console.error('First argument must be a type name, not a path or JSON');
          return;
        }
        let nodeId: string | undefined;
        let parentPath = '.';
        let inlineProps: Record<string, unknown> | undefined;
        let pathCount = 0;
        let propCount = 0;
        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith('/') || a === '.') {
            pathCount++;
            if (pathCount > 1) { console.error(`Unexpected path argument: ${a}`); return; }
            parentPath = a;
          } else if ((a.startsWith('{') || a.startsWith('['))) {
            propCount++;
            if (propCount > 1) { console.error(`Unexpected JSON argument: ${a}`); return; }
            try { inlineProps = JSON.parse(a); } catch { console.error(`Invalid JSON: ${a}`); return; }
          } else if (!nodeId) {
            nodeId = a;
          } else {
            console.error(`Unexpected argument: ${a}`);
            return;
          }
        }
        parentPath = this.resolvePath(parentPath);
        try {
          if (!nodeId) {
            const resp = await this.send('node.list', { path: parentPath }) as { ok?: boolean; data?: { id: string }[] };
            const existing = (resp?.data ?? []).map((c: { id: string }) => c.id);
            nodeId = autoGenId(nodeType, existing);
          }
          const params: Record<string, unknown> = { path: parentPath, nodeType, nodeId };
          if (inlineProps && Object.keys(inlineProps).length > 0) params.properties = inlineProps;
          const data = await this.send('node.add', params);
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'node.instance': {
        // Usage: node instance <scene> [parent] [id] [props]
        if (args.length < 1) {
          console.error('Usage: node instance <scene> [parent] [id] [props]');
          return;
        }
        const scenePath = args[0];
        if (scenePath.startsWith('/') || scenePath.startsWith('{') || scenePath.startsWith('[')) {
          console.error('First argument must be a scene name/path, not a path or JSON');
          return;
        }
        const defaultId = scenePath.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
        let nodeId: string | undefined;
        let parentPath = '.';
        let inlineProps: Record<string, unknown> | undefined;
        let pathCount = 0;
        let propCount = 0;
        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith('/') || a === '.') {
            pathCount++;
            if (pathCount > 1) { console.error(`Unexpected path argument: ${a}`); return; }
            parentPath = a;
          } else if ((a.startsWith('{') || a.startsWith('['))) {
            propCount++;
            if (propCount > 1) { console.error(`Unexpected JSON argument: ${a}`); return; }
            try { inlineProps = JSON.parse(a); } catch { console.error(`Invalid JSON: ${a}`); return; }
          } else if (!nodeId) {
            nodeId = a;
          } else {
            console.error(`Unexpected argument: ${a}`);
            return;
          }
        }
        parentPath = this.resolvePath(parentPath);
        if (!nodeId) nodeId = defaultId;
        try {
          // Read scene file to get root type
          let nodeType = 'Node';
          try {
            const p = sceneFilePath(resolve(this.projectDir, 'scenes'), scenePath);
            const raw = readFileSync(p, 'utf-8');
            const sceneData = JSON.parse(raw);
            if (sceneData?.root?.type) nodeType = sceneData.root.type;
          } catch { /* use default Node type */ }
          const properties: Record<string, unknown> = { instance: scenePath, ...(inlineProps ?? {}) };
          const data = await this.send('node.add', { path: parentPath, nodeType, nodeId, properties });
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'node.duplicate': {
        // Usage: node duplicate <path> [parent] [new-id]
        if (args.length < 1) {
          console.error('Usage: node duplicate <path> [parent] [new-id]');
          return;
        }
        const srcPath = args[0].startsWith('/') ? args[0] : this.resolvePath(args[0]);
        let newId: string | undefined;
        let parentPath: string | undefined;
        let pathCount = 0;
        for (let i = 1; i < args.length; i++) {
          if (args[i].startsWith('/') || args[i] === '.') {
            pathCount++;
            if (pathCount > 1) { console.error(`Unexpected path argument: ${args[i]}`); return; }
            parentPath = args[i];
          } else if (!newId) {
            newId = args[i];
          } else {
            console.error(`Unexpected argument: ${args[i]}`);
            return;
          }
        }
        try {
          // Get source info for defaults
          const srcData = await this.send('node.get', { path: srcPath }) as { ok?: boolean; data?: { id: string } };
          const srcId = srcData?.data?.id ?? srcPath.split('/').pop()!;
          if (!newId) newId = srcId + '_copy';
          if (!parentPath) {
            // Default to same parent
            const parts = srcPath.split('/');
            parts.pop();
            parentPath = parts.join('/') || '/';
          } else if (parentPath === '.') {
            parentPath = this.resolvePath('.');
          }
          const data = await this.send('node.duplicate', { path: srcPath, newId });
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
        }
        break;
      }
      case 'node.save': {
        // Usage: node save <path> [scene-name]
        if (args.length < 1) {
          console.error('Usage: node save <path> [scene-name]');
          return;
        }
        const savePath = this.resolvePath(args[0]);
        let sceneName: string | undefined;
        for (let i = 1; i < args.length; i++) {
          if (!sceneName && !args[i].startsWith('/') && args[i] !== '.') {
            sceneName = args[i];
          } else {
            console.error(`Unexpected argument: ${args[i]}`);
            return;
          }
        }
        if (!sceneName) sceneName = savePath.split('/').filter(Boolean).pop() ?? 'untitled';
        try {
          const data = await this.send('node.get', { path: savePath }) as { ok?: boolean; data?: unknown } | undefined;
          if (data?.data) {
            const rootData = data.data as Record<string, unknown>;
            const path = sceneFilePath(resolve(this.projectDir, 'scenes'), sceneName);
            await mkdir(resolve(this.projectDir, 'scenes'), { recursive: true });
            const { writeFile: wf } = await import('node:fs/promises');
            const sceneFile = { scene: sceneName, root: rootData };
            await wf(path, JSON.stringify(sceneFile, null, 2) + '\n', 'utf-8');
            console.log(JSON.stringify({ saved: true, name: sceneName, path }));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error saving node: ${msg}`);
        }
        break;
      }

      default: {
        // Passthrough: run as CLI command via ku binary
        const cliPath = resolve(import.meta.dirname, '../../bin/ku.js');
        const cmdArgs = [cliPath, ...name.split('.'), ...args, '--project', this.projectDir];
        try {
          const { execFile } = await import('node:child_process');
          const output = await new Promise<string>((resolve, reject) => {
            execFile('node', cmdArgs, { timeout: 30000 }, (err, stdout, stderr) => {
              const combined = (stdout + (stderr ? '\n' + stderr : '')).trim();
              if (err && !combined) reject(err);
              else resolve(combined);
            });
          });
          if (output) console.log(output);
        } catch (err) {
          console.error(`Unknown command: ${name}. Type 'help' for available commands.`);
        }
        break;
      }
    }
  }

  private pruneChildPids(): void {
    this.childPids = this.childPids.filter(pid => isAlive(pid));
  }

  shutdown(): void {
    this.disconnect();
    for (const pid of this.childPids) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
    }
    this.childPids.length = 0;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  // Tab completion for FS commands
  private async complete(line: string): Promise<[string[], string]> {
    const tokens = line.trim().split(/\s+/);
    const cmd = tokens[0] ?? '';
    const pathCommands = new Set(['cd', 'ls', 'cat', 'get', 'rm', 'mv', 'stat', 'tree']);
    const nonFlags = tokens.filter(t => !t.startsWith('-'));
    const lastArg = nonFlags[nonFlags.length - 1] ?? '';

    // Complete FS command names when no command typed yet or only first token
    if (tokens.length <= 1) {
      const fsCommands = ['cd', 'pwd', 'ls', 'cat', 'get', 'set', 'touch', 'rm', 'mv', 'mkdir', 'tree', 'find', 'stat', 'help', 'exit'];
      const hits = fsCommands.filter(c => c.startsWith(cmd));
      if (hits.length > 0) return [hits, cmd];
      return [[], line];
    }

    if (!pathCommands.has(cmd)) return [[], line];

    // Only complete up to second path argument
    if (nonFlags.length > 2) return [[], line];

    const partial = nonFlags.length <= 1 ? '' : lastArg;
    const dir = partial.includes('/') ? partial.slice(0, partial.lastIndexOf('/') + 1) : '';
    const prefix = partial.includes('/') ? partial.slice(partial.lastIndexOf('/') + 1) : partial;
    const baseDir = dir ? resolvePath(this.cwd, dir) : this.cwd;

    const dotIdx = baseDir.indexOf('.');
    const nodePath = dotIdx > 0 ? baseDir.slice(0, dotIdx) : baseDir;

    // Property completion for cat/get
    const propCommands = new Set(['cat', 'get']);
    if (propCommands.has(cmd) && partial.includes('.')) {
      const propDot = partial.lastIndexOf('.');
      const nodePart = partial.slice(0, propDot) || '.';
      const propPrefix = partial.slice(propDot + 1);
      let targetNode: string;
      if (nodePart === '.') {
        targetNode = this.cwd;
      } else if (nodePart === '..') {
        targetNode = parentPath(this.cwd);
      } else if (nodePart.startsWith('/')) {
        targetNode = nodePart;
      } else {
        targetNode = resolvePath(this.cwd, nodePart);
      }
      const tDot = targetNode.indexOf('.');
      const tPath = tDot > 0 ? targetNode.slice(0, tDot) : targetNode;
      try {
        const resp = await this.send('node.get', { path: tPath }) as any;
        const props = resp?.data?.properties || {};
        const propHits: string[] = [];
        const lcPropPrefix = propPrefix.toLowerCase();
        for (const key of Object.keys(props)) {
          if (key.toLowerCase().startsWith(lcPropPrefix)) {
            propHits.push(nodePart + '.' + key);
          }
        }
        if (propHits.length > 0) return [propHits, partial];
      } catch { /* fall through */ }
      return [[], line];
    }

    try {
      const resp = await this.send('node.list', { path: nodePath }) as any;
      if (resp?.error || !resp?.data) return [[], line];
      const children: Array<{ id: string }> = resp.data;
      const hits: string[] = [];
      const lcPrefix = prefix.toLowerCase();
      for (const child of children) {
        if (child.id.toLowerCase().startsWith(lcPrefix)) {
          hits.push(dir + child.id + '/');
        }
      }
      if (hits.length === 0) return [[], line];
      return [hits, partial];
    } catch {
      return [[], line];
    }
  }

  private prompt(): void {
    const status = this.ws ? this.currentInstance : 'disconnected';
    const scene = this.currentScene ? ` ${this.currentScene}` : '';
    this.rl?.setPrompt(`ku:${status}${scene} ${this.cwd}> `);
    this.rl?.prompt();
  }

  // -----------------------------------------------------------------------
  // Parser setup
  // -----------------------------------------------------------------------

  private buildParser(): CommandParser {
    const p = new CommandParser();

    // -- Node commands --
    p.register('node add', (args) => {
      const { remaining, props } = extractPropsFlag(args);
      if (remaining.length < 3) {
        return err('Usage: node add <path> <type> <id> [--props <json>]');
      }
      const params: Record<string, unknown> = {
        path: remaining[0],
        nodeType: remaining[1],
        nodeId: remaining[2],
      };
      if (props) params.properties = props;
      return svr('node.add', params);
    });

    p.register('node new', (args) => {
      if (args.length < 1) return err('Usage: node new <type> [parent] [id] [props]');
      return blt('node.new', args);
    });

    p.register('node instance', (args) => {
      if (args.length < 1) return err('Usage: node instance <scene> [parent] [id] [props]');
      return blt('node.instance', args);
    });

    p.register('node duplicate', (args) => {
      if (args.length < 1) return err('Usage: node duplicate <path> [parent] [new-id]');
      return blt('node.duplicate', args);
    });

    p.register('node save', (args) => {
      if (args.length < 1) return err('Usage: node save <path> [scene-name]');
      return blt('node.save', args);
    });

    p.register('node rm', (args) => {
      if (args.length < 1) return err('Usage: node rm <path>');
      return svr('node.rm', { path: args[0] });
    });

    p.register('node set', (args) => {
      if (args.length < 2) return err('Usage: node set <path.property> <value>');
      const { path, property } = splitPathProp(args[0]);
      if (!property) return err('Expected format: path.property (e.g., /player.x)');
      const parsed = parseJsonValue(args[1]);
      if (!parsed.ok) return err(parsed.error);
      return svr('node.set', { path, property, value: parsed.value });
    });

    p.register('node get', (args) => {
      if (args.length < 1) return err('Usage: node get <path[.property]>');
      const { path, property } = splitPathProp(args[0]);
      return svr('node.get', property ? { path, property } : { path });
    });

    p.register('node list', (args) => {
      if (args.length < 1) return err('Usage: node list <path>');
      return svr('node.list', { path: args[0] });
    });

    p.register('node move', (args) => {
      if (args.length < 2) return err('Usage: node move <path> <newParent>');
      return svr('node.move', { path: args[0], newParent: args[1] });
    });

    // -- Scene commands (server-bound) --
    p.register('scene tree', () => svr('scene.tree', {}));

    // Scene file ops (builtins)
    const sceneBuiltin = (name: string, args: string[]) => blt(`scene.${name}`, args);
    p.register('scene create', (args) => sceneBuiltin('create', args));
    p.register('scene list', () => sceneBuiltin('list', []));
    p.register('scene load', (args) => sceneBuiltin('load', args));
    p.register('scene save', (args) => sceneBuiltin('save', args));
    p.register('scene rm', (args) => sceneBuiltin('rm', args));

    // -- Input commands --
    p.register('input key', (args) => {
      if (args.length < 1) return err('Usage: input key <key> [down|up]');
      return svr('input.key', {
        key: args[0],
        direction: args[1] ?? 'down',
      });
    });

    p.register('input click', (args) => {
      if (args.length < 2) return err('Usage: input click <x> <y>');
      const x = parseFloat(args[0]);
      const y = parseFloat(args[1]);
      if (isNaN(x) || isNaN(y)) return err('x and y must be numbers');
      return svr('input.click', { x, y });
    });

    p.register('input axis', (args) => {
      if (args.length < 2) return err('Usage: input axis <name> <value>');
      const value = parseFloat(args[1]);
      if (isNaN(value)) return err('value must be a number');
      return svr('input.axis', { name: args[0], value });
    });

    p.register('input touch', (args) => {
      if (args.length < 3) return err('Usage: input touch <phase> <x> <y> [pointerId]');
      const x = parseFloat(args[1]);
      const y = parseFloat(args[2]);
      if (isNaN(x) || isNaN(y)) return err('x and y must be numbers');
      return svr('input.touch', {
        phase: args[0],
        x,
        y,
        pointerId: args[3] ? parseInt(args[3], 10) : 0,
      });
    });

    // -- Query commands --
    p.register('query scene', () => svr('query.scene', {}));
    p.register('query nodes', (args) => {
      if (args.length > 0) return svr('query.nodes', { nodeType: args[0] });
      return svr('query.nodes', {});
    });
    p.register('query diff', () => svr('query.diff', {}));
    p.register('query collisions', () => svr('query.collisions', {}));

    // -- Runtime commands (single-word aliases) --
    p.register('pause', () => svr('runtime.pause', {}));
    p.register('resume', () => svr('runtime.resume', {}));
    p.register('step', () => svr('runtime.step', {}));
    p.register('status', () => svr('runtime.status', {}));
    p.register('runtime pause', () => svr('runtime.pause', {}));
    p.register('runtime resume', () => svr('runtime.resume', {}));
    p.register('runtime step', () => svr('runtime.step', {}));
    p.register('runtime status', () => svr('runtime.status', {}));

    // -- FS commands --
    p.register('cd', (args) => blt('cd', args));
    p.register('pwd', () => blt('pwd', []));
    p.register('ls', (args) => blt('ls', args));
    p.register('cat', (args) => blt('cat', args));
    p.register('get', (args) => blt('get', args));
    p.register('set', (args) => blt('set', args));
    p.register('touch', (args) => blt('touch', args));
    p.register('rm', (args) => blt('rm', args));
    p.register('mv', (args) => blt('mv', args));
    p.register('mkdir', (args) => blt('mkdir', args));
    p.register('tree', (args) => blt('tree', args));
    p.register('find', (args) => blt('find', args));
    p.register('stat', (args) => blt('stat', args));

    // -- Shell builtins --
    p.register('edit', (args) => blt('edit', args));
    p.register('play', () => blt('play', []));
    p.register('run', () => blt('run', []));
    p.register('attach', (args) => blt('attach', args));
    p.register('detach', () => blt('detach', []));
    p.register('instances', () => blt('instances', []));
    p.register('plugin', (args) => blt('plugin', args));
    p.register('help', () => blt('help', []));
    p.register('exit', () => blt('exit', []));
    p.register('quit', () => blt('quit', []));

    return p;
  }
}
