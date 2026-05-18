# ku Engine — Milestone 1.0 Architecture Review

## Status

All 6 implementation phases complete. Two example games (Flappy Bird, Spacecraft) functional. JS scripting engine added as hybrid option. ~3,800 lines TypeScript, 37 source files, 7 test suites.

## Architecture Scorecard

| Area | Grade | Notes |
|------|-------|-------|
| Dual-instance model | A | Editor/Play separation is the right call for AI agents |
| JSON + JS hybrid scripting | A- | JSON for simple rules, JS for complex logic; covers both ends |
| JS scripting engine (new) | B+ | Sandboxed VM, clean API; spawn broken, no dt in context |
| Sync protocol | A- | Snapshot + delta stream clean; missing granular script edits |
| Node/tree model | A- | Godot-inspired, path addressing, well-typed; no prefab system |
| Expression evaluator | C | Regex-based, no nesting, cross-node refs break in arithmetic |
| Condition system | C- | Node-local only; can't reference other nodes (JS scripts bypass this) |
| Physics integration | B | Matter.js wired correctly; shapes don't follow parents |
| Renderer | B- | Functional; CPU canvas→SDL2 copy wastes bandwidth |
| Game loop | B- | Works; setInterval instead of fixed-timestep |
| Error handling | D | Silent catch blocks everywhere; zero feedback for script failures |
| Audio | F | AudioPlayer type exists, no backend |
| Testing | B | Core engine tested; no integration/CLI tests |

---

## Strengths

### 1. Dual-instance separation (Editor/Play)

```
Editor (port 21200)          Play (port 21201)
├── Persistent               ├── Ephemeral
├── No physics/scripts       ├── Full game loop
├── File I/O                 ├── Syncs from editor snapshot
└── Node CRUD                └── Input + rendering
```

Correct decision. AI agents iterate via edit→play→stop→edit without risking scene corruption. Mirrors Unity/Godot editor/play-mode split but adapted for CLI. Play instance is disposable by design.

### 2. JSON-native scripting

Pure JSON event-action rules. No embedded Lua/JS. LLMs can generate and modify scripts without hallucinating syntax errors in a traditional programming language.

```json
{
  "event": "on_collision",
  "filter": {"with": "coin"},
  "actions": [
    {"destroy": "{{other}}"},
    {"emit": "coin_collected"}
  ]
}
```

Event model covers the standard 2D game events: `on_key`, `on_collision`, `on_frame`, `on_timer`, `on_touch_start`, `on_area_enter`, etc. Cross-node references via `{{/nodeId/property}}` are clean and intuitive.

### 3. WebSocket sync protocol

Snapshot for initial load, delta stream for hot-reload. Guard properties (`x`, `y`, `velocity`) on RigidBody nodes prevent editor edits from fighting physics. The protocol is minimal, sufficient, and correct.

Delta types: `add`, `remove`, `set`, `move`, `replace_scripts`, `replace_all`.

### 4. Collision enter/exit tracking

`CollisionEvents` maintains frame-over-frame pair sets to detect enter vs. stay vs. exit. This prevents re-triggering `on_collision` every frame for persistent contacts. Fires events for both nodes in a pair with `other` and `otherTags` context.

### 5. Object pooling via spawn/destroy

The `spawn` action with explicit `as` naming + `destroy` action enables object pools (see spacecraft bullet recycling). Essential for bullet-hell / shmup genres. Spawned nodes can carry their own scripts.

---

## Weaknesses

### 1. Expression evaluator: regex hack, no nesting

**Location:** `src/engine/expression-evaluator.ts`

Only `A op B` binary arithmetic. Regex-based parsing with no tokenizer/AST.

```typescript
// What works:
{{speed + 10}}       // property + literal
{{x + speed}}        // property + property
{{/player/score}}    // cross-node ref (bare)
{{random(0, 100)}}   // single function call

// What fails:
{{/player/x + 50}}           // cross-node ref inside arithmetic
{{speed * 2 + 10}}           // more than one operator
{{(speed + 10) * 2}}         // parentheses
{{min(speed, maxSpeed)}}     // second function
{{"Score: " + score}}        // string concatenation
```

**Root cause:** Cross-node refs (`{{/...}}`) are resolved by a *separate* regex pass in `resolveCrossNodeRefs()` (script-engine.ts:192-207) *before* the expression evaluator runs. The expression evaluator's arithmetic regex (`/^([\w.]+)\s*([+\-*/%])\s*([\w.]+|-?\d+(?:\.\d+)?)$/`) only matches `word op word-or-number`, so anything with `/` in it fails to parse.

**Fix path:** Replace regex-based parser with a proper tokenizer + recursive descent parser that shares one unified symbol resolver. Cross-node refs, property refs, context refs, and function calls should all resolve through the same `resolveSymbol(name)` path during AST evaluation.

### 2. Conditions: node-local only, no cross-node references

**Location:** `src/engine/conditions.ts`

`resolveValue()` only traverses the current node's properties. There is no `{{/otherNode/prop}}` resolution path.

```json
// This DOES NOT work — condition can't see player.dead:
{
  "event": "on_frame",
  "condition": {"/player/dead": {"neq": true}},
  "actions": [{"set": "score", "to": "{{score + 1}}"}]
}
```

The spacecraft score bug (keeps counting after player dies) is a direct consequence. This blocks all inter-entity game logic.

**Fix path:** Extend `resolveValue()` in conditions.ts to recognize `/nodeId/prop` paths and resolve them through the tree. Reuse the cross-node resolution logic from `script-engine.ts:resolveCrossNodeRefs()`.

### 3. CollisionShape doesn't follow parent RigidBody

**Location:** `src/engine/physics.ts:151-189`

Shapes are created as static Matter bodies at a fixed world position. The parent offset is computed once at `syncShape()` time and baked in. When physics moves the parent RigidBody, the shape stays behind.

```typescript
// physics.ts:158-164 — offset computed once, never updated per frame
if (parentPath) {
  const parent = this.tree.get(parentPath);
  x += (parent.getProperty('x') as number) ?? 0;
  y += (parent.getProperty('y') as number) ?? 0;
}
```

Matter.js `Body.setPosition()` on a static body does update its position, but `syncShape()` is only called on initial sync or hot-reload delta — not every frame. So the shape stays at its initial world position.

**Fix path:** Option A — On each `step()`, iterate shapes with parents and reposition them to parent position + offset. Option B — Use Matter.js `Matter.Constraint` to pin shapes to parent bodies. Option A is simpler and sufficient for top-down 2D.

### 4. Silent error swallowing

**Location:** `src/engine/script-engine.ts`

Multiple try/catch blocks with empty catch bodies:

```typescript
// line 78-80: set_on silently fails
try {
  const target = this.tree.get(action.set_on);
  // ...
} catch { /* target not found */ }

// line 94: destroy silently fails
try { this.tree.remove(path); } catch { /* node may already be gone */ }

// line 156-157: spawn silently fails
} catch { /* unknown type or tree error — skip */ }

// line 175, 189: play/stop silently fail
} catch { /* ignore */ }
```

For a human developer, this is frustrating. For an LLM generating scripts, it's catastrophic — the LLM gets zero signal that its script failed, cannot self-correct, and cannot diagnose problems.

**Fix path:** Add an error collector to ScriptEngine. Each failed action logs a structured error `{script, node, action, reason}`. Expose via `query.errors` or a `ku log` stream. Scripts can optionally configure `"on_error": "skip" | "halt"` per rule.

### 5. CPU canvas → SDL2 buffer copy every frame

**Location:** `src/renderer/renderer.ts:233-239`

```typescript
private present(): void {
  const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
  const buffer = Buffer.from(imageData.data);
  this.window.render(this.width, this.height, this.width * 4, 'rgba32', buffer);
}
```

Every frame: draw to `@napi-rs/canvas` (CPU-side), extract raw RGBA, copy to Buffer, push to SDL2. At 640×480, that's ~1.2 MB per frame. At 60 FPS, ~72 MB/s memory bandwidth consumed just moving pixels.

SDL2 has a GPU-accelerated 2D renderer API (`sdl.video.createRenderer()`) that supports textured quads, rectangles, and lines directly. The canvas approach was chosen because SDL2's text rendering is weak and `@napi-rs/canvas` fills that gap, but the cost is the entire framebuffer copy.

**Fix path:** Use SDL2's renderer for sprites, shapes, and tilemaps (GPU path). Keep canvas only for text rendering, composite the text overlay onto the SDL2 framebuffer. This reduces the per-frame copy from full-screen to text regions only.

### 6. setInterval game loop, no fixed timestep

**Location:** `src/engine/game-loop.ts:52`

```typescript
this.intervalId = setInterval(() => this.tick(), 1000 / this.fps);
```

Problems:
- No vsync awareness — can tear mid-frame
- No frame timing compensation — `setInterval` drift accumulates
- Physics gets `1000/fps` as `dt` regardless of actual elapsed time
- No accumulator — if a frame takes longer than `1/fps`, physics runs at the wrong step size

**Fix path:** Use the standard game loop pattern:

```
accumulator = 0
previousTime = now()
loop:
  currentTime = now()
  frameTime = currentTime - previousTime
  previousTime = currentTime
  accumulator += frameTime
  while accumulator >= fixedDt:
    physics.step(fixedDt)
    accumulator -= fixedDt
  scripts.evaluateFrame()
  render(accumulator / fixedDt) // interpolation alpha
```

### 7. No scene instancing / prefab system

DESIGN.md specifies `"instance": "scenes/player.json"` for reusable entities. This is not implemented. Every entity must be fully inlined.

Impact: spacecraft's 8 enemies are 8 full copy-pasted node blocks in `main.json` (~200 lines each). A prefab would reduce this to 8 one-line references + 1 enemy template definition.

**Fix path:** Implement `NodeRef` as a new node type or a resolution step in scene loading. When scene is loaded, `instance` references are resolved by loading the referenced scene file and merging its root node into the tree.

### 8. No audio backend

AudioPlayer node type defined. `play`/`stop` actions exist. But `executePlay`/`executeStop` only handle AnimatedSprite and Timer nodes — there's no audio path at all.

SDL2 has audio support. `@kmamal/sdl` exposes it. This just needs wiring.

### 9. Single scene, no level transitions

No `change_scene` action. No scene stack. No additive scene loading. Level transitions require `ku stop play` + `ku play` with a different scene — losing all runtime state.

### 10. Message handler is a monolith

**Location:** `src/server/message-handler.ts:58-248`

Single `route()` function with ~25 `case` branches. No middleware, no action registry, no plugin hooks. Fine for now, but blocks extensibility.

### 11. No delta edits for scripts

Sync protocol has `replace_scripts` (full array replacement). No `script.add`, `script.rm`, `script.set` operations. Editing one action in a 20-action script sends all 20 over the wire. Two concurrent editors can't modify different scripts on the same node.

---

## Missing Features — Prioritized

### P0 — Blocks non-trivial game logic

| # | Feature | Where | Approach |
|---|---------|-------|----------|
| 1 | **Cross-node conditions** | `src/engine/conditions.ts` | Extend `resolveValue()` to resolve `/nodeId/prop` paths through tree |
| 2 | **Expression evaluator rewrite** | `src/engine/expression-evaluator.ts` | Tokenizer + recursive descent parser; unify symbol resolution |
| 3 | **Parent-relative physics shapes** | `src/engine/physics.ts` | Reposition child shapes to parent position in `step()` loop |
| 4 | **Script error reporting** | `src/engine/script-engine.ts` | Collect structured errors; expose via query/log; add `on_error` rule |

### P1 — Enables real game projects

| # | Feature | Where | Approach |
|---|---------|-------|----------|
| 5 | **Scene instancing / prefabs** | `src/engine/scene-file.ts`, `src/engine/scene-tree.ts` | `NodeRef` resolution at load time; merge referenced scene root |
| 6 | **Fixed-timestep game loop** | `src/engine/game-loop.ts` | Accumulator pattern; `performance.now()` timing |
| 7 | **Audio backend** | New: `src/engine/audio.ts` | Wire SDL2 audio; connect to AudioPlayer + play/stop actions |
| 8 | **Level transitions** | `src/engine/script-engine.ts` | `change_scene` action; optional additive load |
| 9 | **Runtime state save/load** | `src/engine/scene-file.ts` | Serialize full tree (including runtime-spawned nodes) to JSON |
| 10 | **Delta script edits** | `src/server/message-handler.ts`, `src/server/sync-client.ts` | `script.add`, `script.rm`, `script.set` sync ops |

### P2 — Quality, performance, extensibility

| # | Feature | Where | Approach |
|---|---------|-------|----------|
| 11 | **GPU rendering path** | `src/renderer/renderer.ts` | SDL2 renderer for sprites/shapes; canvas only for text overlay |
| 12 | **Script validation** | `src/engine/script-engine.ts` | Validate events, actions, property paths on registration |
| 13 | **Atlas metadata support** | `src/renderer/sprite-renderer.ts` | Parse TexturePacker/Aseprite JSON; frame rects, offsets, trim |
| 14 | **Tree dirty flags** | `src/engine/scene-tree.ts` | Track modified node IDs; only traverse changed subtrees |
| 15 | **Plugin system** | `src/engine/` | Extension points: custom node types, custom actions, custom renderers |
| 16 | **Integration tests** | `test/` | End-to-end: start server, send commands, assert responses |
| 17 | **Property change events** | `src/engine/node.ts` | `onPropertyChanged` hook for reactive patterns within scripts |

---

## Architecture Debt

| Item | Severity | Fix |
|------|----------|-----|
| `getParentPath()` full tree traversal per call (physics.ts:216) | Medium | Cache parent references or pass parent during traversal |
| `message-handler.ts` global mutable state for `gameLoop`/`inputManager` | Medium | Pass as constructor/setup args, not module-level vars |
| `message-handler.ts` monolith switch statement | Low | Action registry map with middleware chain |
| No frame timing budget monitoring | Low | Track `tick()` duration; expose via `query.stats` |
| Texture cache no eviction policy | Low | LRU cache with configurable size limit |
| `sync-client.ts` double-registers `ws.on('message')` handler (lines 48 and 66) | Medium | Second `on('message')` overwrites the snapshot handler; race condition if deltas arrive before snapshot ACK |

---

## Recommendation

**Stop feature work. Fix P0 first.** The three P0 items — cross-node conditions, expression evaluator, and error reporting — are existential for an LLM-targeted engine. Silent failures + limited expression power mean AI agents can't build or debug non-trivial games. Without these, ku can only produce toy examples.

P0 estimate: ~3-5 days of focused work. The expression evaluator rewrite is the largest item (design a proper grammar, write the parser, migrate all existing expressions). Cross-node conditions and error reporting are straightforward additions to existing code paths.

After P0, the spacecraft example should be updatable to fix its known limitations (score stopping on death, gravity_scale working, etc.). That becomes the validation test.

---

## Milestone 1.1: JS Scripting Engine

### What shipped

A Node.js `vm`-based JS scripting engine (`src/engine/js-script-engine.ts`) that runs alongside the existing JSON `ScriptEngine`. Scripts are `.js` files referenced by a `js_script` property on nodes. The `vm.Script` + `createContext` sandbox provides per-node isolated state without `require`/`process`/`fs` access.

Scripts register handlers by assigning to a `handlers` object injected into the sandbox:

```js
handlers.on_frame = function(ctx) {
  if (ctx.scene.get('player', 'dead')) return;
  ctx.node.set('score', ctx.node.get('score') + 1);
};
```

This solves the two biggest P0 problems from the JSON-only engine: **cross-node conditions** (`ctx.scene.get('player', 'dead')`) and **control flow** (`if`, `for`, local variables, helper functions).

### boss.js review

`examples/spacecraft/scripts/boss.js` is the first JS-scripted entity — a boss that spawns at score 500, sweeps left-right, fires bullet spreads, takes 30 hits to kill.

**What works well:**

| Aspect | Notes |
|--------|-------|
| Cross-node access | `ctx.scene.get('player', 'dead')` — reads other nodes. `ctx.scene.set('player', 'score', val)` — writes across tree. This is the feature JSON conditions lacked. |
| Control flow | Guard clauses (`if (!active) return;`), state machines with local vars, for-loops for cleanup — all impossible in JSON. |
| Per-node state | `var fireTimer = 0; var spawned = false;` — module-level vars persist across frames without polluting the node property tree. Sandbox-per-node means two bosses with the same script get independent state. |
| Helper functions | `fireAtPlayer(ctx)` — named function, natural code organization. No need for fragmented event registrations. |
| Flash effect | Alternating color every other frame during hitstun — trivial in JS, impossible in JSON expressions. |
| Game over handling | `handlers.game_over` loops to deactivate all bullets. Loops don't exist in JSON. |

**Issues in boss.js:**

| Line | Issue | Severity |
|------|-------|----------|
| 35, 55 | `ctx.node.set('velocity', {x:0, y:0})` — workaround for gravity_scale not working. JS scripts shouldn't need to fight the physics engine. | Low |
| 51 | `x += SWEEP_SPEED * sweepDir` — frame-rate-dependent movement. No `dt` in context. | Low |
| 86 | `ctx.scene.set(bulletId, 'x', bx)` — relies on pre-placed bullet nodes in the scene tree. `ctx.scene.spawn` exists in API but is broken (see below). | Medium |

### JS engine architecture concerns

**1. `ctx.scene.spawn` is incomplete. (Medium severity)**

`js-script-engine.ts:137-142` creates a node and adds it to the tree but never registers it with the JSON script engine, JS script engine (for child scripts), or physics world. Spawned RigidBody nodes get no physics body. Spawned nodes with their own `js_script` get no handlers.

```typescript
// Current: node is added to tree only
spawn: (type, id, props) => {
  const node = createNodeByType(type, id, props);
  this.tree.add('/', node);
  // MISSING: physics.syncNode(node), scripts.registerNode(node), jsScripts.registerNode(node)
}
```

boss.js dodges this by pre-placing 5 `boss_bullet_N` nodes in the scene and repositioning them via `set` instead of spawning. This works but is fragile and defeats the purpose of a spawn API.

**Fix:** `JsScriptEngine` needs references to `ScriptEngine` and `PhysicsWorld` (or a callback) to register spawned nodes with the full engine pipeline. Same pattern `GameLoop` already uses for `SyncClient.applyOp`.

**2. No `dt` (delta time) in frame context. (Low severity)**

`evaluateEvent()` builds the `ctx` object with `node`, `scene`, `data`, `emit`, `log` — no `dt`. Every JS script will hardcode frame-rate-dependent movement. The game loop already knows the delta — just needs to pass it through.

**Fix:** One-line addition to `evaluateEvent`:
```typescript
const ctx = {
  node: this.createNodeApi(reg.node),
  scene: this.createSceneApi(),
  data,
  dt: 1000 / 60, // or computed from actual frame time
  emit: (name, payload) => { ... },
  log: (...args) => { ... },
};
```

**3. Sandboxing is shallow-correct, fragile. (Low severity)**

`Object.freeze` on the sandbox is shallow — `handlers` stays mutable because it's a nested plain object. This works today. If someone later changes to `deepFreeze`, all scripts break silently. The invariant "handlers must be a mutable plain object" is not documented or tested.

**Fix:** Add a comment in `js-script-engine.ts` documenting this invariant. Optionally add a unit test that verifies `handlers` is writable after context creation.

**4. Error logging is stringly-typed. (Low severity)**

`logs.push('JS handler error (on_frame): ...')` — better than JSON's total silence, but still a flat string. An AI consumer can't programmatically determine which node, script, or handler failed.

**Fix:** Structured error format:
```typescript
logs.push(JSON.stringify({
  type: 'js_error',
  node: reg.node.id,
  script: absPath,
  event,
  error: (err as Error).message,
  stack: (err as Error).stack,
}));
```

**5. `ctx.scene.set` swallows errors silently. (Low severity)**

`js-script-engine.ts:133-136` — writing to a nonexistent node path silently does nothing. Same problem as the JSON engine's `set_on`. boss.js writes to pre-placed bullets that always exist, so it's not hit. But future scripts will write to dynamically spawned nodes and get zero feedback on failure.

**Fix:** Return boolean from `set` indicating success. Let the caller decide to ignore.

**6. JS and JSON engines are parallel universes. (Design note, not a bug)**

Custom events from JS (`ctx.emit('boss_killed')`) fire through `JsScriptEngine`'s own `EventBus`, which is separate from the JSON `ScriptEngine`'s bus. So JSON scripts can't react to JS-emitted custom events. Collision/input events are dispatched to both engines (correct), but custom events are siloed. Intentional or not — this should be a documented design decision.

**Fix:** Either pass a shared `EventBus` to both engines (already supported via `JsScriptEngineOptions.bus`) and bridge custom events, or document the siloing as intentional.

### Hybrid scripting: JSON + JS — assessment

The two engines coexist cleanly. The pattern is:

| Complexity | Use | Example |
|-----------|-----|---------|
| Simple property sets | JSON | "on death, set dead=true" |
| Collision reactions | JSON | "on collision with coin, destroy coin, emit sound" |
| Input mapping | JSON | "on key SPACE, set velocity.y = -200" |
| State machines, AI | JS | Boss phases, enemy AI, procedural spawn patterns |
| Cross-node logic | JS | Score that reads player.dead, HUD that tracks boss HP |
| Loops, arrays, math | JS | Bullet spreads, wave spawning, complex movement patterns |

The JSON path handles the 80% of game logic that is simple event→action. The JS path handles the 20% that needs control flow and cross-node state. This is the correct split.

### Updated P0 priorities

With JS scripting landed, cross-node conditions (original P0 #1) and complex expression evaluation (original P0 #2) are partially addressed — JS scripts can do both. But JSON-only scripts still have the same limitations. The revised P0 list:

| # | Feature | Applies to | Notes |
|---|---------|-----------|-------|
| 1 | **Script error reporting** | Both engines | Still the #1 problem. Silent failures kill AI productivity regardless of format. |
| 2 | **Fix `ctx.scene.spawn`** | JS engine | Broken API blocks dynamic entity creation from JS scripts. |
| 3 | **Parent-relative physics shapes** | Both engines | Unchanged from original review. |
| 4 | **Cross-node conditions in JSON** | JSON engine | JS scripts have this now, but JSON conditions still can't read other nodes. Lower priority since JS is the escape hatch. |

### Verification checklist for JS scripting

- [ ] `ctx.scene.spawn` creates fully functional nodes (scripts registered, physics body created)
- [ ] `dt` present in `ctx` for frame-rate-independent movement
- [ ] Structured error objects in logs (node, script, event, error, stack)
- [ ] Custom events bridged between JS and JSON engines (or siloing documented)
- [ ] `ctx.scene.set` returns boolean success/failure
- [ ] Hot-reload of `js_script` property works without handler gaps
- [ ] Two nodes with same script file get independent state (test: two bosses, different HP)
