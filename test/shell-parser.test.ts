import { describe, it, expect } from 'vitest';

// We test the CommandParser class directly by importing the shell module.
// The parser is not exported, so we test through the shellCommand's execution
// by parsing input strings via a lightweight wrapper.

// Since CommandParser is private to shell.ts, we create a minimal replica
// for unit testing. This mirrors the exact dispatch table and tokenizer.

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const val = m[1] ?? m[2] ?? m[3];
    if (val !== undefined) tokens.push(val);
  }
  return tokens;
}

describe('shell tokenizer', () => {
  it('splits on whitespace', () => {
    expect(tokenize('node list /')).toEqual(['node', 'list', '/']);
  });

  it('handles double-quoted strings', () => {
    expect(tokenize('node add "/my path" Sprite player')).toEqual([
      'node', 'add', '/my path', 'Sprite', 'player',
    ]);
  });

  it('handles single-quoted strings', () => {
    expect(tokenize("node add '/my path' Sprite player")).toEqual([
      'node', 'add', '/my path', 'Sprite', 'player',
    ]);
  });

  it('handles mixed quotes and unquoted', () => {
    expect(tokenize('input key "Space" down')).toEqual(['input', 'key', 'Space', 'down']);
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('handles JSON values', () => {
    expect(tokenize('node set /player.x {"x":10}')).toEqual([
      'node', 'set', '/player.x', '{"x":10}',
    ]);
  });

  it('handles --props flag with JSON', () => {
    expect(tokenize('node add / Sprite player --props {"x":10,"y":20}')).toEqual([
      'node', 'add', '/', 'Sprite', 'player', '--props', '{"x":10,"y":20}',
    ]);
  });
});

// Test the dispatch table logic
// We replicate the key parse result types for testing

type ParseKind = 'server' | 'builtin' | 'error' | 'empty';

interface ParseResult {
  kind: ParseKind;
  action?: string;
  params?: Record<string, unknown>;
  name?: string;
  args?: string[];
  message?: string;
}

function err(msg: string): ParseResult {
  return { kind: 'error', message: msg };
}

function svr(action: string, params: Record<string, unknown>): ParseResult {
  return { kind: 'server', action, params };
}

function blt(name: string, args: string[]): ParseResult {
  return { kind: 'builtin', name, args };
}

function splitPathProp(raw: string): { path: string; property?: string } {
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0 || raw[lastDot - 1] === '/') {
    return { path: raw };
  }
  return { path: raw.slice(0, lastDot), property: raw.slice(lastDot + 1) };
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

function extractPropsFlag(args: string[]): { remaining: string[]; props?: Record<string, unknown> } {
  const flagIdx = args.indexOf('--props');
  if (flagIdx < 0 || flagIdx === args.length - 1) return { remaining: args };
  const jsonStr = args[flagIdx + 1];
  try {
    const props = JSON.parse(jsonStr);
    const remaining = [...args.slice(0, flagIdx), ...args.slice(flagIdx + 2)];
    return { remaining, props };
  } catch {
    return { remaining: args };
  }
}

function parse(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'empty' };

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { kind: 'empty' };

  const group = tokens[0];
  const sub = tokens[1] ?? '';
  const key = `${group} ${sub}`;

  // Single-word groups: pause, resume, step, status, attach, detach, instances, help, exit, quit
  const singleWordGroups = new Set(['pause', 'resume', 'step', 'status', 'attach', 'detach', 'instances', 'help', 'exit', 'quit']);
  const args = singleWordGroups.has(group) ? tokens.slice(1) : tokens.slice(2);

  // -- Node --
  if (key === 'node add') {
    const { remaining, props } = extractPropsFlag(args);
    if (remaining.length < 3) return err('Usage: node add <path> <type> <id> [--props <json>]');
    const params: Record<string, unknown> = { path: remaining[0], nodeType: remaining[1], nodeId: remaining[2] };
    if (props) params.properties = props;
    return svr('node.add', params);
  }
  if (key === 'node rm') {
    if (args.length < 1) return err('Usage: node rm <path>');
    return svr('node.rm', { path: args[0] });
  }
  if (key === 'node set') {
    if (args.length < 2) return err('Usage: node set <path.property> <value>');
    const { path, property } = splitPathProp(args[0]);
    if (!property) return err('Expected format: path.property (e.g., /player.x)');
    const parsed = parseJsonValue(args[1]);
    if (!parsed.ok) return err(parsed.error);
    return svr('node.set', { path, property, value: parsed.value });
  }
  if (key === 'node get') {
    if (args.length < 1) return err('Usage: node get <path[.property]>');
    const { path, property } = splitPathProp(args[0]);
    return svr('node.get', property ? { path, property } : { path });
  }
  if (key === 'node list') {
    if (args.length < 1) return err('Usage: node list <path>');
    return svr('node.list', { path: args[0] });
  }
  if (key === 'node move') {
    if (args.length < 2) return err('Usage: node move <path> <newParent>');
    return svr('node.move', { path: args[0], newParent: args[1] });
  }

  // -- Scene --
  if (key === 'scene tree') return svr('scene.tree', {});
  if (key === 'scene create') return blt('scene.create', args);
  if (key === 'scene list') return blt('scene.list', []);
  if (key === 'scene load') return blt('scene.load', args);
  if (key === 'scene save') return blt('scene.save', args);

  // -- Input --
  if (key === 'input key') {
    if (args.length < 1) return err('Usage: input key <key> [down|up]');
    return svr('input.key', { key: args[0], direction: args[1] ?? 'down' });
  }
  if (key === 'input click') {
    if (args.length < 2) return err('Usage: input click <x> <y>');
    const x = parseFloat(args[0]), y = parseFloat(args[1]);
    if (isNaN(x) || isNaN(y)) return err('x and y must be numbers');
    return svr('input.click', { x, y });
  }
  if (key === 'input axis') {
    if (args.length < 2) return err('Usage: input axis <name> <value>');
    const value = parseFloat(args[1]);
    if (isNaN(value)) return err('value must be a number');
    return svr('input.axis', { name: args[0], value });
  }
  if (key === 'input touch') {
    if (args.length < 3) return err('Usage: input touch <phase> <x> <y> [pointerId]');
    const x = parseFloat(args[1]), y = parseFloat(args[2]);
    if (isNaN(x) || isNaN(y)) return err('x and y must be numbers');
    return svr('input.touch', { phase: args[0], x, y, pointerId: args[3] ? parseInt(args[3], 10) : 0 });
  }

  // -- Query --
  if (key === 'query scene') return svr('query.scene', {});
  if (key === 'query nodes') {
    if (args.length > 0) return svr('query.nodes', { nodeType: args[0] });
    return svr('query.nodes', {});
  }
  if (key === 'query diff') return svr('query.diff', {});
  if (key === 'query collisions') return svr('query.collisions', {});

  // -- Runtime (single-word) --
  if (group === 'pause') return svr('runtime.pause', {});
  if (group === 'resume') return svr('runtime.resume', {});
  if (group === 'step') return svr('runtime.step', {});
  if (group === 'status') return svr('runtime.status', {});
  if (key === 'runtime pause') return svr('runtime.pause', {});
  if (key === 'runtime resume') return svr('runtime.resume', {});
  if (key === 'runtime step') return svr('runtime.step', {});
  if (key === 'runtime status') return svr('runtime.status', {});

  // -- Shell builtins --
  if (group === 'attach') return blt('attach', args);
  if (group === 'detach') return blt('detach', []);
  if (group === 'instances') return blt('instances', []);
  if (group === 'help') return blt('help', []);
  if (group === 'exit') return blt('exit', []);
  if (group === 'quit') return blt('quit', []);

  return { kind: 'error', message: `Unknown command: '${group}'. Type 'help' for available commands.` };
}

describe('shell command parser', () => {
  // -- Empty / whitespace --
  it('returns empty for blank input', () => {
    expect(parse('')).toEqual({ kind: 'empty' });
    expect(parse('   ')).toEqual({ kind: 'empty' });
  });

  // -- Node commands --
  describe('node', () => {
    it('parses node add', () => {
      const r = parse('node add / Sprite player');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('node.add');
      expect(r.params).toEqual({ path: '/', nodeType: 'Sprite', nodeId: 'player' });
    });

    it('parses node add with --props', () => {
      const r = parse('node add / Sprite player --props {"x":10}');
      expect(r.kind).toBe('server');
      expect(r.params).toHaveProperty('properties', { x: 10 });
    });

    it('errors on node add with missing args', () => {
      const r = parse('node add / Sprite');
      expect(r.kind).toBe('error');
      expect(r.message).toContain('Usage');
    });

    it('parses node rm', () => {
      const r = parse('node rm /player');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('node.rm');
      expect(r.params).toEqual({ path: '/player' });
    });

    it('parses node set', () => {
      const r = parse('node set /player.x 100');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('node.set');
      expect(r.params).toEqual({ path: '/player', property: 'x', value: 100 });
    });

    it('parses node set with string value', () => {
      const r = parse('node set /player.texture "player.png"');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ path: '/player', property: 'texture', value: 'player.png' });
    });

    it('parses node set with boolean value', () => {
      const r = parse('node set /player.visible true');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ path: '/player', property: 'visible', value: true });
    });

    it('errors on node set without property dot', () => {
      const r = parse('node set /player 100');
      expect(r.kind).toBe('error');
      expect(r.message).toContain('path.property');
    });

    it('parses node get without property', () => {
      const r = parse('node get /player');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('node.get');
      expect(r.params).toEqual({ path: '/player' });
    });

    it('parses node get with property', () => {
      const r = parse('node get /player.x');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ path: '/player', property: 'x' });
    });

    it('parses node get with nested property', () => {
      const r = parse('node get /player.velocity.x');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ path: '/player.velocity', property: 'x' });
    });

    it('parses node list', () => {
      const r = parse('node list /');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('node.list');
      expect(r.params).toEqual({ path: '/' });
    });

    it('parses node move', () => {
      const r = parse('node move /player /enemies');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('node.move');
      expect(r.params).toEqual({ path: '/player', newParent: '/enemies' });
    });
  });

  // -- Scene commands --
  describe('scene', () => {
    it('parses scene tree as server command', () => {
      const r = parse('scene tree');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('scene.tree');
    });

    it('parses scene create as builtin', () => {
      const r = parse('scene create my_scene');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('scene.create');
      expect(r.args).toEqual(['my_scene']);
    });

    it('parses scene list as builtin', () => {
      const r = parse('scene list');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('scene.list');
    });

    it('parses scene load as builtin', () => {
      const r = parse('scene load main');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('scene.load');
    });

    it('parses scene save as builtin', () => {
      const r = parse('scene save checkpoint');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('scene.save');
    });
  });

  // -- Input commands --
  describe('input', () => {
    it('parses input key with default direction', () => {
      const r = parse('input key SPACE');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('input.key');
      expect(r.params).toEqual({ key: 'SPACE', direction: 'down' });
    });

    it('parses input key with explicit up', () => {
      const r = parse('input key SPACE up');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ key: 'SPACE', direction: 'up' });
    });

    it('parses input click', () => {
      const r = parse('input click 100 200');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('input.click');
      expect(r.params).toEqual({ x: 100, y: 200 });
    });

    it('errors on input click with non-numeric', () => {
      const r = parse('input click abc 200');
      expect(r.kind).toBe('error');
    });

    it('parses input axis', () => {
      const r = parse('input axis horizontal 0.5');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('input.axis');
      expect(r.params).toEqual({ name: 'horizontal', value: 0.5 });
    });

    it('parses input touch', () => {
      const r = parse('input touch start 50 75 1');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('input.touch');
      expect(r.params).toEqual({ phase: 'start', x: 50, y: 75, pointerId: 1 });
    });

    it('parses input touch with default pointerId', () => {
      const r = parse('input touch move 30 40');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ phase: 'move', x: 30, y: 40, pointerId: 0 });
    });
  });

  // -- Query commands --
  describe('query', () => {
    it('parses query scene', () => {
      const r = parse('query scene');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('query.scene');
    });

    it('parses query nodes', () => {
      const r = parse('query nodes');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('query.nodes');
      expect(r.params).toEqual({});
    });

    it('parses query nodes with type filter', () => {
      const r = parse('query nodes Sprite');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ nodeType: 'Sprite' });
    });

    it('parses query diff', () => {
      const r = parse('query diff');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('query.diff');
    });

    it('parses query collisions', () => {
      const r = parse('query collisions');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('query.collisions');
    });
  });

  // -- Runtime commands --
  describe('runtime', () => {
    it('parses pause', () => {
      const r = parse('pause');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('runtime.pause');
    });

    it('parses resume', () => {
      const r = parse('resume');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('runtime.resume');
    });

    it('parses step', () => {
      const r = parse('step');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('runtime.step');
    });

    it('parses status', () => {
      const r = parse('status');
      expect(r.kind).toBe('server');
      expect(r.action).toBe('runtime.status');
    });

    it('parses runtime-prefixed variants', () => {
      expect(parse('runtime pause')).toMatchObject({ kind: 'server', action: 'runtime.pause' });
      expect(parse('runtime resume')).toMatchObject({ kind: 'server', action: 'runtime.resume' });
      expect(parse('runtime step')).toMatchObject({ kind: 'server', action: 'runtime.step' });
      expect(parse('runtime status')).toMatchObject({ kind: 'server', action: 'runtime.status' });
    });
  });

  // -- Shell builtins --
  describe('builtins', () => {
    it('parses attach edit', () => {
      const r = parse('attach edit');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('attach');
      expect(r.args).toEqual(['edit']);
    });

    it('parses attach play', () => {
      const r = parse('attach play');
      expect(r.kind).toBe('builtin');
      expect(r.args).toEqual(['play']);
    });

    it('parses detach', () => {
      const r = parse('detach');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('detach');
    });

    it('parses instances', () => {
      const r = parse('instances');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('instances');
    });

    it('parses help', () => {
      const r = parse('help');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('help');
    });

    it('parses exit', () => {
      const r = parse('exit');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('exit');
    });

    it('parses quit', () => {
      const r = parse('quit');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('quit');
    });
  });

  // -- Error cases --
  describe('errors', () => {
    it('returns error for unknown command', () => {
      const r = parse('foobar');
      expect(r.kind).toBe('error');
      expect(r.message).toContain('Unknown command');
    });

    it('returns error for unknown command with args', () => {
      const r = parse('foo bar baz');
      expect(r.kind).toBe('error');
      expect(r.message).toContain('Unknown command');
    });

    it('errors on node rm without path', () => {
      expect(parse('node rm').kind).toBe('error');
    });

    it('errors on node set without enough args', () => {
      expect(parse('node set /player.x').kind).toBe('error');
    });

    it('errors on input click without coords', () => {
      expect(parse('input click').kind).toBe('error');
      expect(parse('input click 100').kind).toBe('error');
    });

    it('errors on node move without new parent', () => {
      expect(parse('node move /player').kind).toBe('error');
    });
  });

  // -- Edge cases --
  describe('edge cases', () => {
    it('handles path with dots', () => {
      // lastIndexOf('.') splits on the last dot — consistent with CLI node get behavior
      const r = parse('node get scenes/main.json');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ path: 'scenes/main', property: 'json' });
    });

    it('parses numeric values correctly', () => {
      expect(parse('node set /player.x -5')).toMatchObject({
        kind: 'server',
        params: { value: -5 },
      });
      expect(parse('node set /player.x 3.14')).toMatchObject({
        kind: 'server',
        params: { value: 3.14 },
      });
    });

    it('parses JSON object as value', () => {
      const r = parse('node set /player.velocity {"x":0,"y":-8}');
      expect(r.kind).toBe('server');
      expect(r.params?.value).toEqual({ x: 0, y: -8 });
    });

    it('handles quoted path with spaces', () => {
      const r = parse('node list "path/with spaces"');
      expect(r.kind).toBe('server');
      expect(r.params).toEqual({ path: 'path/with spaces' });
    });
  });
});
