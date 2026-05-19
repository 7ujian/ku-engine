import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import { getAttachedInstance, setAttachedInstance } from './edit.js';
import { findInstancePort } from './instances.js';
import { makeMessage } from '../client.js';
import { readDiscovery, isAlive } from '../../server/discovery.js';
import { loadScene, saveScene, listScenes, sceneFilePath } from '../../engine/scene-file.js';
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

    return { kind: 'error', message: `Unknown command: '${group}'. Type 'help' for available commands.` };
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
// Shell session
// ---------------------------------------------------------------------------

const HELP = `
Available commands:

  Instance:
    attach <edit|play>   Connect to an instance
    detach               Disconnect from current instance
    instances            List running instances

  Node:
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

  Shell:
    help                 Show this help
    exit / quit          Exit the shell
`;

export async function shellCommand(projectDir: string, opts?: { command?: string }): Promise<void> {
  const session = new ShellSession(projectDir);
  if (opts?.command) {
    await session.connect();
    await session.execute(opts.command);
    session.shutdown();
    return;
  }
  await session.start();
}

class ShellSession {
  private projectDir: string;
  private currentInstance: InstanceType;
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private rl: ReturnType<typeof createInterface> | null = null;
  private parser: CommandParser;
  private sigintCount = 0;
  private sigintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.currentInstance = 'edit'; // default, will be set properly in start()
    this.parser = this.buildParser();
  }

  async start(): Promise<void> {
    this.currentInstance = await getAttachedInstance(this.projectDir);
    await this.connect();

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 100,
    });

    this.rl.on('line', async (line: string) => {
      this.sigintCount = 0;
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

    // Ctrl+C handling
    process.on('SIGINT', () => {
      this.sigintCount++;
      if (this.sigintTimer) clearTimeout(this.sigintTimer);
      if (this.sigintCount >= 2) {
        console.log('Goodbye.');
        this.shutdown();
        process.exit(0);
      }
      this.sigintTimer = setTimeout(() => { this.sigintCount = 0; }, 500);
      // readline clears the current line automatically
    });

    this.prompt();
  }

  async connect(): Promise<void> {
    try {
      const port = await findInstancePort(this.projectDir, this.currentInstance);
      this.ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connection timeout')), 5000);

        this.ws!.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.ws!.on('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });

        this.ws!.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'response' && this.pending.has(msg.id)) {
              const p = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              p.resolve(msg.payload);
            }
          } catch { /* ignore malformed messages */ }
        });

        this.ws!.on('close', () => {
          // Reject all pending
          for (const [, p] of this.pending) {
            p.reject(new Error('connection closed'));
          }
          this.pending.clear();
          this.ws = null;
        });
      });

      console.log(`Connected to ${this.currentInstance} instance.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: cannot connect to ${this.currentInstance} instance — ${msg}`);
      console.error(`Start it with 'ku edit' or 'ku play', then 'attach ${this.currentInstance}'.`);
      this.ws = null;
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
    await this.connect();
  }

  async send(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) {
      throw new Error('Not connected. Use attach <edit|play> to connect.');
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
      case 'attach': {
        const inst = args[0] as InstanceType | undefined;
        if (!inst || (inst !== 'edit' && inst !== 'play')) {
          console.error('Usage: attach <edit|play>');
          return;
        }
        await this.switchInstance(inst);
        break;
      }
      case 'detach': {
        this.disconnect();
        break;
      }
      case 'instances': {
        const disc = await readDiscovery(this.projectDir);
        for (const inst of ['edit', 'play'] as const) {
          const info = disc[inst];
          if (!info) {
            console.log(`${inst}:  stopped`);
          } else if (!isAlive(info.pid)) {
            console.log(`${inst}:  stopped (stale)`);
          } else {
            console.log(`${inst}:  running (pid=${info.pid}, port=${info.port})`);
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
      case 'scene.list': {
        const scenes = await listScenes(resolve(this.projectDir, 'scenes'));
        console.log(JSON.stringify(scenes, null, 2));
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error loading scene: ${msg}`);
        }
        break;
      }
      case 'scene.save': {
        const name = args[0];
        try {
          const data = await this.send('scene.tree', {}) as { root?: unknown } | undefined;
          if (data && (data as any).root) {
            const path = sceneFilePath(resolve(this.projectDir, 'scenes'), name || 'untitled');
            await mkdir(resolve(this.projectDir, 'scenes'), { recursive: true });
            const { writeFile: wf } = await import('node:fs/promises');
            const sceneFile = { scene: name ?? 'untitled', root: (data as any).root };
            await wf(path, JSON.stringify(sceneFile, null, 2) + '\n', 'utf-8');
            console.log(JSON.stringify({ saved: true, name: name || 'untitled' }));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error saving scene: ${msg}`);
        }
        break;
      }
    }
  }

  shutdown(): void {
    this.disconnect();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  private prompt(): void {
    const status = this.ws ? this.currentInstance : 'disconnected';
    this.rl?.setPrompt(`ku:${status}> `);
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

    // -- Shell builtins --
    p.register('attach', (args) => blt('attach', args));
    p.register('detach', () => blt('detach', []));
    p.register('instances', () => blt('instances', []));
    p.register('help', () => blt('help', []));
    p.register('exit', () => blt('exit', []));
    p.register('quit', () => blt('quit', []));

    return p;
  }
}
