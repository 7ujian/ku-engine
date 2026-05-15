# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ku is a CLI-based 2D game engine for AI agents. AI agents act as both developers (creating scenes, editing nodes) and players (sending input, reacting to state). The full design spec is in `DESIGN.md` and the phased build plan is in `IMPLEMENTATION.md`.

## Tech stack

- Node.js 20+, TypeScript, npm
- `commander` — CLI framework
- `ws` — WebSocket server/client
- `matter-js` — 2D physics
- `@kmamal/sdl` — SDL2 window rendering
- `vitest` — testing

## Architecture

Dual-instance model: **Editor** and **Play** are separate OS processes.

- **Editor instance** (port 21200) — persistent, scene editing, no game loop, no physics/scripts, saves to disk
- **Play instance** (port 21201) — ephemeral, spawned from editor snapshot, runs full game loop (physics + scripts + input + rendering), state discarded on stop
- CLI connects to either instance via WebSocket, routes commands based on current attachment (`ku attach edit|play`)
- Discovery via `.ku.edit.pid`, `.ku.edit.port`, `.ku.play.pid`, `.ku.play.port` files

Scene graph is a tree of typed nodes (Godot-inspired). 12 built-in node types: `Node`, `Node2D`, `Sprite`, `AnimatedSprite`, `RigidBody`, `Area`, `CollisionShape`, `Camera2D`, `Label`, `TileMap`, `Timer`, `AudioPlayer`. Nodes addressed by slash-separated path (e.g. `player/sprite`).

Game logic is pure JSON — event-driven scripts with `on_key`, `on_collision`, `on_frame`, etc. triggers and `set`, `move`, `spawn`, `destroy`, `emit` actions. No embedded scripting language.

## Implementation phases

Phases 1-3 are foundation (no rendering or physics). Phases 4-5 are parallel. Phase 6 integrates everything.

1. Core data model (types, node tree, scene files)
2. Server + CLI (WebSocket, discovery, instance management, node CRUD commands)
3. Script engine (event bus, expression evaluator, action execution)
4. Physics (matter-js integration, collision events) — parallel with 5
5. Renderer (SDL2, sprites, tilemaps, camera) — parallel with 4
6. Game loop + input (60 FPS loop, play instance spawning, AI input, query/diff)

## Commands (once implemented)

```bash
npm test                       # run all tests
npx vitest run                 # run tests once
npx vitest run test/file.test.ts  # run single test file
npx vitest                     # watch mode
npm run build                  # compile TypeScript
```

## Key constraints

- All CLI output is JSON by default (`--pretty` for humans)
- Write commands (`node add/rm/set`, `scene create/save`) only work on editor instance
- Play instance is read-only from CLI (except `input` commands)
- Ports 21200/21201 are reserved — do not use 7890 or 789x (allocated to proxy)
