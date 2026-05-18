# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ku is a CLI-based 2D game engine for AI agents. AI agents act as both developers (creating scenes, editing nodes) and players (sending input, reacting to state). The full design spec is in `DESIGN.md` and the phased build plan is in `IMPLEMENTATION.md`.

## Tech stack

- Node.js 20+, TypeScript, npm
- `commander` — CLI framework
- `ws` — WebSocket server/client
- `matter-js` — 2D physics
- `@kmamal/sdl` — SDL2 window rendering + audio
- `@napi-rs/canvas` — CPU canvas for sprite/text rendering
- `vitest` — testing

## Architecture

Dual-instance model: **Editor** and **Play** are separate OS processes.

- **Editor instance** (port 21200) — persistent, scene editing, no game loop, no physics/scripts, saves to disk. Loads scene via `ku edit <scene>`.
- **Play instance** (port 21201) — ephemeral, syncs editor's live tree via WebSocket (`SyncClient`), runs full game loop (physics + scripts + input + rendering), state discarded on stop. `ku play --hot-reload` subscribes to incremental editor deltas.
- CLI connects to either instance via WebSocket, routes commands based on current attachment (`ku attach edit|play`)
- Discovery via `.ku.edit.pid`, `.ku.edit.port`, `.ku.play.pid`, `.ku.play.port` files

Scene graph is a tree of typed nodes (Godot-inspired). 12 built-in node types: `Node`, `Node2D`, `Sprite`, `AnimatedSprite`, `RigidBody`, `Area`, `CollisionShape`, `Camera2D`, `Label`, `TileMap`, `Timer`, `AudioPlayer`. Nodes addressed by slash-separated path (e.g. `player/sprite`).

Game logic is pure JSON — event-driven scripts with `on_key`, `on_collision`, `on_frame`, `on_timer`, `on_touch_start`, `on_area_enter`, etc. triggers and `set`, `set_on`, `move`, `move_toward`, `spawn`, `destroy`, `emit` actions. Expressions support cross-node refs (`{{/player/score}}`), modulo (`%`). No embedded scripting language.

### Key features

**Transform2D** — Hierarchical transform system. Nodes store local coordinates; world transforms computed by walking parent chain with rotation/scale composition. `getWorldTransform()`, `worldToLocal()`, `localToWorld()`. `SceneTree.move()` preserves world position across reparenting. Container nodes (plain `Node`, `Timer`) return identity transform.

**Physics** — matter-js integration with world↔local coordinate conversion. Per-body `gravity_scale`, `collision_layer`/`collision_mask` bitmasks. Area nodes fire `on_area_enter`/`on_area_exit`. `CollisionShape` children of `RigidBody` follow parent with rotation-aware offset. Standalone `CollisionShape` (enemies, bullets) works as root-level dynamic bodies.

**Renderer** — Two-pass: normal draw (sprites, tilemaps, labels) then debug overlay (wireframe outlines for RigidBody/CollisionShape/Area). Debug layer gated by `debug_physics` in project.json. `findCamera()` for camera following.

**Input** — Keyboard (keyDown/keyUp with normalized key names), touch/pointer (SDL finger events + mouse fallback), axis input.

**JS Scripting** — Sandboxed `vm` engine runs alongside JSON scripts. `ctx` API: `node.get/set`, `scene.get/set/spawn/destroy/find`, `emit`, `log`, `dt`, `data`. Per-node isolated state. Custom events on separate EventBus.

**CLI** — `-p, --project <dir>` global flag. Commander.js with subcommands for scene, node, input, query, runtime control, build.

**Audio** — SDL2 audio backend (`AudioManager`). WAV PCM playback with software mixing for multiple simultaneous sounds. Volume control. `AudioPlayer` nodes triggered via `play`/`stop` script actions. Graceful fallback when SDL2 unavailable.

**Scene instancing** — `"instance": "scenes/player.json"` references on nodes resolved at load time. Template properties, children, and scripts merged with instance overrides. Circular reference detection. Reduces scene duplication for repeated entities.

**Level transitions** — `change_scene` script action. Async scene load between ticks, old physics destroyed, new tree + scripts + physics re-initialized, `on_enter` fires. Scene loader callback pattern for play instance integration.

**Runtime save/load** — `scene.save_runtime` action on play instance saves full tree (including spawned nodes) to disk. Synchronous `saveSceneSync` for WebSocket handler context. State can be reloaded via `ku edit`.

**Delta script edits** — Granular sync ops: `script_add`, `script_remove`, `script_set`. Enables concurrent script edits without full array replacement. Index-based and name-based addressing.

## Current status

All 6 original phases complete. P0 done. **P1 complete**: scene instancing, audio backend, level transitions, runtime save/load, delta script edits, JS engine fixes (spawn registration + dt context).

See `docs/MILESTONE_1_0_REVIEW.md` for full architecture review and prioritized backlog (P2 remaining).

## Commands (once implemented)

```bash
npm test                       # run all tests
npx vitest run                 # run tests once
npx vitest run test/file.test.ts  # run single test file
npx vitest                     # watch mode
npm run build                  # compile TypeScript
```

## Key files

| File | Purpose |
|------|---------|
| `src/engine/node.ts` | Node class with parent backlink, property system |
| `src/engine/scene-tree.ts` | Tree CRUD, traversal, reparent with world-preserve |
| `src/engine/transform.ts` | Transform2D math, world↔local conversion |
| `src/engine/types.ts` | NodeData, ScriptRule, ScriptAction, ScriptError |
| `src/engine/node-types.ts` | 12 node type factories |
| `src/engine/script-engine.ts` | JSON script execution, actions, error collection |
| `src/engine/js-script-engine.ts` | Sandboxed JS scripting with vm module |
| `src/engine/expression-evaluator.ts` | Recursive descent parser for `{{expr}}` |
| `src/engine/conditions.ts` | Cross-node condition evaluation |
| `src/engine/physics.ts` | matter-js integration, world↔local sync |
| `src/engine/collision-events.ts` | Enter/exit tracking for collisions and areas |
| `src/engine/game-loop.ts` | Fixed-timestep loop, accumulator pattern |
| `src/engine/scene-file.ts` | Scene JSON load/save, instance resolution |
| `src/engine/audio.ts` | SDL2 audio, WAV playback, software mixing |
| `src/renderer/renderer.ts` | SDL2 window, two-pass rendering, debug overlay |
| `src/server/main.ts` | Server entry (editor + play modes) |
| `src/server/message-handler.ts` | WebSocket message routing, sync ops |
| `src/server/sync-client.ts` | Edit→play delta streaming |
| `src/cli/cli.ts` | Commander.js CLI definition |

## Key constraints

- All CLI output is JSON by default (`--pretty` for humans)
- Write commands (`node add/rm/set`, `scene create/save`) only work on editor instance
- Play instance is read-only from CLI (except `input` commands)
- Ports 21200/21201 are reserved — do not use 7890 or 789x (allocated to proxy)
- `project.json` fields: `name`, `entry`, `debug_physics`, `window.width/height`
