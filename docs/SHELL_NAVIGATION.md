# Shell Navigation — Filesystem-Style Scene Tree Interaction

## Motivation

Current `ku shell` commands use verbose two-word syntax: `node get /player/x`,
`node list /`, `node rm /enemy_0`, `node move /player /enemies`. This is tedious
for interactive exploration. Users familiar with Linux filesystems expect `cd`,
`pwd`, `ls`, `rm`, `mv` — short, muscle-memory commands.

Treat the scene tree like a filesystem: **nodes are directories**, **properties
are files**, **objects/arrays are subdirectories**.

## Architecture: nested REPL

FS mode lives as a **sub-REPL** inside the normal shell. It does not pollute the
normal command namespace.

```
ku:edit> fs                          # enter fs mode
ku:edit /> cd player                 # navigate
ku:edit /player> ls                  # list children
ku:edit /player> exit                # return to normal shell
ku:edit> node get /player/x          # normal commands still work
```

`ku shell` normal commands are unchanged. `fs` is a single builtin that enters a
nested readline loop with its own parser, dispatch table, prompt, and cwd state.

FS mode reuses the parent `ShellSession`'s WebSocket connection — no reconnect
needed.

## FS mode design

### Working directory

FS session tracks `cwd` (current working directory) as a node path string,
defaulting to `/` (root node).

Prompt shows instance + cwd:
```
ku:edit /> cd player
ku:edit /player> cd ../enemy_0
ku:edit /enemy_0> pwd
/enemy_0
```

### Path resolution

| Input | Resolves to | Rule |
|-------|------------|------|
| `foo` | `<cwd>/foo` | Relative child |
| `./foo` | `<cwd>/foo` | Explicit relative |
| `../foo` | `<parent>/foo` | Parent traversal |
| `/foo` | `/foo` | Absolute |
| `.` | `<cwd>` | Current node |
| `..` | `<parent>` | Parent node |

Path segments separated by `/`. Trailing `/` optional. `..` on root stays at
root.

### Node properties as paths

Properties accessed with dot notation: `node.prop`, `node.obj.nested`.

When `cd`-ing into a property that is an object or array, the "working position"
becomes that property value. Commands like `ls` list object keys or array
indices. `cd ..` returns to the parent node/object.

Property paths in cwd: `/player.velocity` means "node `/player`, property
`velocity`". If velocity is `{x: 0, y: 0}`, then `cd x` goes to
`/player.velocity.x`.

## FS commands

### Navigation

| Command | Behavior |
|---------|----------|
| `cd <path>` | Change cwd. Path resolves relative to current cwd. `cd` with no arg goes to `/`. |
| `cd ..` | Go to parent node (or parent object if inside a property). |
| `cd -` | Go to previous cwd (toggle). |
| `pwd` | Print absolute path of cwd. |

### Listing

| Command | Behavior |
|---------|----------|
| `ls [path]` | List children of target node (or cwd if no path). Shows type and id. |
| `ls -l [path]` | Long format: type, id, key properties (x, y, width, height, color). |
| `ls -a [path]` | Include properties as pseudo-entries. Object properties marked navigable. |

With `-a`, properties appear alongside children:
```
ku:edit /player> ls -a
  .texture    = "player.png"       (property)
  .x          = 180                (property)
  .y          = 560                (property)
  .visible    = true               (property)
  .velocity   = {x: 0, y: 0}      (object — cd-able)
  sprite/     (Sprite)
```

### Read/write

| Command | Behavior |
|---------|----------|
| `cat <path.property>` | Print property value. If object/array, pretty-print. On a node, print full JSON. |
| `set <prop> <value>` | Set property on current node. `<prop>` is property name (not full path). |
| `edit <prop>` | Open `$EDITOR` on the property value (useful for JSON). |

### Mutation

| Command | Behavior |
|---------|----------|
| `rm <path>` | Remove node. `rm -r` for recursive. `rm .prop` removes property from current node. |
| `mv <src> <dst>` | Move/reparent a node. |
| `mkdir <type> <id>` | Create new child node under cwd. `type` is node type (Sprite, RigidBody, Label, etc.). |
| `touch <prop> [value]` | Set property on current node. Default: `""` for strings, `0` for numbers, `{}` for objects. |

### Inspection

| Command | Behavior |
|---------|----------|
| `tree [path]` | Print subtree starting from cwd (or path). |
| `find <query>` | Search nodes by type or id. `find Sprite`, `find *player*`. |
| `stat [path]` | Print metadata: type, parent, child count, script count, key properties. |

### Shell control

| Command | Behavior |
|---------|----------|
| `help` | Show FS command list. |
| `exit` / `quit` / Ctrl+D | Exit FS mode, return to normal ku shell. Normal shell keeps running. |
| Ctrl+C (once) | Clear current line. |
| Ctrl+C (twice) | Exit FS mode (not the whole shell). |

The parent shell's `instance` commands (`attach`, `detach`, `instances`) are NOT
available in FS mode — `exit` back to normal shell first.

### Niceties

| Feature | Behavior |
|---------|----------|
| Tab completion | Node paths, property names, command names. Context-aware (node types after `mkdir`). |
| History | FS mode shares readline history with parent shell. |

## Implementation

### Entry point

`ShellSession` gets a new builtin `fs` that spawns a `FsSession`:

```
// In shell.ts executeBuiltin():
case 'fs': {
  const fsSession = new FsSession(this);  // passes ws, projectDir, instance
  await fsSession.start();
  break;  // back to normal shell prompt after fsSession exits
}
```

### New file: `src/cli/commands/shell-fs.ts`

`FsSession` class — owns the nested REPL. Receives a reference to the parent
`ShellSession` (for shared WS connection, project dir, instance type).

```
class FsSession {
  private parent: ShellSession;      // for send(), projectDir, currentInstance
  private cwd: string = '/';
  private prevCwd: string = '/';
  private rl: readline.Interface;   // nested readline — pauses parent's rl
  private parser: CommandParser;    // FS-specific dispatch table

  constructor(parent: ShellSession) { ... }

  async start(): Promise<void> {
    // Pause parent readline, create nested readline, enter REPL
    // On exit: close nested rl, resume parent rl, parent re-prompts
  }

  resolvePath(input: string): string { ... }
  buildParser(): CommandParser { ... }
  execute(input: string): Promise<void> { ... }
}
```

Nested readline: `FsSession.start()` pauses the parent shell's readline
interface, creates a new one on stdin/stdout, and runs its own prompt loop. When
the user types `exit`, it closes the nested readline and resolves the promise,
returning control to the parent shell's REPL.

### Path resolution

```
resolvePath(input: string): string {
  if (!input || input === '.') return this.cwd;
  if (input === '-') return this.prevCwd;
  if (input === '..') return parentOf(this.cwd);
  if (input.startsWith('/')) return input;

  const segments = (this.cwd + '/' + input).split('/').filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '..') out.pop();
    else if (seg !== '.') out.push(seg);
  }
  return '/' + out.join('/');
}
```

### Dispatch table

```typescript
buildParser(): CommandParser {
  const p = new CommandParser();

  p.register('cd',    (args) => blt('cd', args));
  p.register('pwd',   ()     => blt('pwd', []));
  p.register('ls',    (args) => blt('ls', args));
  p.register('cat',   (args) => blt('cat', args));
  p.register('set',   (args) => blt('set', args));
  p.register('rm',    (args) => blt('rm', args));
  p.register('mv',    (args) => blt('mv', args));
  p.register('mkdir', (args) => blt('mkdir', args));
  p.register('touch', (args) => blt('touch', args));
  p.register('tree',  (args) => blt('tree', args));
  p.register('find',  (args) => blt('find', args));
  p.register('stat',  (args) => blt('stat', args));
  p.register('help',  ()     => blt('help', []));
  p.register('exit',  ()     => blt('exit', []));
  p.register('quit',  ()     => blt('quit', []));

  return p;
}
```

Each FS command handler converts the FS-style invocation to the corresponding
`node.*` / `query.*` / `scene.*` server message, calls `this.parent.send()`,
and prints the result.

## Files changed

| File | Change |
|------|--------|
| `docs/SHELL_NAVIGATION.md` | This plan document |
| `src/cli/commands/shell-fs.ts` | **New.** FsSession class, nested REPL, path resolver, FS dispatch table |
| `src/cli/commands/shell.ts` | Add `fs` builtin to dispatch table, expose `send()`/`projectDir`/`currentInstance` to FsSession |
| `test/shell-parser.test.ts` | Tests for FS commands and path resolution |

## Implementation order

1. Expose `send()`, `projectDir`, `currentInstance` from `ShellSession` (add getters)
2. Add `fs` builtin to shell's dispatch table (stub)
3. Create `FsSession` class with `start()`, nested readline, `resolvePath()`
4. Implement `cd`, `pwd` — navigate and display cwd
5. Implement `ls` (with `-l`, `-a`) via `node.list` + `node.get` for properties
6. Implement `cat`, `set`, `touch` via `node.get` / `node.set`
7. Implement `rm`, `mv`, `mkdir` via `node.rm` / `node.move` / `node.add`
8. Implement `tree`, `find`, `stat`
9. Tab completion (readline `completer` callback)
10. Update tests

## Edge cases

| Scenario | Behavior |
|----------|----------|
| `cd` to non-existent node | Error: "node not found: <path>" |
| `cd` into non-object property | Error: "not a container: <path>" |
| `rm` on current cwd | Remove node, cd to parent |
| `rm` on `/` (root) | Error: "cannot remove root" |
| `..` on `/` | Stay at `/` |
| `cd -` with no previous cwd | Error: "no previous directory" |
| `exit` in FS mode | Return to normal shell, preserving parent state |
| Instance disconnected while in FS mode | Print error, keep FS mode alive, commands fail gracefully |
| Ctrl+C twice in FS mode | Exit FS mode only (not whole shell) |
