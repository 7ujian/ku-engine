# ku — Implementation Plan

## Overview

Build ku in 6 phases, each delivering a usable checkpoint. Each phase depends on the previous one. The MVP (phases 1-3) delivers a working editor with node CRUD. The full product adds scripting, rendering, and the dual-instance play mode.

**Stack**: Node.js 20+, TypeScript, npm

**Key dependencies**:
- `commander` — CLI framework
- `ws` — WebSocket server/client
- `matter-js` — 2D physics engine
- `@kmamal/sdl` — SDL2 bindings for window rendering
- `vitest` — testing

---

## Phase 1: Project Scaffold & Core Data Model

**Goal**:Runnable project with node tree, scene load/save, and type definitions.

### Files to create

```
ku/
├── package.json
├── tsconfig.json
├── .gitignore
├── src/
│   ├── engine/
│   │   ├── node.ts           Node base class, Node2D, property system
│   │   ├── node-types.ts     All built-in node type constructors (Sprite, RigidBody, etc.)
│   │   ├── scene-tree.ts     Tree container — add/remove/find by path, traversal
│   │   ├── scene-file.ts     Load/save scene JSON to disk
│   │   └── types.ts          Shared TypeScript interfaces (NodeData, PropertyMap, SceneFile)
│   └── index.ts
└── test/
    ├── scene-tree.test.ts
    └── scene-file.test.ts
```

### Key implementations

1. **`types.ts`** — Define interfaces: `NodeData`, `PropertyMap`, `ScriptRule`, `SceneFile`
2. **`node.ts`** — `Node` class with `id`, `type`, `properties`, `children`, `scripts`. Methods: `getProperty(path)`, `setProperty(path, value)`, `addChild(node)`, `removeChild(id)`, `toJSON()`, `static fromJSON(data)`
3. **`node-types.ts`** — Factory functions for each built-in type with default properties:
   - `createNode2D(overrides)` → defaults: `{x:0, y:0, rotation:0, scale_x:1, scale_y:1}`
   - `createSprite(overrides)` → defaults: `{texture:'', flip_h:false, flip_v:false}`
   - etc. for all 12 types
4. **`scene-tree.ts`** — `SceneTree` class:
   - `root: Node`
   - `add(path: string, node: Node)` — find parent by path, add child
   - `remove(path: string)` — remove node at path
   - `get(path: string): Node` — resolve path like "player/sprite"
   - `move(path: string, newParent: string)` — reparent
   - `findByType(type: string): Node[]` — search
   - `traverse(visitor: (node, path) => void)` — depth-first walk
5. **`scene-file.ts`** — `SceneFile` class:
   - `load(filePath: string): SceneTree` — read JSON, parse into tree
   - `save(tree: SceneTree, filePath: string)` — serialize to JSON, write
   - `list(dir: string): string[]` — list `.json` files in scenes/

### Tests
- Add/remove/find nodes by path
- Deep path resolution ("world/player/sprite")
- Scene JSON round-trip (load → modify → save → load = same)
- Unknown type handling
- Property get/set with dot notation

### Checkpoint
```bash
npx vitest run    # all tests pass
```

---

## Phase 2: Server & CLI Foundation

**Goal**: `ku edit` starts an editor server, `ku node get` talks to it over WebSocket.

### Files to create

```
src/
├── server/
│   ├── server.ts             WebSocket server, connection handling
│   ├── instance.ts           Instance class — wraps engine + server + state
│   ├── discovery.ts          Write/read .ku.*.pid and .ku.*.port files
│   └── message-handler.ts    Route incoming messages to engine actions
├── cli/
│   ├── cli.ts                Commander program setup, attach logic
│   ├── commands/
│   │   ├── edit.ts           `ku edit` — start editor instance
│   │   ├── stop.ts           `ku stop` — stop instance
│   │   ├── attach.ts         `ku attach` — switch CLI target
│   │   ├── detach.ts         `ku detach` — disconnect
│   │   ├── instances.ts      `ku instances` — list running instances
│   │   ├── scene.ts          `ku scene create/list/load/tree/save`
│   │   └── node.ts           `ku node add/rm/set/get/list/move`
│   └── client.ts             WebSocket client — send message, receive response
└── bin/
    └── ku.ts                 #!/usr/bin/env node entry point
```

### Key implementations

1. **`discovery.ts`**:
   - `writeDiscovery(instance: 'edit'|'play', pid: number, port: number)` — write `.ku.edit.pid`, `.ku.edit.port`, etc.
   - `readDiscovery(): {edit?: {pid, port}, play?: {pid, port}}` — read discovery files
   - `cleanDiscovery(instance)` — remove files on stop
   - `isAlive(instance): boolean` — check PID is running

2. **`instance.ts`**:
   - `Instance` class with `mode: 'edit'|'play'`, `tree: SceneTree`, `server: WebSocket.Server`
   - `start(port: number)` — create WS server, write discovery
   - `stop()` — close server, clean discovery
   - `snapshot(): NodeData` — deep clone of tree root (for spawning play)

3. **`message-handler.ts`**:
   - Routes `{action: "node.set", ...}` to `tree.setProperty()`
   - Returns `{ok: true, data: ...}` or `{ok: false, error: ...}`
   - Validates instance mode (reject `node.add` on play instance)

4. **`client.ts`**:
   - `sendCommand(host, port, message): Promise<Response>` — connect, send, receive, disconnect
   - `stream(host, port, message): AsyncIterable<Response>` — for watch/log

5. **`cli.ts`**:
   - Commander program with all command registrations
   - Current attachment state stored in `.ku.attach` temp file
   - `--inst` flag logic to override attachment
   - `--pretty` flag for formatted output

6. **`commands/edit.ts`**:
   - Check discovery if editor already running → attach if so
   - If not, fork server process (`child_process.fork`)
   - Wait for discovery files to appear
   - Set attachment to edit

7. **`commands/node.ts`**, **`commands/scene.ts`**:
   - Build message payload from CLI args
   - Send via client to attached instance
   - Print response as JSON

### Tests
- Server start/stop with discovery files
- Client send/receive over WebSocket
- Message handler: node CRUD operations
- Instance mode validation (reject write on play)
- Discovery file read/write

### Checkpoint
```bash
ku edit                     # starts editor, returns
ku node add / player Node2D --props '{"x":100,"y":300}'
ku node add player sprite Sprite --props '{"texture":"player.png"}'
ku node get player          # {"ok":true,"data":{"x":100,"y":300,...}}
ku scene save
ku stop edit
```

---

## Phase 3: Script Engine

**Goal**: JSON scripts execute in the play instance — event triggers fire actions.

### Files to create

```
src/engine/
├── script-engine.ts          Evaluate scripts — match events, execute actions
├── expression-evaluator.ts   Parse {{expr}} templates
├── event-bus.ts              Emit/subscribe event system
└── conditions.ts             Evaluate condition objects ({neq, gt, ...})
```

### Key implementations

1. **`event-bus.ts`**:
   - `EventBus` class: `emit(name, data)`, `on(name, handler)`, `off(name, handler)`
   - Built-in events: `on_key`, `on_key_up`, `on_frame`, `on_collision`, `on_timer`, `on_enter`, `on_custom`

2. **`expression-evaluator.ts`**:
   - Parse `{{speed}}` → look up property on current node
   - Parse `{{x + 10}}` → simple arithmetic with property refs
   - Parse `{{-speed}}` → negation
   - Parse `{{other.id}}` → collision/event context
   - Parse `{{random(0, 100)}}` → built-in functions
   - Return literal values if no `{{}}` wrapper

3. **`conditions.ts`**:
   - Evaluate `{"velocity.x": {"neq": 0}}` against node properties
   - Operators: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `in`, `between`

4. **`script-engine.ts`**:
   - `ScriptEngine` class:
     - `registerNode(node: Node)` — collect scripts from node, subscribe to events
     - `evaluateEvent(event: string, data: object)` — for each registered script matching event:
       1. Check filter matches
       2. Check condition passes
       3. Execute each action in order
     - Action execution:
       - `set` → resolve expression, call `node.setProperty()`
       - `move` → modify position properties
       - `spawn` → load scene file, add to tree
       - `destroy` → find node by path/expression, remove
       - `emit` → bus.emit custom event
       - `play`/`stop` → control audio/timer nodes
       - `log` → emit to log stream
       - `call` → invoke another named script

### Tests
- Expression evaluation: property refs, arithmetic, negation, built-in functions
- Condition evaluation: all operators
- Script engine: event → filter → condition → actions chain
- Action types: set, move, destroy, emit, log
- Multi-node script registration and event routing

### Checkpoint
```bash
ku edit
ku scene load level_1       # scene with scripts
ku play                      # play instance with scripts active
ku attach play
ku input key right down     # scripts fire, properties change
ku query player.x           # position changed by script
```

---

## Phase 4: Physics Integration

**Goal**: RigidBody and CollisionShape nodes produce physical simulation.

### Files to create

```
src/engine/
├── physics.ts                Matter.js integration — sync node tree ↔ physics world
└── collision-events.ts       Translate Matter.js collisions to event-bus events
```

### Key implementations

1. **`physics.ts`**:
   - `PhysicsWorld` class wrapping Matter.js `Engine`
   - `syncFromTree(tree: SceneTree)` — create/update/remove Matter bodies for `RigidBody` nodes
   - `step(dt: number)` — advance physics
   - `syncToTree(tree: SceneTree)` — write position/velocity back to nodes
   - Map node properties to Matter options: `mass`, `velocity`, `gravity_scale`, `linear_damping`
   - `CollisionShape` nodes create Matter `Bodies` (rect, circle, polygon)

2. **`collision-events.ts`**:
   - Listen to Matter.js `collisionStart`, `collisionActive`, `collisionEnd`
   - Map collision pairs back to node paths using Matter label ↔ node id
   - Emit `on_collision` / `on_collision_exit` events via EventBus with `{node, other}` data

### Tests
- RigidBody falls with gravity
- Collision detection between two bodies
- Physics sync: tree → world → tree round-trip
- Collision events emitted on EventBus

### Checkpoint
```bash
ku play
ku attach play
# Player with RigidBody falls, collides with ground
ku query player.y            # position changes from physics
ku query collisions          # shows collision pairs
```

---

## Phase 5: 2D Renderer

**Goal**: SDL2 window displays the scene. Camera2D controls viewport.

### Files to create

```
src/renderer/
├── renderer.ts               SDL2 window + render loop
├── sprite-renderer.ts        Draw Sprite and AnimatedSprite nodes
├── tilemap-renderer.ts       Draw TileMap nodes
├── label-renderer.ts         Draw Label nodes (text)
└── camera.ts                 Camera2D viewport transform
```

### Key implementations

1. **`renderer.ts`**:
   - Initialize SDL2 window (640×480 default, from project.json)
   - Main render function: traverse tree, apply camera, draw nodes
   - Texture cache: load images on first use, cache by path
   - Clear → draw → present cycle

2. **`camera.ts`**:
   - Find active `Camera2D` node in tree
   - Compute viewport transform: offset + zoom
   - Apply to all draw calls

3. **`sprite-renderer.ts`**:
   - Draw textured quad at node's world position
   - Handle `flip_h`, `flip_v`, frame selection for AnimatedSprite
   - Fallback: draw colored rect if texture not found

4. **`tilemap-renderer.ts`**:
   - Load tileset image, split into tiles by `cell_size`
   - Draw visible tiles based on camera viewport (culling)

5. **`label-renderer.ts`**:
   - Render text using SDL2 TTF or bitmap font
   - Apply `font_size`, `color` properties

### Tests (manual / visual)
- Sprite renders at correct position
- Camera2D scrolling and zoom work
- TileMap draws a test level
- Label renders text

### Checkpoint
```bash
ku play
# Window opens showing the scene
# Player sprite visible, camera following
# Physics objects falling and colliding visually
```

---

## Phase 6: Game Loop, Play Instance & Input

**Goal**: Complete play instance with game loop, input handling, and the full edit→play→stop cycle.

### Files to create

```
src/server/
├── game-loop.ts              60 FPS loop: physics → scripts → renderer
├── play-spawner.ts           Snapshot editor tree, fork play process
└── input-manager.ts          Keyboard/mouse → event bus
```

### Key implementations

1. **`game-loop.ts`**:
   - `GameLoop` class: `start()`, `stop()`, `pause()`, `resume()`, `step()`
   - Per-frame: `physics.step(dt)` → `scriptEngine.evaluateFrame(dt)` → `renderer.draw(tree)`
   - Fixed timestep with accumulator (60 FPS target)
   - Frame counter for diff tracking

2. **`play-spawner.ts`**:
   - `spawnPlay(editorInstance: Instance): Instance`:
     1. Call `editorInstance.snapshot()` to get serialized tree
     2. Fork new process with `--mode play --snapshot <json>` args
     3. Play process deserializes snapshot, starts game loop
     4. Write `.ku.play.pid` and `.ku.play.port`

3. **`input-manager.ts`**:
   - Listen to SDL2 keyboard/mouse events in play instance
   - Translate to `on_key` / `on_key_up` events on EventBus
   - Also accept AI input via WebSocket (`ku input key right down`)
   - Mouse click → `on_click` event with `{x, y}` world coordinates

4. **Query system**:
   - `ku query scene` — full tree serialized
   - `ku query nodes --type Sprite` — filtered list
   - `ku query collisions` — active pairs from physics
   - `ku query diff` — track property changes frame-over-frame, return deltas
   - `ku watch path.prop` — subscribe to property changes via streaming WebSocket

### Tests
- Game loop runs at ~60 FPS
- Pause/resume stops and starts the loop
- Step advances exactly one frame
- AI input triggers same events as keyboard
- Diff tracking detects property changes between queries

### Checkpoint — Full workflow
```bash
ku init my-game
ku edit level_1
ku node add / player Node2D --props '{"x":100,"y":300}'
ku node add player sprite Sprite --props '{"texture":"player.png"}'
ku node add player body RigidBody --props '{"mass":1,"gravity_scale":1}'
ku node add player shape CollisionShape --props '{"shape":"rect","width":32,"height":48}'
ku scene save

ku play                      # window opens, player falls with gravity
ku attach play
ku input key right down      # player moves right (with script)
ku query player.x            # {"x": 105}
ku query diff                # shows position change
ku stop play                 # window closes, state discarded

ku attach edit               # back to editor, scene unchanged
ku node get player.x         # {"x": 100} — original value
```

---

## Dependency summary

```
Phase 1 (Core data model)
  └── Phase 2 (Server + CLI)
        └── Phase 3 (Script engine)
              └── Phase 4 (Physics)
                    └── Phase 5 (Renderer)
                          └── Phase 6 (Game loop + input)
```

Phases 4 and 5 are independent of each other — both depend on Phase 3 and feed into Phase 6. They can be developed in parallel.

## Testing strategy

- **Phases 1-3**: Unit tests with vitest. No external dependencies.
- **Phase 4**: Unit tests with matter-js (no window needed).
- **Phase 5**: Manual visual testing. No automated tests for rendering.
- **Phase 6**: Integration tests — start server, send commands, assert responses. Mock SDL2 input.

## Estimated effort

| Phase | Description | Complexity |
|-------|-------------|-----------|
| 1 | Core data model | Medium |
| 2 | Server + CLI | High (most files) |
| 3 | Script engine | High (expression parser, action execution) |
| 4 | Physics | Medium (matter-js integration) |
| 5 | Renderer | Medium (SDL2 drawing) |
| 6 | Game loop + input | Medium (orchestration) |
