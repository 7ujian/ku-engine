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

Scene graph is a tree of typed nodes (Godot-inspired). 18 built-in node types: `Node`, `Node2D`, `Sprite`, `AnimatedSprite`, `RigidBody`, `Area`, `CollisionShape`, `Camera2D`, `Label`, `TileMap`, `Timer`, `AudioPlayer`, `AnimationPlayer`, `Block`, `Panel`, `Button`, `ImageRect`, `ScrollView`. Last four are GUI nodes with hit testing and input routing. Nodes addressed by slash-separated path (e.g. `player/sprite`).

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
| `node-types.ts` | 18 built-in node type factories (core + GUI) |
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
| `autotile.ts` | 3x3 bitmask autotile for TileMap terrain |
| `atlas.ts` | Spritesheet atlas parsing |
| `animation.ts` | AnimationPlayer keyframe/tween system |
| `hit-test.ts` | Point-in-shape testing for GUI input routing |
| `js-api.ts` | JS scripting API surface (ctx object) |
| `resolve-symbol.ts` | Script action symbol resolution |

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
| `src/renderer/camera.ts` | Camera2D viewport tracking and world→screen transform |
| `src/renderer/sprite-renderer.ts` | Sprite/AnimatedSprite draw with atlas support |
| `src/renderer/tilemap-renderer.ts` | TileMap rendering with autotile integration |
| `src/renderer/label-renderer.ts` | Label text rendering via @napi-rs/canvas |
| `src/renderer/gui-renderer.ts` | Panel/Button/ImageRect/ScrollView rendering |
| `src/player/main.ts` | Standalone player binary |
| `src/cli/cli.ts` | Commander.js CLI definition |
| `src/cli/commands/shell.ts` | Interactive shell REPL with FS navigation |
| `src/cli/commands/node.ts` | Node CRUD + prefab commands (new, instance, duplicate, save) |
| `src/cli/commands/scene.ts` | Scene management (create, list, load, save, rm) |
| `src/cli/commands/build.ts` | `ku build` — packages project for distribution |

### Persistence (`src/persistence/`)
| File | Purpose |
|------|---------|
| `scene-io.ts` | Scene JSON read/write |
| `asset-discovery.ts` | Scan project dir for assets (images, audio, scripts) |
| `atlas-loader.ts` | Load spritesheet atlas JSON files |
| `audio-loader.ts` | WAV file loading for audio playback |
| `script-loader.ts` | Load JS script files from `scripts/` directory |

## Current status

All 6 original phases complete. **P1 complete**: scene instancing, audio backend, level transitions, runtime save/load, delta script edits, JS engine fixes, plugin system.

See `docs/MILESTONE_1_0_REVIEW.md` for full architecture review and prioritized backlog (P2 remaining).

## Design pillars

- **Node as interface**: Features expose their API through Node types. Methods, data, and configuration live on node properties and scripts — not standalone classes. ku CLI and AI agents interact with everything via `node get/set/call`. Example: a Profiler node exposes `samples`, `enabled`, `reset()` as properties/scripts, queryable with `ku query node /profiler`.
- **Scene = prefab (Godot model)**: One root node per application. Scenes are loaded as children of root or containers. `node_path` property references a scene file — on load, its children are merged into the node. `load_scene(path, file)` loads a scene into a container at runtime.
- **Object identity**: Every Node gets a unique `_object_id` (monotonic counter) at construction. Never reused. Used for debugging CLI↔game instance divergence. Queryable via `node get <path>._object_id` and `ls -l`.

## Physics

- Closed type system with plugin extensibility: `PhysicsWorld.registerPhysicsType('Enemy', 'RigidBody')`
- Base types: RigidBody, CollisionShape, Area, TileMap
- `syncNode(node)` dispatches by `node.type` to the matching physics handler
- Tile collisions use compound bodies (`Body.create({ parts })`) — one body per TileMap, not per tile
- Collision filter: layer + mask bits; negative `group` prevents parent-child collision
- Labels render after all other nodes (always on top)

## Rendering

- `@napi-rs/canvas` CPU canvas → SDL2 window via pixel buffer
- Two-pass: game pass (world space, camera transform) → GUI pass (screen space)
- Labels collected during traversal, drawn last to stay on top
- Project fonts auto-loaded from `assets/fonts/*.ttf` via `GlobalFonts.registerFromPath()`
- Debug physics overlay: physics-only bodies (compound tiles) in orange, scene-tree bodies skipped

## Key constraints

- All CLI output is JSON by default
- Write commands work in any mode (no longer restricted to editor)
- Ports 21200/21201 are reserved — do not use 7890 or 789x (allocated to proxy)
- `project.json` fields: `name`, `entry`, `debug_physics`, `profiling`, `window.width/height`
- All imports use `.js` extension (ESM with Node16 moduleResolution)
- All imports use `.js` extension (ESM with Node16 moduleResolution)
