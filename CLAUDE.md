# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ku is a CLI-based 2D game engine for AI agents. AI agents act as both developers (creating scenes, editing nodes) and players (sending input, reacting to state). The full design spec is in `DESIGN.md` and the phased build plan is in `IMPLEMENTATION.md`.

## Tech stack

- Node.js 20+, TypeScript (ES2022, Node16 modules), ESM (`"type": "module"` in package.json)
- `commander` — CLI framework
- `ws` — WebSocket server/client
- `matter-js` — 2D physics
- `@kmamal/sdl` — SDL2 window rendering + audio
- `@napi-rs/canvas` — CPU canvas for sprite/text rendering
- `vitest` — testing

## Commands

```bash
npm run build                  # compile TypeScript (tsc)
npm test                       # run all tests (vitest run)
npx vitest run                 # run tests once
npx vitest run test/file.test.ts  # run single test file
npx vitest                     # watch mode
```

After `npm run build`, the CLI is available as `node dist/bin/ku.js` or `npx ku` if linked.

## Architecture

Dual-instance model: **Editor** and **Play** are separate OS processes, each wrapped by a runtime class.

```
┌──────────┐     WebSocket     ┌──────────────────┐
│  ku CLI  │ ◄───────────────► │  edit :21200      │
│          │                    │  (scene editing)  │
│  AI SDK  │ ◄───────────────► │  play1 :OS-port   │
│          │     WebSocket     │  (game loop)      │
│          │ ◄───────────────► │  play2 :OS-port   │
└──────────┘                    │  (game loop)      │
                                └──────────────────┘
```

- **EditorRuntime** (`src/server/editor-runtime.ts`) — persistent, scene editing, no game loop, no physics/scripts. Optional 2s debounced auto-save (`--autosave`). Loads scene via `ku edit <scene>` or shell `edit <scene>`.
- **PlayRuntime** (`src/server/play-runtime.ts`) — ephemeral, loads scenes from disk (`--load-scene`) or syncs editor's live tree via WebSocket (`--sync-from`). Runs full game loop (physics + scripts + input + rendering + audio). State discarded on stop.
- **Instance** (`src/server/instance.ts`) — base class shared by both runtimes. Manages SceneTree, WebSocket server, and message handler.
- CLI connects to either instance via WebSocket, routes commands based on current attachment (`ku attach edit|play`)
- Discovery via `.ku.edit.pid`, `.ku.edit.port`, `.ku.play.pid`, `.ku.play.port` files (`src/server/discovery.ts`)

Scene graph is a tree of typed nodes (Godot-inspired). 14 built-in node types: `Node`, `Node2D`, `Sprite`, `AnimatedSprite`, `RigidBody`, `Area`, `CollisionShape`, `Camera2D`, `Label`, `TileMap`, `Timer`, `AudioPlayer`, `AnimationPlayer`, `Block`. Nodes addressed by slash-separated path (e.g. `player/sprite`).

Game logic is pure JSON — event-driven scripts with `on_key`, `on_collision`, `on_frame`, `on_timer`, `on_touch_start`, `on_area_enter`, etc. triggers and `set`, `set_on`, `move`, `move_toward`, `spawn`, `destroy`, `emit` actions. Expressions support cross-node refs (`{{/player/score}}`), modulo (`%`). No embedded scripting language. Optional JS scripting via sandboxed `vm` engine alongside JSON scripts.

## Data flow

1. **Persistence** → all filesystem I/O is in `src/persistence/`. Runtime engine modules are pure in-memory.
2. **Editor** → loads scenes via `scene-io.ts`, provides node CRUD over WebSocket.
3. **Sync** → edit→play delta streaming via `sync-client.ts`. Snapshot for initial load, delta stream for hot-reload. Guard properties (`x`, `y`, `velocity`) on RigidBody prevent editor edits from fighting physics.
4. **Play** → full game loop: `GameLoop` → `ScriptEngine` + `JsScriptEngine` + `PhysicsWorld` → `Renderer`. Fixed-timestep with accumulator pattern.
5. **CLI** → Commander.js subcommands (`src/cli/commands/`). Shell mode (`ku shell`) provides REPL with filesystem-style navigation (cd, ls, cat, tree), tab completion, and builtins (edit/play/attach/detach).

## Plugin system

ESM plugins loaded from `<project>/plugins/<name>/index.js`. Plugins implement `KuPlugin` interface (`name`, `version`, `init(host)`, `destroy()`). `PluginHost` API: register custom node types, script actions, message handlers, CLI commands, and node renderers. See `src/engine/plugin.ts` for interfaces, `examples/tetris/plugins/` for a sample.

## Key files

### Engine (`src/engine/`)
| File | Purpose |
|------|---------|
| `node.ts` | Node class with parent backlink, property system |
| `scene-tree.ts` | Tree CRUD, traversal, reparent with world-preserve |
| `transform.ts` | Transform2D math, world↔local conversion |
| `types.ts` | NodeData, ScriptRule, ScriptAction, ScriptError |
| `node-types.ts` | 14 built-in node type factories |
| `script-engine.ts` | JSON script execution, actions, error collection |
| `js-script-engine.ts` | Sandboxed JS scripting with vm module |
| `expression-evaluator.ts` | Recursive descent parser for `{{expr}}` |
| `conditions.ts` | Cross-node condition evaluation |
| `physics.ts` | matter-js integration, world↔local sync |
| `collision-events.ts` | Enter/exit tracking for collisions and areas |
| `event-bus.ts` | Pub/sub event system for custom events |
| `game-loop.ts` | Fixed-timestep loop, accumulator pattern |
| `audio.ts` | SDL2 audio, WAV playback (accepts loadWavFn callback) |
| `plugin.ts` / `plugin-registry.ts` | Plugin interfaces and loader |

### Server (`src/server/`)
| File | Purpose |
|------|---------|
| `main.ts` | Server entry, ~50 lines, delegates to runtime classes |
| `instance.ts` | Base class: SceneTree + WebSocket server + message handler |
| `editor-runtime.ts` | EditorRuntime: scene editing + autosave |
| `play-runtime.ts` | PlayRuntime: full game loop orchestration |
| `message-handler.ts` | WebSocket message routing, sync ops |
| `sync-client.ts` | Edit→play delta streaming |
| `input-manager.ts` | Keyboard/touch/axis input |
| `discovery.ts` | PID/port file discovery for running instances |

### Other
| File | Purpose |
|------|---------|
| `src/renderer/renderer.ts` | SDL2 window, two-pass rendering (draw + debug overlay) |
| `src/player/main.ts` | Standalone player binary |
| `src/cli/cli.ts` | Commander.js CLI definition |
| `src/cli/commands/shell.ts` | Interactive shell REPL with FS navigation |
| `src/cli/commands/node.ts` | Node CRUD + prefab commands (new, instance, duplicate, save) |
| `src/cli/commands/scene.ts` | Scene management (create, list, load, save, rm) |
| `src/cli/commands/build.ts` | `ku build` — packages project for distribution |

## Current status

All 6 original phases complete. **P1 complete**: scene instancing, audio backend, level transitions, runtime save/load, delta script edits, JS engine fixes, plugin system.

See `docs/MILESTONE_1_0_REVIEW.md` for full architecture review and prioritized backlog (P2 remaining).

## Key constraints

- All CLI output is JSON by default
- Write commands work in any mode (no longer restricted to editor)
- Ports 21200/21201 are reserved — do not use 7890 or 789x (allocated to proxy)
- `project.json` fields: `name`, `entry`, `debug_physics`, `window.width/height`
- All imports use `.js` extension (ESM with Node16 moduleResolution)
