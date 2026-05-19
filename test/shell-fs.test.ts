import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicated helpers (same logic as shell-fs.ts)
// ---------------------------------------------------------------------------

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

// FS parser replica
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

type ParseKind = 'server' | 'builtin' | 'error' | 'empty';

interface ParseResult {
  kind: ParseKind;
  action?: string;
  params?: Record<string, unknown>;
  name?: string;
  args?: string[];
  message?: string;
}

function fErr(msg: string): ParseResult {
  return { kind: 'error', message: msg };
}

function fBlt(name: string, args: string[]): ParseResult {
  return { kind: 'builtin', name, args };
}

function parse(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'empty' };

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { kind: 'empty' };

  const cmd = tokens[0];
  const args = tokens.slice(1);

  switch (cmd) {
    case 'cd':
    case 'pwd':
    case 'help':
    case 'exit':
    case 'quit':
      return fBlt(cmd, args);

    case 'ls':
      return fBlt('ls', args);
    case 'cat':
      return fBlt('cat', args);
    case 'set':
      return fBlt('set', args);
    case 'touch':
      return fBlt('touch', args);
    case 'rm':
      return fBlt('rm', args);
    case 'mv':
      return fBlt('mv', args);
    case 'mkdir':
      return fBlt('mkdir', args);
    case 'tree':
      return fBlt('tree', args);
    case 'find':
      return fBlt('find', args);
    case 'stat':
      return fBlt('stat', args);

    default:
      return { kind: 'error', message: `Unknown command: '${cmd}'. Type 'help' for available commands.` };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FS path resolution', () => {
  describe('parentPath', () => {
    it('goes up from child node', () => {
      expect(parentPath('/player/sprite')).toBe('/player');
    });
    it('goes up from root child', () => {
      expect(parentPath('/player')).toBe('/');
    });
    it('stays at root', () => {
      expect(parentPath('/')).toBe('/');
    });
    it('goes up from property chain', () => {
      expect(parentPath('/player.velocity.x')).toBe('/player.velocity');
    });
    it('goes up from single property to node', () => {
      expect(parentPath('/player.velocity')).toBe('/player');
    });
    it('goes up from deeply nested node', () => {
      expect(parentPath('/a/b/c/d')).toBe('/a/b/c');
    });
  });

  describe('resolvePath', () => {
    it('empty input returns cwd', () => {
      expect(resolvePath('/player', '')).toBe('/player');
    });
    it('dot returns cwd', () => {
      expect(resolvePath('/player', '.')).toBe('/player');
    });
    it('double dot goes to parent', () => {
      expect(resolvePath('/player/sprite', '..')).toBe('/player');
    });
    it('double dot from root stays at root', () => {
      expect(resolvePath('/', '..')).toBe('/');
    });
    it('absolute path ignores cwd', () => {
      expect(resolvePath('/player', '/enemy_0')).toBe('/enemy_0');
    });
    it('relative child resolves from cwd', () => {
      expect(resolvePath('/player', 'sprite')).toBe('/player/sprite');
    });
    it('relative child from root', () => {
      expect(resolvePath('/', 'player')).toBe('/player');
    });
    it('dot-slash relative', () => {
      expect(resolvePath('/player', './sprite')).toBe('/player/sprite');
    });
    it('parent-relative sibling', () => {
      expect(resolvePath('/player/sprite', '../enemy_0')).toBe('/player/enemy_0');
    });
    it('multiple segments', () => {
      expect(resolvePath('/', 'a/b/c')).toBe('/a/b/c');
    });
    it('normalizes .. segments', () => {
      expect(resolvePath('/a/b', '../c')).toBe('/a/c');
    });
    it('normalizes redundant ..', () => {
      expect(resolvePath('/a/b', '../../..')).toBe('/');
    });
  });
});

describe('FS parser', () => {
  it('returns empty for blank input', () => {
    expect(parse('')).toEqual({ kind: 'empty' });
    expect(parse('   ')).toEqual({ kind: 'empty' });
  });

  describe('cd', () => {
    it('parses cd with path', () => {
      const r = parse('cd /player');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('cd');
      expect(r.args).toEqual(['/player']);
    });
    it('parses cd with relative path', () => {
      const r = parse('cd player');
      expect(r.args).toEqual(['player']);
    });
    it('parses cd with no args (go to root)', () => {
      const r = parse('cd');
      expect(r.kind).toBe('builtin');
      expect(r.args).toEqual([]);
    });
    it('parses cd ..', () => {
      const r = parse('cd ..');
      expect(r.args).toEqual(['..']);
    });
    it('parses cd -', () => {
      const r = parse('cd -');
      expect(r.args).toEqual(['-']);
    });
  });

  describe('pwd', () => {
    it('parses pwd', () => {
      const r = parse('pwd');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('pwd');
    });
  });

  describe('ls', () => {
    it('parses ls with no args', () => {
      const r = parse('ls');
      expect(r.kind).toBe('builtin');
      expect(r.name).toBe('ls');
      expect(r.args).toEqual([]);
    });
    it('parses ls with path', () => {
      const r = parse('ls /player');
      expect(r.args).toEqual(['/player']);
    });
    it('parses ls -l', () => {
      const r = parse('ls -l');
      expect(r.args).toEqual(['-l']);
    });
    it('parses ls -a', () => {
      const r = parse('ls -a');
      expect(r.args).toEqual(['-a']);
    });
    it('parses ls -la', () => {
      const r = parse('ls -la');
      expect(r.args).toEqual(['-la']);
    });
    it('parses ls -l /player', () => {
      const r = parse('ls -l /player');
      expect(r.args).toEqual(['-l', '/player']);
    });
  });

  describe('cat', () => {
    it('parses cat with path', () => {
      const r = parse('cat /player');
      expect(r.name).toBe('cat');
      expect(r.args).toEqual(['/player']);
    });
    it('parses cat with property', () => {
      const r = parse('cat player.x');
      expect(r.args).toEqual(['player.x']);
    });
  });

  describe('set', () => {
    it('parses set with value', () => {
      const r = parse('set x 100');
      expect(r.name).toBe('set');
      expect(r.args).toEqual(['x', '100']);
    });
    it('parses set with string value', () => {
      const r = parse('set text "hello world"');
      expect(r.args).toEqual(['text', 'hello world']);
    });
  });

  describe('touch', () => {
    it('parses touch with prop', () => {
      const r = parse('touch visible');
      expect(r.name).toBe('touch');
      expect(r.args).toEqual(['visible']);
    });
    it('parses touch with prop and value', () => {
      const r = parse('touch x 50');
      expect(r.args).toEqual(['x', '50']);
    });
  });

  describe('rm', () => {
    it('parses rm with path', () => {
      const r = parse('rm /enemy_0');
      expect(r.name).toBe('rm');
      expect(r.args).toEqual(['/enemy_0']);
    });
  });

  describe('mv', () => {
    it('parses mv with src and dst', () => {
      const r = parse('mv /player /enemies');
      expect(r.name).toBe('mv');
      expect(r.args).toEqual(['/player', '/enemies']);
    });
  });

  describe('mkdir', () => {
    it('parses mkdir with type and id', () => {
      const r = parse('mkdir Sprite my_sprite');
      expect(r.name).toBe('mkdir');
      expect(r.args).toEqual(['Sprite', 'my_sprite']);
    });
  });

  describe('tree', () => {
    it('parses tree with no args', () => {
      const r = parse('tree');
      expect(r.name).toBe('tree');
      expect(r.args).toEqual([]);
    });
    it('parses tree with path', () => {
      const r = parse('tree /player');
      expect(r.args).toEqual(['/player']);
    });
  });

  describe('find', () => {
    it('parses find by type', () => {
      const r = parse('find Sprite');
      expect(r.name).toBe('find');
      expect(r.args).toEqual(['Sprite']);
    });
    it('parses find by wildcard', () => {
      const r = parse('find *player*');
      expect(r.args).toEqual(['*player*']);
    });
  });

  describe('stat', () => {
    it('parses stat with no args', () => {
      const r = parse('stat');
      expect(r.name).toBe('stat');
      expect(r.args).toEqual([]);
    });
    it('parses stat with path', () => {
      const r = parse('stat /player');
      expect(r.args).toEqual(['/player']);
    });
  });

  describe('shell controls', () => {
    it('parses help', () => {
      expect(parse('help').name).toBe('help');
    });
    it('parses exit', () => {
      expect(parse('exit').name).toBe('exit');
    });
    it('parses quit', () => {
      expect(parse('quit').name).toBe('quit');
    });
  });

  describe('errors', () => {
    it('returns error for unknown command', () => {
      const r = parse('foobar');
      expect(r.kind).toBe('error');
      expect(r.message).toContain('Unknown command');
    });
    it('returns error for unknown multi-word command', () => {
      const r = parse('node get /player');
      expect(r.kind).toBe('error');
    });
  });
});
