# ku

A CLI-based 2D game engine for AI agents. AI agents act as both developers (creating scenes, editing nodes) and players (sending input, reacting to game state).

## Architecture

Dual-instance model with separate OS processes:

- **Editor instance** (port 21200) — persistent, scene editing, no game loop, saves to disk
- **Play instance** (port 21201) — ephemeral, spawned from editor snapshot, runs full game loop (physics + scripts + input + rendering), state discarded on stop

```
┌──────────┐     WebSocket      ┌──────────────────┐
│  ku CLI  │ ◄──────────────► │  Editor :21200    │
│          │                    │  (scene editing)  │
│  AI SDK  │                    └──────────────────┘
│          │ ◄──────────────► │  Play :21201       │
└──────────┘     WebSocket      │  (game loop)      │
                                └──────────────────┘
```

The scene graph is a tree of typed nodes (Godot-inspired). 12 built-in node types: `Node`, `Node2D`, `Sprite`, `AnimatedSprite`, `RigidBody`, `Area`, `CollisionShape`, `Camera2D`, `Label`, `TileMap`, `Timer`, `AudioPlayer`. Nodes are addressed by slash-separated path (e.g. `player/sprite`).

Game logic is pure JSON — event-driven scripts with triggers (`on_key`, `on_collision`, `on_frame`) and actions (`set`, `move`, `spawn`, `destroy`, `emit`). No embedded scripting language.

## Quick Start

```bash
# Install dependencies and build
npm install
npm run build

# Create a project and start editing
mkdir my-game && cd my-game
echo '{"window":{"width":640,"height":480},"entry":"scenes/main.json"}' > project.json

# Start the editor (creates scenes/main.json if it doesn't exist)
ku edit main

# Start playing (opens SDL2 window with physics)
ku play

# Send input
ku input key space down
ku input key space up
```

## CLI Commands

### Instance management

| Command | Description |
|---------|-------------|
| `ku edit [scene]` | Start editor instance |
| `ku play [scene]` | Start play instance (snapshot from editor) |
| `ku stop [edit\|play]` | Stop an instance |
| `ku attach <edit\|play>` | Attach CLI to an instance |
| `ku detach` | Detach CLI from current instance |
| `ku instances` | List running instances |

### Scene editing (editor only)

| Command | Description |
|---------|-------------|
| `ku scene create <name>` | Create a new scene |
| `ku scene save` | Save current scene to disk |
| `ku scene load <name>` | Load a scene |
| `ku scene list` | List all scenes |
| `ku scene snapshot` | Return scene JSON |

### Node operations (editor only)

| Command | Description |
|---------|-------------|
| `ku node add <path> <type>` | Add a node |
| `ku node rm <path>` | Remove a node |
| `ku node set <path> <key> <value>` | Set a property |
| `ku node get <path> [key]` | Get a property |
| `ku node mv <from> <to>` | Move/rename a node |
| `ku node ls [path]` | List children |

### Runtime (play only)

| Command | Description |
|---------|-------------|
| `ku pause` | Pause game loop |
| `ku resume` | Resume game loop |
| `ku step` | Advance one frame |

### Input (play only)

| Command | Description |
|---------|-------------|
| `ku input key <key> <down\|up>` | Simulate key event |
| `ku input click <x> <y>` | Simulate click |
| `ku input axis <name> <value>` | Set axis value (-1 to 1) |

### Query

| Command | Description |
|---------|-------------|
| `ku query scene` | Full scene state as JSON |
| `ku query nodes [type]` | List nodes, optionally filtered by type |

## Scene JSON Format

```json
{
  "scene": "main",
  "root": {
    "id": "world",
    "type": "Node",
    "properties": {},
    "children": [
      {
        "id": "player",
        "type": "RigidBody",
        "properties": {
          "x": 100, "y": 250,
          "mass": 1,
          "velocity": { "x": 0, "y": 0 },
          "tags": ["player"]
        },
        "children": [],
        "scripts": [
          {
            "event": "on_key",
            "filter": { "key": "space" },
            "actions": [
              { "set": "velocity.y", "to": -250 }
            ]
          },
          {
            "event": "on_collision",
            "filter": { "with": "enemy" },
            "actions": [
              { "emit": "game_over", "data": {} },
              { "log": "hit enemy!" }
            ]
          }
        ]
      }
    ],
    "scripts": []
  }
}
```

## Script System

Scripts are event-driven JSON rules with three optional filtering stages:

- **event** — which event triggers the script (e.g. `on_frame`, `on_key`, `on_collision`, `on_enter`)
- **filter** — key-value match against event data (e.g. `{"key": "space"}` or `{"with": "pipe"}`)
- **condition** — expression evaluated against node properties (e.g. `{"gt": ["score", 10]}`)

### Actions

| Action | Example |
|--------|---------|
| `set` | `{"set": "velocity.y", "to": -250}` |
| `move` | `{"move": {"x": -2}}` |
| `emit` | `{"emit": "scored", "data": {}}` |
| `destroy` | `{"destroy": "{{other}}"}` |
| `log` | `{"log": "hit pipe!"}` |

### Expressions

Template expressions use `{{...}}` syntax with access to node properties and event context variables:

- `"{{score + 1}}"` — arithmetic with node properties
- `"{{velocity.y}}"` — dot-path property access
- `"{{other}}"` — event context variable (the other node in a collision)
- `"{{otherTags}}"` — array of tags from the other node

## Example: Flappy Bird

A complete Flappy Bird game scene lives in `/tmp/flappy-bird/scenes/flappy.json`. Start it with:

```bash
cd /tmp/flappy-bird
ku edit flappy
ku play
# Press space to flap
ku input key space down
```

## Tech Stack

- Node.js 20+, TypeScript
- `commander` — CLI framework
- `ws` — WebSocket server/client
- `matter-js` — 2D physics engine
- `@kmamal/sdl` — SDL2 window rendering
- `@napi-rs/canvas` — software canvas rendering
- `vitest` — testing

## Development

```bash
npm test          # run all tests (62 passing)
npm run build     # compile TypeScript
```

### Project structure

```
src/
├── bin/ku.ts            # CLI entry point
├── cli/                 # CLI commands
│   ├── cli.ts           # Commander program
│   ├── client.ts        # WebSocket client
│   └── commands/        # edit, play, node, scene, input, query, runtime, instances
├── engine/              # Core engine
│   ├── types.ts         # TypeScript interfaces
│   ├── node.ts          # Node class
│   ├── node-types.ts    # 12 built-in node type factories
│   ├── scene-tree.ts    # Scene tree with traversal
│   ├── scene-file.ts    # Scene JSON load/save
│   ├── script-engine.ts # Event-driven script execution
│   ├── expression-evaluator.ts
│   ├── conditions.ts    # Condition evaluation
│   ├── event-bus.ts     # Pub/sub event bus
│   ├── physics.ts       # Matter.js physics world
│   └── game-loop.ts     # 60 FPS game loop
├── server/              # WebSocket server
│   ├── main.ts          # Server entry point
│   ├── instance.ts      # Instance lifecycle
│   ├── discovery.ts     # PID/port file discovery
│   ├── message-handler.ts
│   └── input-manager.ts
└── renderer/
    └── renderer.ts      # SDL2 + canvas renderer
```

## Status

All 6 implementation phases complete. 62 tests passing across 4 test files.

- [x] Phase 1: Core data model (types, node tree, scene files)
- [x] Phase 2: Server + CLI (WebSocket, discovery, instance management, node CRUD)
- [x] Phase 3: Script engine (event bus, expression evaluator, action execution)
- [x] Phase 4: Physics (matter-js integration, collision events)
- [x] Phase 5: Renderer (SDL2, canvas, sprites, labels)
- [x] Phase 6: Game loop + input (60 FPS loop, play instance, AI input)
