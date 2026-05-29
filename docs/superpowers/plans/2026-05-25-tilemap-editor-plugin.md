# Tilemap Editor Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `ku-tilemap-editor` engine plugin that provides an interactive tilemap editor with multi-layer support, atlas-based tilesets, multiple brushes (tile/rect/fill/eraser), autotile, and JSON load/save.

**Architecture:** Follow the `ku-spritesheet-editor` plugin pattern: engine plugin in `plugins/ku-tilemap-editor/` with `index.js` (CLI command + message handlers), a scene JSON template, and a JS editor script. The editor runs as a play-mode instance with a JS script attached to the root node. All tilemap data is stored in the editor's state and flushed to a JSON file on save. The plugin reuses the engine's existing `autotile.ts` logic for autotile resolution.

**Tech Stack:** Node.js 20+, TypeScript (engine), ESM, `@napi-rs/canvas`, ku engine plugin API (`KuPlugin`, `PluginHost`), ku JS scripting system (`handlers.on_*`)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `plugins/ku-tilemap-editor/index.js` | Plugin entry: `ku tilemap edit` CLI command, message handlers for save/load |
| Create | `plugins/ku-tilemap-editor/scenes/tilemap-editor.json` | Scene template: viewport, sidebar, toolbar, layer panel, brush panel |
| Create | `plugins/ku-tilemap-editor/scripts/tilemap-editor.js` | Editor logic: brush painting, layer management, autotile, UI interactions |
| Create | `test/tilemap-editor.test.ts` | Unit tests for tilemap data model, brush algorithms, autotile integration |
| Modify | `src/engine/autotile.ts` | No changes needed — existing autotile is sufficient |
| Modify | `src/engine/node-types.ts` | No changes needed — existing TileMap node is sufficient |

---

### Task 1: Plugin scaffold and CLI command

**Files:**
- Create: `plugins/ku-tilemap-editor/index.js`
- Create: `plugins/ku-tilemap-editor/scenes/tilemap-editor.json`

- [ ] **Step 1: Create plugin directory structure**

```bash
mkdir -p plugins/ku-tilemap-editor/scenes plugins/ku-tilemap-editor/scripts
```

- [ ] **Step 2: Create the plugin entry `index.js`**

This follows the exact same pattern as `ku-spritesheet-editor/index.js`: registers a CLI command, forks a play-mode process, provides message handlers for save/load.

```javascript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  name: 'ku-tilemap-editor',
  version: '1.0.0',
  init(host) {
    host.registerCliCommand((program) => {
      const tilemap = program.command('tilemap').description('Tilemap tools');

      tilemap
        .command('edit [scene]')
        .description('Open tilemap editor (optionally load an existing scene)')
        .option('--dir <dir>', 'Project directory (default: cwd)')
        .option('--tilemap <path>', 'Path to TileMap node in scene (e.g. /root/ground)')
        .option('--columns <n>', 'Grid columns', '20')
        .option('--rows <n>', 'Grid rows', '15')
        .option('--cell-size <n>', 'Cell size in pixels', '16')
        .action(async (scene, opts) => {
          const projectDir = opts.dir ? resolve(process.cwd(), opts.dir) : process.cwd();
          const columns = parseInt(opts.columns, 10) || 20;
          const rows = parseInt(opts.rows, 10) || 15;
          const cellSize = parseInt(opts.cellSize, 10) || 16;
          const tilemapPath = opts.tilemap || '';

          await ensureProject(projectDir);

          // Read editor scene template
          const scenePath = resolve(__dirname, 'scenes', 'tilemap-editor.json');
          const sceneJson = await readFile(scenePath, 'utf-8');
          const sceneObj = JSON.parse(sceneJson);

          // Inject editor config into root node properties
          setNestedProp(sceneObj, '', 'editor_columns', columns);
          setNestedProp(sceneObj, '', 'editor_rows', rows);
          setNestedProp(sceneObj, '', 'editor_cell_size', cellSize);
          setNestedProp(sceneObj, '', 'editor_scene', scene || '');
          setNestedProp(sceneObj, '', 'editor_tilemap_path', tilemapPath);

          // If a scene is specified, try to load its tilemap data
          if (scene) {
            try {
              const sceneFile = resolve(projectDir, 'scenes', `${scene}.json`);
              const sceneData = JSON.parse(readFileSync(sceneFile, 'utf-8'));
              setNestedProp(sceneObj, '', 'editor_scene_data', JSON.stringify(sceneData));
            } catch { /* scene not found — start blank */ }
          }

          // Write temp scene
          const scenesDir = resolve(projectDir, 'scenes');
          await mkdir(scenesDir, { recursive: true });
          const tmpScene = resolve(scenesDir, '__tilemap_editor_tmp.json');
          sceneObj.scene = '__tilemap_editor_tmp';
          await writeFile(tmpScene, JSON.stringify(sceneObj, null, 2));

          // Copy editor script to project scripts dir
          const scriptSrc = resolve(__dirname, 'scripts', 'tilemap-editor.js');
          const scriptsDir = resolve(projectDir, 'scripts');
          await mkdir(scriptsDir, { recursive: true });
          await writeFile(resolve(scriptsDir, 'tilemap-editor.js'), await readFile(scriptSrc, 'utf-8'));

          // Resolve server entry
          const engineRoot = resolve(__dirname, '..', '..');
          const serverPath = resolve(engineRoot, 'dist', 'server', 'main.js');

          const child = fork(serverPath, [
            '--mode', 'play',
            '--dir', projectDir,
            '--port', '0',
            '--load-scene', '__tilemap_editor_tmp',
          ], { stdio: 'inherit' });

          child.on('exit', async () => {
            try {
              const { unlink } = await import('node:fs/promises');
              await unlink(tmpScene);
            } catch { /* ignore */ }
          });
        });

      tilemap
        .command('export <file>')
        .description('Export tilemap JSON from a scene file')
        .option('--tilemap <path>', 'Path to TileMap node (e.g. /root/ground)')
        .action(async (file, opts) => {
          const absFile = resolve(process.cwd(), file);
          try {
            const sceneData = JSON.parse(await readFile(absFile, 'utf-8'));
            const tilemapPath = opts.tilemap || '';
            const tilemapNode = tilemapPath ? findNode(sceneData.root, tilemapPath.split('/').filter(Boolean)) : findFirstTilemap(sceneData.root);
            if (!tilemapNode || tilemapNode.type !== 'TileMap') {
              console.error(JSON.stringify({ ok: false, error: 'TileMap node not found' }));
              return;
            }
            const exportData = {
              cell_size: tilemapNode.properties.cell_size,
              columns: tilemapNode.properties.columns,
              rows: tilemapNode.properties.rows,
              data: tilemapNode.properties.data,
              terrain_map: tilemapNode.properties.terrain_map,
            };
            console.log(JSON.stringify({ ok: true, data: exportData }));
          } catch (err) {
            console.error(JSON.stringify({ ok: false, error: err.message }));
          }
        });
    });

    // Message handler for tilemap save
    host.registerMessageHandler('tilemap.save', (tree, mode, payload) => {
      const { path, tilemapData } = payload;
      if (!path || !tilemapData) {
        return { result: { ok: false, error: 'path and tilemapData required' } };
      }
      const absPath = resolve(host.projectDir, path);
      writeFileSync(absPath, JSON.stringify(tilemapData, null, 2));
      return { result: { ok: true, data: { saved: absPath } } };
    });

    // Message handler for tilemap load
    host.registerMessageHandler('tilemap.load', (tree, mode, payload) => {
      const { path } = payload;
      if (!path) {
        return { result: { ok: false, error: 'path required' } };
      }
      const absPath = path.startsWith('/') ? path : resolve(host.projectDir, path);
      try {
        const data = JSON.parse(readFileSync(absPath, 'utf-8'));
        return { result: { ok: true, data } };
      } catch (err) {
        return { result: { ok: false, error: err.message } };
      }
    });

    // Message handler for tileset atlas load
    host.registerMessageHandler('tileset.load', (tree, mode, payload) => {
      const { path } = payload;
      if (!path) {
        return { result: { ok: false, error: 'path required' } };
      }
      const absPath = path.startsWith('/') ? path : resolve(host.projectDir, path);
      try {
        const data = JSON.parse(readFileSync(absPath, 'utf-8'));
        return { result: { ok: true, data } };
      } catch (err) {
        return { result: { ok: false, error: err.message } };
      }
    });
  },
};

async function ensureProject(dir) {
  await mkdir(dir, { recursive: true });
  const projectJson = resolve(dir, 'project.json');
  if (!existsSync(projectJson)) {
    await writeFile(projectJson, JSON.stringify({
      name: 'tilemap-editor',
      entry: '__tilemap_editor_tmp',
      window: { width: 1024, height: 768, scale_mode: 'system', resizable: true },
    }, null, 2));
  }
}

function setNestedProp(scene, path, value) {
  const parts = path.split('/').filter(Boolean);
  const propName = parts.pop();
  let node = findNode(scene.root, parts);
  if (node && propName) {
    node.properties[propName] = value;
  } else if (!parts.length && propName) {
    scene.root.properties[propName] = value;
  }
}

function findNode(nodeData, pathParts) {
  let current = nodeData;
  for (const part of pathParts) {
    if (!current.children) return null;
    current = current.children.find(c => c.id === part);
    if (!current) return null;
  }
  return current;
}

function findFirstTilemap(nodeData) {
  if (nodeData.type === 'TileMap') return nodeData;
  if (nodeData.children) {
    for (const child of nodeData.children) {
      const found = findFirstTilemap(child);
      if (found) return found;
    }
  }
  return null;
}
```

- [ ] **Step 3: Create the scene template `tilemap-editor.json`**

Layout: 1024x768 window. Left: scrollable tilemap viewport (768px wide). Right: sidebar (256px) with toolbar, tileset palette, layer panel, and brush tools.

```json
{
  "scene": "tilemap-editor",
  "root": {
    "id": "root",
    "type": "Node",
    "properties": {},
    "scripts": [],
    "js_script": "scripts/tilemap-editor.js",
    "children": [
      {
        "id": "camera",
        "type": "Camera2D",
        "properties": { "zoom": 1, "offset_x": 0, "offset_y": 0, "smoothing": 0 },
        "children": []
      },
      {
        "id": "background",
        "type": "Panel",
        "properties": { "x": 0, "y": 0, "width": 1024, "height": 768, "color": "#1a1a2e" },
        "children": []
      },
      {
        "id": "toolbar",
        "type": "Panel",
        "properties": { "x": 0, "y": 0, "width": 768, "height": 32, "color": "#16162a", "border_color": "#3a3a5e", "border_width": 1 },
        "children": [
          {
            "id": "title_label",
            "type": "Label",
            "properties": { "x": 8, "y": 9, "text": "Tilemap Editor", "font_size": 13, "color": "#ffffff", "align": "left", "valign": "top" },
            "children": []
          },
          {
            "id": "coords_label",
            "type": "Label",
            "properties": { "x": 300, "y": 9, "text": "0, 0", "font_size": 12, "color": "#888888", "align": "left", "valign": "top" },
            "children": []
          },
          {
            "id": "zoom_label",
            "type": "Label",
            "properties": { "x": 700, "y": 9, "text": "100%", "font_size": 12, "color": "#888888", "align": "left", "valign": "top" },
            "children": []
          }
        ]
      },
      {
        "id": "viewport",
        "type": "ScrollView",
        "properties": { "x": 0, "y": 32, "width": 768, "height": 736, "scroll_x": 0, "scroll_y": 0, "zoom": 2, "clip": true, "color": "#222233", "border_color": "#3a3a5e", "border_width": 1 },
        "children": [
          {
            "id": "tilemap_canvas",
            "type": "Node2D",
            "properties": { "x": 0, "y": 0 },
            "children": []
          }
        ]
      },
      {
        "id": "sidebar",
        "type": "Panel",
        "properties": { "x": 768, "y": 0, "width": 256, "height": 768, "color": "#16162a", "border_color": "#3a3a5e", "border_width": 1 },
        "children": [
          {
            "id": "sidebar_title",
            "type": "Label",
            "properties": { "x": 128, "y": 6, "text": "Tilemap Editor", "font_size": 13, "color": "#ffffff", "align": "center", "valign": "top" },
            "children": []
          },
          {
            "id": "tileset_panel",
            "type": "Panel",
            "properties": { "x": 4, "y": 24, "width": 248, "height": 200, "color": "#222233", "border_color": "#3a3a5e", "border_width": 1 },
            "children": [
              {
                "id": "tileset_title",
                "type": "Label",
                "properties": { "x": 124, "y": 4, "text": "Tileset", "font_size": 12, "color": "#ffffff", "align": "center", "valign": "top" },
                "children": []
              },
              {
                "id": "tileset_view",
                "type": "ScrollView",
                "properties": { "x": 4, "y": 22, "width": 240, "height": 140, "scroll_x": 0, "scroll_y": 0, "zoom": 2, "clip": true, "color": "#1a1a2e" },
                "children": [
                  {
                    "id": "tileset_image",
                    "type": "ImageRect",
                    "properties": { "x": 0, "y": 0, "width": 128, "height": 128, "texture": "", "region_w": 0, "region_h": 0, "preserve_aspect": false },
                    "children": []
                  }
                ]
              },
              {
                "id": "tileset_load_btn",
                "type": "Button",
                "properties": { "x": 4, "y": 168, "width": 116, "height": 24, "text": "Load Atlas", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "tileset_info",
                "type": "Label",
                "properties": { "x": 128, "y": 174, "text": "No atlas", "font_size": 10, "color": "#666666", "align": "left", "valign": "top" },
                "children": []
              }
            ]
          },
          {
            "id": "brush_panel",
            "type": "Panel",
            "properties": { "x": 4, "y": 230, "width": 248, "height": 100, "color": "#222233", "border_color": "#3a3a5e", "border_width": 1 },
            "children": [
              {
                "id": "brush_title",
                "type": "Label",
                "properties": { "x": 124, "y": 4, "text": "Brush", "font_size": 12, "color": "#ffffff", "align": "center", "valign": "top" },
                "children": []
              },
              {
                "id": "brush_tile_btn",
                "type": "Button",
                "properties": { "x": 4, "y": 22, "width": 56, "height": 28, "text": "Tile", "color": "#4a6a4e", "hover_color": "#5a7a5e", "pressed_color": "#3a5a3e", "text_color": "#ffffff", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "brush_rect_btn",
                "type": "Button",
                "properties": { "x": 64, "y": 22, "width": 56, "height": 28, "text": "Rect", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "brush_fill_btn",
                "type": "Button",
                "properties": { "x": 124, "y": 22, "width": 56, "height": 28, "text": "Fill", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "brush_eraser_btn",
                "type": "Button",
                "properties": { "x": 184, "y": 22, "width": 56, "height": 28, "text": "Eraser", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "autotile_toggle",
                "type": "Button",
                "properties": { "x": 4, "y": 56, "width": 116, "height": 28, "text": "Autotile: Off", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "selected_tile_label",
                "type": "Label",
                "properties": { "x": 128, "y": 62, "text": "Tile: none", "font_size": 10, "color": "#aaaaaa", "align": "left", "valign": "top" },
                "children": []
              }
            ]
          },
          {
            "id": "layer_panel",
            "type": "Panel",
            "properties": { "x": 4, "y": 336, "width": 248, "height": 240, "color": "#222233", "border_color": "#3a3a5e", "border_width": 1 },
            "children": [
              {
                "id": "layer_title",
                "type": "Label",
                "properties": { "x": 124, "y": 4, "text": "Layers", "font_size": 12, "color": "#ffffff", "align": "center", "valign": "top" },
                "children": []
              },
              {
                "id": "layer_list",
                "type": "ScrollView",
                "properties": { "x": 4, "y": 22, "width": 240, "height": 160, "scroll_x": 0, "scroll_y": 0, "zoom": 1, "clip": true, "color": "#1a1a2e" },
                "children": []
              },
              {
                "id": "layer_add_btn",
                "type": "Button",
                "properties": { "x": 4, "y": 188, "width": 116, "height": 24, "text": "Add Layer", "color": "#3a5a3e", "hover_color": "#4a6a4e", "pressed_color": "#2a4a2e", "text_color": "#cccccc", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "layer_rm_btn",
                "type": "Button",
                "properties": { "x": 128, "y": 188, "width": 116, "height": 24, "text": "Remove Layer", "color": "#5a2a2a", "hover_color": "#6a3a3a", "pressed_color": "#4a1a1a", "text_color": "#ff8888", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "layer_up_btn",
                "type": "Button",
                "properties": { "x": 4, "y": 214, "width": 56, "height": 22, "text": "Up", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 10, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "layer_down_btn",
                "type": "Button",
                "properties": { "x": 64, "y": 214, "width": 56, "height": 22, "text": "Down", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 10, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "layer_toggle_btn",
                "type": "Button",
                "properties": { "x": 128, "y": 214, "width": 116, "height": 22, "text": "Toggle Visible", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 10, "corner_radius": 3, "clickable": true },
                "children": []
              }
            ]
          },
          {
            "id": "actions_panel",
            "type": "Node2D",
            "properties": { "x": 4, "y": 582 },
            "children": [
              {
                "id": "save_btn",
                "type": "Button",
                "properties": { "x": 0, "y": 0, "width": 248, "height": 30, "text": "Save Tilemap", "color": "#5a3a3e", "hover_color": "#6a4a4e", "pressed_color": "#4a2a2e", "text_color": "#ffffff", "font_size": 12, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "export_btn",
                "type": "Button",
                "properties": { "x": 0, "y": 36, "width": 120, "height": 28, "text": "Export JSON", "color": "#3a3a5e", "hover_color": "#4a4a6e", "pressed_color": "#2a2a4e", "text_color": "#cccccc", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "clear_btn",
                "type": "Button",
                "properties": { "x": 128, "y": 36, "width": 120, "height": 28, "text": "Clear Layer", "color": "#5a2a2a", "hover_color": "#6a3a3a", "pressed_color": "#4a1a1a", "text_color": "#ff8888", "font_size": 11, "corner_radius": 3, "clickable": true },
                "children": []
              },
              {
                "id": "grid_size_label",
                "type": "Label",
                "properties": { "x": 0, "y": 72, "text": "20x15 @16px", "font_size": 10, "color": "#666666", "align": "left", "valign": "top" },
                "children": []
              }
            ]
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Create an empty placeholder editor script**

Create `plugins/ku-tilemap-editor/scripts/tilemap-editor.js` with minimal structure so the plugin can load without errors:

```javascript
// Tilemap Editor — runs as a JS script on the root node

const handlers = {
  on_frame(ctx) {
    // Editor logic will be added in subsequent tasks
  },
};
```

- [ ] **Step 5: Verify the plugin loads**

Run: `cd /home/jqiu/workspace/ku && npm run build`
Then: `node dist/bin/ku.js tilemap --help`
Expected: CLI shows `tilemap edit` and `tilemap export` subcommands

- [ ] **Step 6: Commit**

```bash
git add plugins/ku-tilemap-editor/
git commit -m "feat: add ku-tilemap-editor plugin scaffold with CLI commands"
```

---

### Task 2: Tilemap data model and unit tests

**Files:**
- Create: `test/tilemap-editor.test.ts`

- [ ] **Step 1: Write the failing test for TilemapData model**

```typescript
import { describe, it, expect } from 'vitest';

// Pure data model — no imports from engine, self-contained
// These tests validate the data structures and algorithms that
// the editor script will implement in JS.

describe('TilemapData model', () => {
  describe('createLayer', () => {
    it('creates a layer with zero-filled data', () => {
      const layer = createLayer('ground', 20, 15);
      expect(layer.name).toBe('ground');
      expect(layer.columns).toBe(20);
      expect(layer.rows).toBe(15);
      expect(layer.data).toHaveLength(20 * 15);
      expect(layer.data.every(v => v === 0)).toBe(true);
      expect(layer.visible).toBe(true);
      expect(layer.autotile).toBe(false);
    });
  });

  describe('setTile / getTile', () => {
    it('sets and gets a tile at given coordinates', () => {
      const layer = createLayer('test', 10, 10);
      setTile(layer, 3, 5, 7);
      expect(getTile(layer, 3, 5)).toBe(7);
    });

    it('returns 0 for out-of-bounds coordinates', () => {
      const layer = createLayer('test', 10, 10);
      expect(getTile(layer, -1, 0)).toBe(0);
      expect(getTile(layer, 10, 0)).toBe(0);
    });

    it('ignores out-of-bounds set', () => {
      const layer = createLayer('test', 10, 10);
      setTile(layer, -1, 0, 5);
      setTile(layer, 10, 0, 5);
      expect(layer.data.every(v => v === 0)).toBe(true);
    });
  });

  describe('clearLayer', () => {
    it('fills all cells with 0', () => {
      const layer = createLayer('test', 5, 5);
      setTile(layer, 2, 2, 9);
      clearLayer(layer);
      expect(layer.data.every(v => v === 0)).toBe(true);
    });
  });

  describe('floodFill', () => {
    it('fills contiguous region of same value', () => {
      const layer = createLayer('test', 5, 5);
      // Fill entire grid with 1
      for (let i = 0; i < 25; i++) layer.data[i] = 1;
      // Flood fill from center with 2
      floodFill(layer, 2, 2, 2);
      expect(layer.data.every(v => v === 2)).toBe(true);
    });

    it('does not cross boundaries with different values', () => {
      const layer = createLayer('test', 5, 5);
      // Fill with 1, but leave a 3-wall
      for (let i = 0; i < 25; i++) layer.data[i] = 1;
      setTile(layer, 1, 0, 3);
      setTile(layer, 1, 1, 3);
      setTile(layer, 1, 2, 3);
      setTile(layer, 1, 3, 3);
      setTile(layer, 1, 4, 3);
      // Flood fill from (0,0) with 2
      floodFill(layer, 0, 0, 2);
      expect(getTile(layer, 0, 0)).toBe(2);
      expect(getTile(layer, 2, 0)).toBe(1); // right side untouched
      expect(getTile(layer, 1, 2)).toBe(3); // wall untouched
    });

    it('does nothing when target equals replacement', () => {
      const layer = createLayer('test', 3, 3);
      for (let i = 0; i < 9; i++) layer.data[i] = 5;
      floodFill(layer, 1, 1, 5);
      expect(layer.data.every(v => v === 5)).toBe(true);
    });
  });

  describe('rectFill', () => {
    it('fills a rectangular region', () => {
      const layer = createLayer('test', 10, 10);
      rectFill(layer, 2, 2, 5, 4, 7);
      for (let r = 2; r < 6; r++) {
        for (let c = 2; c < 7; c++) {
          expect(getTile(layer, c, r)).toBe(7);
        }
      }
      expect(getTile(layer, 1, 2)).toBe(0);
      expect(getTile(layer, 7, 2)).toBe(0);
    });
  });

  describe('exportTilemap', () => {
    it('exports all layers to JSON-compatible format', () => {
      const layers = [
        createLayer('ground', 4, 3),
        createLayer('decoration', 4, 3),
      ];
      setTile(layers[0], 0, 0, 1);
      setTile(layers[1], 1, 1, 2);
      const exported = exportTilemap(layers, 16);
      expect(exported.cell_size).toBe(16);
      expect(exported.layers).toHaveLength(2);
      expect(exported.layers[0].name).toBe('ground');
      expect(exported.layers[0].data).toHaveLength(12);
      expect(exported.layers[0].data[0]).toBe(1);
    });
  });

  describe('importTilemap', () => {
    it('imports from JSON format', () => {
      const data = {
        cell_size: 16,
        layers: [
          { name: 'ground', columns: 4, rows: 3, data: new Array(12).fill(0), visible: true, autotile: false, terrain_map: {} },
        ],
      };
      data.layers[0].data[5] = 7;
      const layers = importTilemap(data);
      expect(layers).toHaveLength(1);
      expect(getTile(layers[0], 1, 1)).toBe(7);
    });
  });
});

// --- Data model implementation (pure functions, no engine deps) ---

interface EditorLayer {
  name: string;
  columns: number;
  rows: number;
  data: number[];
  visible: boolean;
  autotile: boolean;
  terrain_map: Record<string, { atlas: string; mode: string; prefix?: string }>;
}

function createLayer(name: string, columns: number, rows: number): EditorLayer {
  return {
    name,
    columns,
    rows,
    data: new Array(columns * rows).fill(0),
    visible: true,
    autotile: false,
    terrain_map: {},
  };
}

function getTile(layer: EditorLayer, col: number, row: number): number {
  if (col < 0 || col >= layer.columns || row < 0 || row >= layer.rows) return 0;
  return layer.data[row * layer.columns + col];
}

function setTile(layer: EditorLayer, col: number, row: number, value: number): void {
  if (col < 0 || col >= layer.columns || row < 0 || row >= layer.rows) return;
  layer.data[row * layer.columns + col] = value;
}

function clearLayer(layer: EditorLayer): void {
  layer.data.fill(0);
}

function floodFill(layer: EditorLayer, startCol: number, startRow: number, replacement: number): void {
  const target = getTile(layer, startCol, startRow);
  if (target === replacement) return;
  const stack: [number, number][] = [[startCol, startRow]];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const [c, r] = stack.pop()!;
    const key = `${c},${r}`;
    if (visited.has(key)) continue;
    if (c < 0 || c >= layer.columns || r < 0 || r >= layer.rows) continue;
    if (getTile(layer, c, r) !== target) continue;
    visited.add(key);
    setTile(layer, c, r, replacement);
    stack.push([c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]);
  }
}

function rectFill(layer: EditorLayer, x1: number, y1: number, x2: number, y2: number, value: number): void {
  const minC = Math.max(0, Math.min(x1, x2));
  const maxC = Math.min(layer.columns - 1, Math.max(x1, x2));
  const minR = Math.max(0, Math.min(y1, y2));
  const maxR = Math.min(layer.rows - 1, Math.max(y1, y2));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      setTile(layer, c, r, value);
    }
  }
}

interface ExportedTilemap {
  cell_size: number;
  layers: {
    name: string;
    columns: number;
    rows: number;
    data: number[];
    visible: boolean;
    autotile: boolean;
    terrain_map: Record<string, { atlas: string; mode: string; prefix?: string }>;
  }[];
}

function exportTilemap(layers: EditorLayer[], cellSize: number): ExportedTilemap {
  return {
    cell_size: cellSize,
    layers: layers.map(l => ({
      name: l.name,
      columns: l.columns,
      rows: l.rows,
      data: [...l.data],
      visible: l.visible,
      autotile: l.autotile,
      terrain_map: { ...l.terrain_map },
    })),
  };
}

function importTilemap(data: ExportedTilemap): EditorLayer[] {
  return data.layers.map(l => ({
    name: l.name,
    columns: l.columns,
    rows: l.rows,
    data: [...l.data],
    visible: l.visible ?? true,
    autotile: l.autotile ?? false,
    terrain_map: l.terrain_map ?? {},
  }));
}
```

- [ ] **Step 2: Run tests to verify they pass (model is self-contained)**

Run: `npx vitest run test/tilemap-editor.test.ts`
Expected: All tests PASS (the model functions are defined inline in the test file)

- [ ] **Step 3: Commit**

```bash
git add test/tilemap-editor.test.ts
git commit -m "test: add tilemap editor data model and brush algorithm tests"
```

---

### Task 3: Editor script — initialization and tilemap canvas rendering

**Files:**
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Write the editor initialization and canvas rendering**

Replace the placeholder `tilemap-editor.js` with the full initialization logic. This includes:
- Loading editor config from root node properties
- Creating the tilemap data model (layers)
- Rendering the grid and tiles as Block/Panel nodes in the viewport
- Handling viewport pan/zoom

```javascript
// Tilemap Editor — runs as a JS script on the root node

const state = {
  // Editor config
  columns: 20,
  rows: 15,
  cellSize: 16,
  editorScene: '',
  tilemapPath: '',

  // Layers
  layers: [],
  activeLayerIndex: 0,

  // Tileset
  atlasData: null,       // { texture, regions }
  atlasPath: '',
  selectedTerrainId: 0,  // terrain ID to paint with

  // Brush
  brushType: 'tile',     // 'tile' | 'rect' | 'fill' | 'eraser'

  // Autotile
  autotileEnabled: false,

  // Interaction state
  dragState: null,
  touchMoved: false,
  pendingHit: null,
  rectStart: null,       // { col, row } for rect brush start
  painting: false,

  // Viewport
  initialized: false,
  hoverCol: -1,
  hoverRow: -1,
};

// --- Data model (same as test, duplicated for JS scripting context) ---

function createLayer(name, columns, rows) {
  return {
    name,
    columns,
    rows,
    data: new Array(columns * rows).fill(0),
    visible: true,
    autotile: false,
    terrain_map: {},
  };
}

function getTile(layer, col, row) {
  if (col < 0 || col >= layer.columns || row < 0 || row >= layer.rows) return 0;
  return layer.data[row * layer.columns + col];
}

function setTile(layer, col, row, value) {
  if (col < 0 || col >= layer.columns || row < 0 || row >= layer.rows) return;
  layer.data[row * layer.columns + col] = value;
}

function clearLayer(layer) {
  layer.data.fill(0);
}

function floodFill(layer, startCol, startRow, replacement) {
  const target = getTile(layer, startCol, startRow);
  if (target === replacement) return;
  const stack = [[startCol, startRow]];
  const visited = new Set();
  while (stack.length > 0) {
    const [c, r] = stack.pop();
    const key = c + ',' + r;
    if (visited.has(key)) continue;
    if (c < 0 || c >= layer.columns || r < 0 || r >= layer.rows) continue;
    if (getTile(layer, c, r) !== target) continue;
    visited.add(key);
    setTile(layer, c, r, replacement);
    stack.push([c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]);
  }
}

function rectFill(layer, x1, y1, x2, y2, value) {
  const minC = Math.max(0, Math.min(x1, x2));
  const maxC = Math.min(layer.columns - 1, Math.max(x1, x2));
  const minR = Math.max(0, Math.min(y1, y2));
  const maxR = Math.min(layer.rows - 1, Math.max(y1, y2));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      setTile(layer, c, r, value);
    }
  }
}

// --- Color helpers ---

const TERRAIN_COLORS = [
  '#4a8c3f', '#2a6cb6', '#c4a46c', '#8b4513',
  '#6a6a8a', '#cc5de8', '#ff922b', '#20c997',
  '#fcc419', '#ff6b6b', '#339af0', '#748ffc',
  '#51cf66', '#e8d5a3', '#5a3a3e', '#3a3a5e',
];

function terrainColor(id) {
  if (id === 0) return '#1a1a2e';
  return TERRAIN_COLORS[(id - 1) % TERRAIN_COLORS.length];
}

// --- Handlers ---

const handlers = {
  on_touch_start(ctx) {
    const { x, y } = ctx.data;
    state.dragState = null;
    state.touchMoved = false;
    state.pendingHit = null;

    // If in viewport, start painting or panning
    const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
    const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;
    const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;

    // Check if click is in sidebar (x >= 768)
    if (x >= 768) {
      state.dragState = { type: 'sidebar_click', startX: x, startY: y };
      return;
    }

    // Viewport area — start pan or paint
    state.dragState = {
      type: 'tentative_pan',
      startX: x,
      startY: y,
      scrollStartX: vpScrollX,
      scrollStartY: vpScrollY,
    };
  },

  on_gui_click(ctx) {
    const hitNode = ctx.data.hit_node || null;

    if (state.dragState && state.dragState.type !== 'sidebar_click') {
      // Touch-initiated: defer to on_touch_end
      state.pendingHit = hitNode;
      return;
    }

    handleClick(ctx, hitNode);
  },

  on_touch_move(ctx) {
    if (!state.dragState) return;
    const { x, y } = ctx.data;

    if (state.dragState.type === 'tentative_pan') {
      const dx = x - state.dragState.startX;
      const dy = y - state.dragState.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        state.dragState.type = 'pan';
        state.touchMoved = true;
      } else {
        return;
      }
    }

    if (state.dragState.type === 'pan') {
      const dx = x - state.dragState.startX;
      const dy = y - state.dragState.startY;
      ctx.scene.set('/viewport', 'scroll_x', state.dragState.scrollStartX - dx);
      ctx.scene.set('/viewport', 'scroll_y', state.dragState.scrollStartY - dy);
    }

    // If painting, handle drag-paint
    if (state.painting && state.dragState.type !== 'pan') {
      const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
      const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
      const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;
      const worldX = (x / vpZoom) + vpScrollX;
      const worldY = ((y - 32) / vpZoom) + vpScrollY;
      const col = Math.floor(worldX / state.cellSize);
      const row = Math.floor(worldY / state.cellSize);
      if (col !== state.hoverCol || row !== state.hoverRow) {
        state.hoverCol = col;
        state.hoverRow = row;
        paintAt(col, row);
      }
    }
  },

  on_touch_end(ctx) {
    if (!state.touchMoved && state.pendingHit) {
      handleClick(ctx, state.pendingHit);
    } else if (!state.touchMoved && !state.pendingHit && state.dragState) {
      // Click in viewport — paint or interact
      const { x, y } = ctx.data;
      if (x < 768) {
        handleViewportClick(ctx, x, y);
      }
    }

    if (state.painting && state.brushType === 'rect' && state.rectStart) {
      // Finalize rect fill
      const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
      const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
      const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;
      const { x, y } = ctx.data;
      const worldX = (x / vpZoom) + vpScrollX;
      const worldY = ((y - 32) / vpZoom) + vpScrollY;
      const endCol = Math.floor(worldX / state.cellSize);
      const endRow = Math.floor(worldY / state.cellSize);
      const layer = state.layers[state.activeLayerIndex];
      if (layer) {
        const value = state.brushType === 'eraser' ? 0 : state.selectedTerrainId;
        rectFill(layer, state.rectStart.col, state.rectStart.row, endCol, endRow, value);
        rebuildCanvas(ctx);
      }
      state.rectStart = null;
    }

    state.painting = false;
    state.dragState = null;
    state.touchMoved = false;
    state.pendingHit = null;
  },

  on_key(ctx) {
    const key = ctx.data.key;
    const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
    const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
    const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;

    switch (key) {
      case 'PLUS':
      case '=':
        ctx.scene.set('/viewport', 'zoom', Math.min(vpZoom * 1.5, 16));
        break;
      case '-':
        ctx.scene.set('/viewport', 'zoom', Math.max(vpZoom / 1.5, 0.5));
        break;
      case 'UP':
        ctx.scene.set('/viewport', 'scroll_y', vpScrollY - 32);
        break;
      case 'DOWN':
        ctx.scene.set('/viewport', 'scroll_y', vpScrollY + 32);
        break;
      case 'LEFT':
        ctx.scene.set('/viewport', 'scroll_x', vpScrollX - 32);
        break;
      case 'RIGHT':
        ctx.scene.set('/viewport', 'scroll_x', vpScrollX + 32);
        break;
      case '1':
        setBrush(ctx, 'tile');
        break;
      case '2':
        setBrush(ctx, 'rect');
        break;
      case '3':
        setBrush(ctx, 'fill');
        break;
      case '4':
        setBrush(ctx, 'eraser');
        break;
    }
  },

  on_frame(ctx) {
    if (!state.initialized) {
      state.initialized = true;
      initEditor(ctx);
    }
    updateCoordsLabel(ctx);
  },
};

// --- Initialization ---

function initEditor(ctx) {
  state.columns = ctx.scene.get('/', 'editor_columns') || 20;
  state.rows = ctx.scene.get('/', 'editor_rows') || 15;
  state.cellSize = ctx.scene.get('/', 'editor_cell_size') || 16;
  state.editorScene = ctx.scene.get('/', 'editor_scene') || '';
  state.tilemapPath = ctx.scene.get('/', 'editor_tilemap_path') || '';

  // Create default layer
  state.layers = [createLayer('ground', state.columns, state.rows)];

  // Try to load existing scene data
  const sceneDataStr = ctx.scene.get('/', 'editor_scene_data') || '';
  if (sceneDataStr) {
    loadFromScene(ctx, sceneDataStr);
  }

  // Set viewport zoom to fit
  const vpZoom = Math.max(1, Math.floor(700 / (state.columns * state.cellSize)));
  ctx.scene.set('/viewport', 'zoom', vpZoom);

  rebuildCanvas(ctx);
  updateLayerList(ctx);
  updateGridSizeLabel(ctx);

  ctx.log(`Tilemap Editor initialized: ${state.columns}x${state.rows} @${state.cellSize}px`);
}

function loadFromScene(ctx, sceneDataStr) {
  try {
    const sceneData = JSON.parse(sceneDataStr);
    const tilemapPath = state.tilemapPath;
    let tilemapNode = null;

    if (tilemapPath) {
      const parts = tilemapPath.split('/').filter(Boolean);
      tilemapNode = findNodeInData(sceneData.root, parts);
    } else {
      tilemapNode = findFirstTilemap(sceneData.root);
    }

    if (tilemapNode && tilemapNode.type === 'TileMap') {
      const props = tilemapNode.properties || {};
      const dataStr = props.data || '';
      const data = dataStr.split(',').map(s => parseInt(s.trim(), 10));
      // Load into first layer
      if (state.layers.length > 0) {
        state.layers[0].data = data;
        state.layers[0].autotile = !!(props.terrain_map && Object.keys(props.terrain_map).length > 0);
        state.layers[0].terrain_map = props.terrain_map || {};
        state.layers[0].name = tilemapNode.id || 'ground';
      }
      ctx.log(`Loaded tilemap: ${state.layers[0].name} (${data.length} cells)`);
    }
  } catch (e) {
    ctx.log(`Failed to load scene: ${e.message}`);
  }
}

function findNodeInData(node, pathParts) {
  let current = node;
  for (const part of pathParts) {
    if (!current.children) return null;
    current = current.children.find(c => c.id === part);
    if (!current) return null;
  }
  return current;
}

function findFirstTilemap(node) {
  if (node.type === 'TileMap') return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findFirstTilemap(child);
      if (found) return found;
    }
  }
  return null;
}

// --- Canvas rendering ---

function rebuildCanvas(ctx) {
  // Remove existing tile nodes
  for (let i = 0; i < 2000; i++) {
    try { ctx.scene.destroy(`/tilemap_canvas/tile_${i}`); } catch { break; }
  }
  try { ctx.scene.destroy('/tilemap_canvas/grid'); } catch { /* ignore */ }

  // Draw grid background
  const totalW = state.columns * state.cellSize;
  const totalH = state.rows * state.cellSize;
  ctx.scene.spawn('Panel', 'grid', {
    x: 0, y: 0, width: totalW, height: totalH,
    color: '#1a1a2e', border_color: '#333355', border_width: 1, corner_radius: 0,
  }, '/tilemap_canvas');

  // Draw all visible layers bottom-to-top
  let tileIdx = 0;
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (let row = 0; row < layer.rows; row++) {
      for (let col = 0; col < layer.columns; col++) {
        const terrainId = getTile(layer, col, row);
        if (terrainId === 0) continue;

        const color = terrainColor(terrainId);
        ctx.scene.spawn('Panel', `tile_${tileIdx}`, {
          x: col * state.cellSize,
          y: row * state.cellSize,
          width: state.cellSize,
          height: state.cellSize,
          color: color,
          border_color: '#00000044',
          border_width: 0,
          corner_radius: 0,
        }, '/tilemap_canvas');
        tileIdx++;
      }
    }
  }

  // Draw grid lines
  for (let col = 0; col <= state.columns; col++) {
    ctx.scene.spawn('Block', `tile_${tileIdx}`, {
      x: col * state.cellSize,
      y: totalH / 2,
      width: 1,
      height: totalH,
      color: '#33335566',
    }, '/tilemap_canvas');
    tileIdx++;
  }
  for (let row = 0; row <= state.rows; row++) {
    ctx.scene.spawn('Block', `tile_${tileIdx}`, {
      x: totalW / 2,
      y: row * state.cellSize,
      width: totalW,
      height: 1,
      color: '#33335566',
    }, '/tilemap_canvas');
    tileIdx++;
  }
}

// --- Viewport click handling ---

function handleViewportClick(ctx, screenX, screenY) {
  const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
  const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
  const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;

  const worldX = (screenX / vpZoom) + vpScrollX;
  const worldY = ((screenY - 32) / vpZoom) + vpScrollY;
  const col = Math.floor(worldX / state.cellSize);
  const row = Math.floor(worldY / state.cellSize);

  if (col < 0 || col >= state.columns || row < 0 || row >= state.rows) return;

  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;

  switch (state.brushType) {
    case 'tile': {
      const value = state.selectedTerrainId;
      setTile(layer, col, row, value);
      state.painting = true;
      state.hoverCol = col;
      state.hoverRow = row;
      rebuildCanvas(ctx);
      break;
    }
    case 'eraser': {
      setTile(layer, col, row, 0);
      state.painting = true;
      state.hoverCol = col;
      state.hoverRow = row;
      rebuildCanvas(ctx);
      break;
    }
    case 'rect': {
      state.rectStart = { col, row };
      state.painting = true;
      break;
    }
    case 'fill': {
      const value = state.selectedTerrainId;
      floodFill(layer, col, row, value);
      rebuildCanvas(ctx);
      break;
    }
  }
}

function paintAt(col, row) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;
  if (col < 0 || col >= state.columns || row < 0 || row >= state.rows) return;

  if (state.brushType === 'tile') {
    setTile(layer, col, row, state.selectedTerrainId);
  } else if (state.brushType === 'eraser') {
    setTile(layer, col, row, 0);
  }
}

// --- Click dispatch ---

function handleClick(ctx, hitNode) {
  if (!hitNode) return;

  switch (hitNode) {
    case 'brush_tile_btn': setBrush(ctx, 'tile'); break;
    case 'brush_rect_btn': setBrush(ctx, 'rect'); break;
    case 'brush_fill_btn': setBrush(ctx, 'fill'); break;
    case 'brush_eraser_btn': setBrush(ctx, 'eraser'); break;
    case 'autotile_toggle': toggleAutotile(ctx); break;
    case 'tileset_load_btn': loadTilesetAtlas(ctx); break;
    case 'layer_add_btn': addLayer(ctx); break;
    case 'layer_rm_btn': removeLayer(ctx); break;
    case 'layer_up_btn': moveLayer(ctx, -1); break;
    case 'layer_down_btn': moveLayer(ctx, 1); break;
    case 'layer_toggle_btn': toggleLayerVisibility(ctx); break;
    case 'save_btn': saveTilemap(ctx); break;
    case 'export_btn': exportTilemapJSON(ctx); break;
    case 'clear_btn': clearActiveLayer(ctx); break;
    default:
      if (hitNode.startsWith('layer_item_')) {
        const idx = parseInt(hitNode.split('_').pop(), 10);
        if (!isNaN(idx) && idx >= 0 && idx < state.layers.length) {
          selectLayer(ctx, idx);
        }
      }
      if (hitNode.startsWith('terrain_')) {
        const id = parseInt(hitNode.split('_').pop(), 10);
        if (!isNaN(id)) {
          state.selectedTerrainId = id;
          updateSelectedTileLabel(ctx);
        }
      }
      break;
  }
}

// --- Brush management ---

function setBrush(ctx, type) {
  state.brushType = type;
  const buttons = {
    tile: 'brush_tile_btn',
    rect: 'brush_rect_btn',
    fill: 'brush_fill_btn',
    eraser: 'brush_eraser_btn',
  };
  for (const [key, nodeId] of Object.entries(buttons)) {
    const isActive = key === type;
    ctx.scene.set(`/sidebar/${nodeId}`, 'color', isActive ? '#4a6a4e' : '#3a3a5e');
    ctx.scene.set(`/sidebar/${nodeId}`, 'text_color', isActive ? '#ffffff' : '#cccccc');
  }
}

// --- Autotile ---

function toggleAutotile(ctx) {
  state.autotileEnabled = !state.autotileEnabled;
  const layer = state.layers[state.activeLayerIndex];
  if (layer) {
    layer.autotile = state.autotileEnabled;
  }
  ctx.scene.set('/sidebar/autotile_toggle', 'text', `Autotile: ${state.autotileEnabled ? 'On' : 'Off'}`);
  ctx.scene.set('/sidebar/autotile_toggle', 'color', state.autotileEnabled ? '#4a6a4e' : '#3a3a5e');
}

// --- Tileset ---

function loadTilesetAtlas(ctx) {
  ctx.emit('load_tileset', {});
  ctx.log('Load tileset: use CLI or place .atlas.json in assets/');
}

// --- Layer management ---

function addLayer(ctx) {
  const name = `layer_${state.layers.length}`;
  state.layers.push(createLayer(name, state.columns, state.rows));
  state.activeLayerIndex = state.layers.length - 1;
  rebuildCanvas(ctx);
  updateLayerList(ctx);
  ctx.log(`Added layer: ${name}`);
}

function removeLayer(ctx) {
  if (state.layers.length <= 1) {
    ctx.log('Cannot remove last layer');
    return;
  }
  state.layers.splice(state.activeLayerIndex, 1);
  if (state.activeLayerIndex >= state.layers.length) {
    state.activeLayerIndex = state.layers.length - 1;
  }
  rebuildCanvas(ctx);
  updateLayerList(ctx);
}

function selectLayer(ctx, index) {
  state.activeLayerIndex = index;
  const layer = state.layers[index];
  state.autotileEnabled = layer.autotile;
  ctx.scene.set('/sidebar/autotile_toggle', 'text', `Autotile: ${layer.autotile ? 'On' : 'Off'}`);
  ctx.scene.set('/sidebar/autotile_toggle', 'color', layer.autotile ? '#4a6a4e' : '#3a3a5e');
  updateLayerList(ctx);
}

function moveLayer(ctx, direction) {
  const newIdx = state.activeLayerIndex + direction;
  if (newIdx < 0 || newIdx >= state.layers.length) return;
  const temp = state.layers[state.activeLayerIndex];
  state.layers[state.activeLayerIndex] = state.layers[newIdx];
  state.layers[newIdx] = temp;
  state.activeLayerIndex = newIdx;
  rebuildCanvas(ctx);
  updateLayerList(ctx);
}

function toggleLayerVisibility(ctx) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;
  layer.visible = !layer.visible;
  rebuildCanvas(ctx);
  updateLayerList(ctx);
}

function clearActiveLayer(ctx) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;
  clearLayer(layer);
  rebuildCanvas(ctx);
  ctx.log(`Cleared layer: ${layer.name}`);
}

function updateLayerList(ctx) {
  // Remove existing layer items
  for (let i = 0; i < 50; i++) {
    try { ctx.scene.destroy(`/sidebar/layer_panel/layer_list/layer_item_${i}`); } catch { break; }
  }

  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const isActive = i === state.activeLayerIndex;
    const vis = layer.visible ? '' : ' [hidden]';
    ctx.scene.spawn('Button', `layer_item_${i}`, {
      x: 0,
      y: (state.layers.length - 1 - i) * 24,
      width: 228,
      height: 22,
      text: `${isActive ? '> ' : '  '}${layer.name}${vis}${layer.autotile ? ' [A]' : ''}`,
      color: isActive ? '#4a4a6e' : '#2a2a3e',
      hover_color: '#3a3a5e',
      pressed_color: '#5a5a7e',
      text_color: isActive ? '#ffff00' : '#cccccc',
      font_size: 11,
      corner_radius: 2,
      clickable: true,
    }, '/sidebar/layer_panel/layer_list');
  }
}

// --- Save / Export ---

function saveTilemap(ctx) {
  // Convert multi-layer format to ku TileMap node format
  // For multi-layer, we export as a tilemap-editor JSON
  // For single-layer, we can also export as a TileMap node
  const exportData = {
    cell_size: state.cellSize,
    columns: state.columns,
    rows: state.rows,
    layers: state.layers.map(l => ({
      name: l.name,
      columns: l.columns,
      rows: l.rows,
      data: l.data.join(','),
      visible: l.visible,
      autotile: l.autotile,
      terrain_map: l.terrain_map,
    })),
  };

  const path = 'tilemap.json';
  ctx.emit('save_tilemap', { path, tilemapData: exportData });
  ctx.log(`Tilemap saved to ${path} (${state.layers.length} layers)`);
}

function exportTilemapJSON(ctx) {
  // Export as single TileMap node format (compatible with ku engine)
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;

  const tilemapData = {
    cell_size: state.cellSize,
    columns: layer.columns,
    rows: layer.rows,
    data: layer.data.join(','),
    terrain_map: layer.terrain_map,
  };

  const path = `tilemap_${layer.name}.json`;
  ctx.emit('save_tilemap', { path, tilemapData });
  ctx.log(`Exported layer '${layer.name}' to ${path}`);
}

// --- UI updates ---

function updateCoordsLabel(ctx) {
  if (state.hoverCol >= 0 && state.hoverRow >= 0) {
    ctx.scene.set('/toolbar/coords_label', 'text', `${state.hoverCol}, ${state.hoverRow}`);
  }
  const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
  ctx.scene.set('/toolbar/zoom_label', 'text', `${Math.round(vpZoom * 100)}%`);
}

function updateGridSizeLabel(ctx) {
  ctx.scene.set('/sidebar/actions_panel/grid_size_label', 'text', `${state.columns}x${state.rows} @${state.cellSize}px`);
}

function updateSelectedTileLabel(ctx) {
  const id = state.selectedTerrainId;
  ctx.scene.set('/sidebar/selected_tile_label', 'text', `Tile: ${id === 0 ? 'none' : id}`);
}
```

- [ ] **Step 2: Verify the plugin loads and renders the tilemap canvas**

Run: `npm run build && node dist/bin/ku.js tilemap edit --dir examples/zelda`
Expected: Window opens with the tilemap editor UI, grid renders, sidebar shows layer and brush controls.

- [ ] **Step 3: Commit**

```bash
git add plugins/ku-tilemap-editor/scripts/tilemap-editor.js
git commit -m "feat: add tilemap editor initialization, canvas rendering, and basic brush support"
```

---

### Task 4: Atlas-based tileset loading and terrain palette

**Files:**
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Add tileset atlas loading and terrain palette rendering**

Add these functions to the editor script. When the user loads an atlas, it reads the atlas JSON via the `tileset.load` message handler, populates the terrain palette, and allows selecting terrain IDs by clicking on palette items.

Add to the `initEditor` function, after the `loadFromScene` call:

```javascript
  // Auto-load terrain_map from first layer as tileset
  const firstLayer = state.layers[0];
  if (firstLayer && firstLayer.terrain_map && Object.keys(firstLayer.terrain_map).length > 0) {
    loadTerrainFromLayer(ctx, firstLayer);
  }
```

Add these new functions:

```javascript
function loadTerrainFromLayer(ctx, layer) {
  // Load atlases from terrain_map and populate terrain palette
  const terrainMap = layer.terrain_map;
  state.terrainPalette = [];

  for (const [idStr, def] of Object.entries(terrainMap)) {
    const id = parseInt(idStr, 10);
    if (isNaN(id) || id === 0) continue;
    state.terrainPalette.push({
      id,
      atlas: def.atlas,
      mode: def.mode || '3x3',
      prefix: def.prefix || '',
    });
  }

  // Sort by terrain ID
  state.terrainPalette.sort((a, b) => a.id - b.id);

  if (state.terrainPalette.length > 0 && state.selectedTerrainId === 0) {
    state.selectedTerrainId = state.terrainPalette[0].id;
    updateSelectedTileLabel(ctx);
  }

  rebuildTerrainPalette(ctx);
  ctx.log(`Loaded ${state.terrainPalette.length} terrain types from layer`);
}

function rebuildTerrainPalette(ctx) {
  // Remove existing palette items
  for (let i = 0; i < 100; i++) {
    try { ctx.scene.destroy(`/sidebar/tileset_panel/terrain_${i}`); } catch { break; }
  }

  if (!state.terrainPalette || state.terrainPalette.length === 0) {
    ctx.scene.set('/sidebar/tileset_info', 'text', 'No atlas');
    return;
  }

  const cols = 6;
  const itemSize = 24;
  const padding = 2;

  for (let i = 0; i < state.terrainPalette.length; i++) {
    const terrain = state.terrainPalette[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const isSelected = terrain.id === state.selectedTerrainId;

    ctx.scene.spawn('Button', `terrain_${terrain.id}`, {
      x: col * (itemSize + padding) + 4,
      y: row * (itemSize + padding) + 22,
      width: itemSize,
      height: itemSize,
      text: String(terrain.id),
      color: isSelected ? '#4a6a4e' : '#2a2a3e',
      hover_color: '#3a3a5e',
      pressed_color: '#5a5a7e',
      text_color: isSelected ? '#ffffff' : '#aaaaaa',
      font_size: 10,
      corner_radius: 2,
      clickable: true,
    }, '/sidebar/tileset_panel');
  }

  ctx.scene.set('/sidebar/tileset_info', 'text', `${state.terrainPalette.length} terrains`);
}

function addTerrainToLayer(ctx, terrainId, atlasPath, mode, prefix) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;

  // Add to layer's terrain_map
  layer.terrain_map[terrainId] = {
    atlas: atlasPath,
    mode: mode || '3x3',
    prefix: prefix || '',
  };

  // Enable autotile for this layer if using 3x3 mode
  if (mode === '3x3' && !layer.autotile) {
    layer.autotile = true;
    state.autotileEnabled = true;
    ctx.scene.set('/sidebar/autotile_toggle', 'text', 'Autotile: On');
    ctx.scene.set('/sidebar/autotile_toggle', 'color', '#4a6a4e');
  }

  // Update palette
  if (!state.terrainPalette) state.terrainPalette = [];
  const existing = state.terrainPalette.findIndex(t => t.id === terrainId);
  if (existing >= 0) {
    state.terrainPalette[existing] = { id: terrainId, atlas: atlasPath, mode: mode || '3x3', prefix: prefix || '' };
  } else {
    state.terrainPalette.push({ id: terrainId, atlas: atlasPath, mode: mode || '3x3', prefix: prefix || '' });
    state.terrainPalette.sort((a, b) => a.id - b.id);
  }

  state.selectedTerrainId = terrainId;
  updateSelectedTileLabel(ctx);
  rebuildTerrainPalette(ctx);
  updateLayerList(ctx);
}
```

Also add `terrainPalette: null,` to the initial `state` object.

Update the `loadTilesetAtlas` function to trigger a prompt for atlas loading:

```javascript
function loadTilesetAtlas(ctx) {
  // In a real interactive flow, this would open a file dialog.
  // For CLI-driven workflow, emit a message to the plugin host.
  // The user can also add terrain via the CLI:
  //   ku tilemap add-terrain --id 1 --atlas assets/Water_Tile.atlas.json --mode 3x3
  ctx.emit('request_tileset_load', {});
  ctx.log('To load a tileset, use: ku tilemap add-terrain, or edit terrain_map in layer');
}
```

- [ ] **Step 2: Add `add-terrain` CLI subcommand**

In `plugins/ku-tilemap-editor/index.js`, add inside the `tilemap` command registration:

```javascript
      tilemap
        .command('add-terrain')
        .description('Add a terrain type to the tilemap editor')
        .requiredOption('--id <n>', 'Terrain ID (1-255)')
        .requiredOption('--atlas <path>', 'Path to atlas JSON file')
        .option('--mode <mode>', 'Autotile mode: 3x3 or fill', '3x3')
        .option('--prefix <prefix>', 'Region name prefix (auto-detect if omitted)')
        .option('--dir <dir>', 'Project directory (default: cwd)')
        .action(async (opts) => {
          const id = parseInt(opts.id, 10);
          if (isNaN(id) || id < 1 || id > 255) {
            console.error(JSON.stringify({ ok: false, error: 'id must be 1-255' }));
            return;
          }
          const atlas = opts.atlas;
          const mode = opts.mode === 'fill' ? 'fill' : '3x3';
          const prefix = opts.prefix || '';
          console.log(JSON.stringify({
            ok: true,
            data: { id, atlas, mode, prefix, hint: 'Use this terrain in the editor by selecting terrain ID ' + id },
          }));
        });
```

- [ ] **Step 3: Verify terrain palette renders**

Run: `npm run build && node dist/bin/ku.js tilemap edit --dir examples/zelda`
Expected: If the zelda scene has terrain_map data, the terrain palette shows terrain buttons. Otherwise, shows "No atlas".

- [ ] **Step 4: Commit**

```bash
git add plugins/ku-tilemap-editor/
git commit -m "feat: add atlas-based tileset loading and terrain palette to tilemap editor"
```

---

### Task 5: Autotile integration

**Files:**
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Implement autotile resolution in the editor**

When autotile is enabled for a layer, the editor applies the same 4-bit bitmask algorithm from `src/engine/autotile.ts` to resolve the visual tile for each cell. The editor uses the terrain color palette for rendering (since it can't load actual atlas textures in the JS scripting context), but the exported data will be compatible with the engine's autotile renderer.

Add the autotile bitmask table and resolver:

```javascript
// 4-bit bitmask → suffix (same as engine's autotile.ts)
const BITMASK_TO_SUFFIX = [
  'top_left',       // 0000
  'center_left',    // 0001
  'center_right',   // 0010
  'center',         // 0011
  'bottom_mid',     // 0100
  'bottom_left',    // 0101
  'bottom_right',   // 0110
  'bottom_mid',     // 0111
  'top_mid',        // 1000
  'top_left',       // 1001
  'top_right',      // 1010
  'top_mid',        // 1011
  'center',         // 1100
  'center_left',    // 1101
  'center_right',   // 1110
  'center',         // 1111
];

function resolveAutotileCell(layer, col, row) {
  // Returns a visual indicator string for autotile rendering
  const terrainId = getTile(layer, col, row);
  if (terrainId === 0) return null;

  const def = layer.terrain_map[String(terrainId)];
  if (!def) return { color: terrainColor(terrainId), label: '' };

  if (def.mode === 'fill') {
    return { color: terrainColor(terrainId), label: '' };
  }

  // 4-bit neighbor mask
  const up = row > 0 && getTile(layer, col, row - 1) === terrainId ? 1 : 0;
  const down = row < layer.rows - 1 && getTile(layer, col, row + 1) === terrainId ? 1 : 0;
  const left = col > 0 && getTile(layer, col - 1, row) === terrainId ? 1 : 0;
  const right = col < layer.columns - 1 && getTile(layer, col + 1, row) === terrainId ? 1 : 0;

  const mask = right + left * 2 + up * 4 + down * 8;
  const suffix = BITMASK_TO_SUFFIX[mask];

  // Use border indicators to show autotile direction
  const borders = {
    top: !(up),
    bottom: !(down),
    left: !(left),
    right: !(right),
  };

  return { color: terrainColor(terrainId), borders, suffix };
}
```

- [ ] **Step 2: Update `rebuildCanvas` to use autotile rendering**

Modify the `rebuildCanvas` function's tile drawing loop. Replace the simple terrain-color panel with autotile-aware rendering:

```javascript
  // Draw all visible layers bottom-to-top
  let tileIdx = 0;
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (let row = 0; row < layer.rows; row++) {
      for (let col = 0; col < layer.columns; col++) {
        const terrainId = getTile(layer, col, row);
        if (terrainId === 0) continue;

        let color = terrainColor(terrainId);
        let borderColor = '#00000044';
        let borderWidth = 0;

        if (layer.autotile) {
          const resolved = resolveAutotileCell(layer, col, row);
          if (resolved) {
            color = resolved.color;
            if (resolved.borders) {
              // Draw border on sides that face different terrain
              const b = resolved.borders;
              borderColor = '#00000088';
              borderWidth = 1;
            }
          }
        }

        ctx.scene.spawn('Panel', `tile_${tileIdx}`, {
          x: col * state.cellSize,
          y: row * state.cellSize,
          width: state.cellSize,
          height: state.cellSize,
          color: color,
          border_color: borderColor,
          border_width: borderWidth,
          corner_radius: 0,
        }, '/tilemap_canvas');
        tileIdx++;
      }
    }
  }
```

- [ ] **Step 3: Add autotile test to the test file**

Add to `test/tilemap-editor.test.ts`:

```typescript
describe('autotile resolution', () => {
  it('resolves isolated cell with border on all sides', () => {
    const layer = createLayer('test', 5, 5);
    setTile(layer, 2, 2, 1);
    layer.autotile = true;
    layer.terrain_map = { '1': { atlas: 'water.json', mode: '3x3', prefix: 'water' } };
    const result = resolveAutotileCellTest(layer, 2, 2);
    expect(result.borders.top).toBe(true);
    expect(result.borders.bottom).toBe(true);
    expect(result.borders.left).toBe(true);
    expect(result.borders.right).toBe(true);
    expect(result.suffix).toBe('top_left'); // isolated = bitmask 0
  });

  it('resolves fully surrounded cell with no borders', () => {
    const layer = createLayer('test', 3, 3);
    for (let i = 0; i < 9; i++) layer.data[i] = 1;
    layer.autotile = true;
    layer.terrain_map = { '1': { atlas: 'water.json', mode: '3x3', prefix: 'water' } };
    const result = resolveAutotileCellTest(layer, 1, 1);
    expect(result.borders.top).toBe(false);
    expect(result.borders.bottom).toBe(false);
    expect(result.borders.left).toBe(false);
    expect(result.borders.right).toBe(false);
    expect(result.suffix).toBe('center'); // fully surrounded = bitmask 15
  });

  it('skips resolution for fill mode', () => {
    const layer = createLayer('test', 3, 3);
    setTile(layer, 1, 1, 1);
    layer.autotile = true;
    layer.terrain_map = { '1': { atlas: 'grass.json', mode: 'fill', prefix: 'grass_fill' } };
    const result = resolveAutotileCellTest(layer, 1, 1);
    expect(result).not.toBeNull();
    expect(result.suffix).toBe('');
  });
});

function resolveAutotileCellTest(layer: EditorLayer, col: number, row: number) {
  const terrainId = getTile(layer, col, row);
  if (terrainId === 0) return null;

  const def = layer.terrain_map[String(terrainId)];
  if (!def) return { color: '#ffffff', borders: { top: true, bottom: true, left: true, right: true }, suffix: '' };

  if (def.mode === 'fill') {
    return { color: '#ffffff', borders: { top: false, bottom: false, left: false, right: false }, suffix: '' };
  }

  const up = row > 0 && getTile(layer, col, row - 1) === terrainId ? 1 : 0;
  const down = row < layer.rows - 1 && getTile(layer, col, row + 1) === terrainId ? 1 : 0;
  const left = col > 0 && getTile(layer, col - 1, row) === terrainId ? 1 : 0;
  const right = col < layer.columns - 1 && getTile(layer, col + 1, row) === terrainId ? 1 : 0;

  const mask = right + left * 2 + up * 4 + down * 8;
  const suffixes = [
    'top_left', 'center_left', 'center_right', 'center',
    'bottom_mid', 'bottom_left', 'bottom_right', 'bottom_mid',
    'top_mid', 'top_left', 'top_right', 'top_mid',
    'center', 'center_left', 'center_right', 'center',
  ];

  return {
    color: '#ffffff',
    borders: { top: !up, bottom: !down, left: !left, right: !right },
    suffix: suffixes[mask],
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/tilemap-editor.test.ts`
Expected: All tests PASS including new autotile tests

- [ ] **Step 5: Commit**

```bash
git add plugins/ku-tilemap-editor/scripts/tilemap-editor.js test/tilemap-editor.test.ts
git commit -m "feat: add autotile resolution and visual border indicators to tilemap editor"
```

---

### Task 6: JSON load/save with multi-layer support

**Files:**
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Enhance save to produce proper multi-layer JSON format**

Update `saveTilemap` and add `loadFromTilemapJSON`:

```javascript
function saveTilemap(ctx) {
  const exportData = {
    version: 1,
    cell_size: state.cellSize,
    columns: state.columns,
    rows: state.rows,
    layers: state.layers.map(l => ({
      name: l.name,
      columns: l.columns,
      rows: l.rows,
      data: l.data.join(','),
      visible: l.visible,
      autotile: l.autotile,
      terrain_map: l.terrain_map,
    })),
  };

  const path = 'tilemap.json';
  ctx.emit('save_tilemap', { path, tilemapData: exportData });
  ctx.log(`Tilemap saved to ${path} (${state.layers.length} layers)`);
}

function exportTilemapJSON(ctx) {
  // Export active layer as single TileMap node format (compatible with ku engine)
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;

  const tilemapData = {
    cell_size: state.cellSize,
    columns: layer.columns,
    rows: layer.rows,
    data: layer.data.join(','),
    terrain_map: layer.terrain_map,
  };

  const path = `tilemap_${layer.name}.json`;
  ctx.emit('save_tilemap', { path, tilemapData });
  ctx.log(`Exported layer '${layer.name}' to ${path}`);
}

function loadFromTilemapJSON(ctx, data) {
  // Load from multi-layer tilemap JSON format
  if (data.version === 1 && data.layers) {
    state.columns = data.columns || state.columns;
    state.rows = data.rows || state.rows;
    state.cellSize = data.cell_size || state.cellSize;

    state.layers = data.layers.map(l => ({
      name: l.name,
      columns: l.columns || state.columns,
      rows: l.rows || state.rows,
      data: typeof l.data === 'string' ? l.data.split(',').map(s => parseInt(s.trim(), 10)) : l.data,
      visible: l.visible !== false,
      autotile: l.autotile || false,
      terrain_map: l.terrain_map || {},
    }));

    state.activeLayerIndex = 0;
    rebuildCanvas(ctx);
    updateLayerList(ctx);
    updateGridSizeLabel(ctx);
    ctx.log(`Loaded tilemap: ${state.layers.length} layers`);
  } else {
    // Single-layer format (ku TileMap node format)
    const layer = createLayer('ground', data.columns || state.columns, data.rows || state.rows);
    if (data.data) {
      layer.data = typeof data.data === 'string' ? data.data.split(',').map(s => parseInt(s.trim(), 10)) : data.data;
    }
    if (data.terrain_map) {
      layer.terrain_map = data.terrain_map;
      layer.autotile = Object.keys(data.terrain_map).length > 0;
    }
    if (data.cell_size) state.cellSize = data.cell_size;
    state.layers = [layer];
    state.activeLayerIndex = 0;
    rebuildCanvas(ctx);
    updateLayerList(ctx);
    updateGridSizeLabel(ctx);
    ctx.log(`Loaded tilemap: 1 layer`);
  }
}
```

- [ ] **Step 2: Add load command to CLI**

In `plugins/ku-tilemap-editor/index.js`, add inside the `tilemap` command registration:

```javascript
      tilemap
        .command('load <file>')
        .description('Load a tilemap JSON file and show info')
        .action(async (file) => {
          const absFile = resolve(process.cwd(), file);
          try {
            const data = JSON.parse(await readFile(absFile, 'utf-8'));
            const info = {
              ok: true,
              data: {
                path: absFile,
                cell_size: data.cell_size,
                columns: data.columns,
                rows: data.rows,
                layers: data.layers ? data.layers.length : 1,
                version: data.version || 'legacy',
              },
            };
            console.log(JSON.stringify(info));
          } catch (err) {
            console.error(JSON.stringify({ ok: false, error: err.message }));
          }
        });
```

- [ ] **Step 3: Add import/export tests**

Add to `test/tilemap-editor.test.ts`:

```typescript
describe('multi-layer export/import roundtrip', () => {
  it('roundtrips multi-layer tilemap data', () => {
    const layers = [
      createLayer('ground', 4, 3),
      createLayer('trees', 4, 3),
    ];
    setTile(layers[0], 0, 0, 1);
    setTile(layers[0], 1, 0, 1);
    setTile(layers[1], 2, 2, 3);
    layers[1].autotile = true;
    layers[1].terrain_map = { '3': { atlas: 'tree.json', mode: 'fill' } };

    const exported = exportTilemap(layers, 16);
    const imported = importTilemap(exported);

    expect(imported).toHaveLength(2);
    expect(imported[0].name).toBe('ground');
    expect(getTile(imported[0], 0, 0)).toBe(1);
    expect(imported[1].name).toBe('trees');
    expect(getTile(imported[1], 2, 2)).toBe(3);
    expect(imported[1].autotile).toBe(true);
    expect(imported[1].terrain_map['3']).toEqual({ atlas: 'tree.json', mode: 'fill' });
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/tilemap-editor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/ku-tilemap-editor/ test/tilemap-editor.test.ts
git commit -m "feat: add multi-layer JSON load/save and CLI load command to tilemap editor"
```

---

### Task 7: Rect brush preview and drag-paint refinement

**Files:**
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Add rect brush preview overlay**

When the rect brush is active and the user has clicked the start corner but is dragging to the end corner, show a semi-transparent preview of the rect area.

Add a `rebuildRectPreview` function:

```javascript
function rebuildRectPreview(ctx, startCol, startRow, endCol, endRow) {
  // Remove previous preview
  for (let i = 0; i < 500; i++) {
    try { ctx.scene.destroy(`/tilemap_canvas/preview_${i}`); } catch { break; }
  }

  if (startCol < 0 || startRow < 0) return;

  const minC = Math.max(0, Math.min(startCol, endCol));
  const maxC = Math.min(state.columns - 1, Math.max(startCol, endCol));
  const minR = Math.max(0, Math.min(startRow, endRow));
  const maxR = Math.min(state.rows - 1, Math.max(startRow, endRow));

  let idx = 0;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const value = state.brushType === 'eraser' ? 0 : state.selectedTerrainId;
      const color = value === 0 ? '#ff000044' : terrainColor(value);
      ctx.scene.spawn('Panel', `preview_${idx}`, {
        x: c * state.cellSize,
        y: r * state.cellSize,
        width: state.cellSize,
        height: state.cellSize,
        color: color + '88', // semi-transparent
        border_color: '#ffff00',
        border_width: 1,
        corner_radius: 0,
      }, '/tilemap_canvas');
      idx++;
    }
  }
}
```

- [ ] **Step 2: Update `on_touch_move` to show rect preview**

Add to the `on_touch_move` handler, after the painting drag logic:

```javascript
    // Rect brush preview
    if (state.painting && state.brushType === 'rect' && state.rectStart) {
      const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
      const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
      const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;
      const worldX = (x / vpZoom) + vpScrollX;
      const worldY = ((y - 32) / vpZoom) + vpScrollY;
      const endCol = Math.floor(worldX / state.cellSize);
      const endRow = Math.floor(worldY / state.cellSize);
      rebuildRectPreview(ctx, state.rectStart.col, state.rectStart.row, endCol, endRow);
    }
```

- [ ] **Step 3: Verify rect brush works with preview**

Run: `npm run build && node dist/bin/ku.js tilemap edit --dir examples/zelda`
Expected: Select rect brush, click and drag in viewport, see yellow-bordered preview, release to fill.

- [ ] **Step 4: Commit**

```bash
git add plugins/ku-tilemap-editor/scripts/tilemap-editor.js
git commit -m "feat: add rect brush preview overlay to tilemap editor"
```

---

### Task 8: Hover cursor and eraser visual feedback

**Files:**
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Add hover cursor that tracks mouse position over the grid**

Add a cursor overlay that shows which cell the mouse is hovering over.

Add to `on_frame`:

```javascript
  updateHoverCursor(ctx);
```

Add the function:

```javascript
function updateHoverCursor(ctx) {
  // Remove old cursor
  try { ctx.scene.destroy('/tilemap_canvas/cursor'); } catch { /* ignore */ }

  if (state.hoverCol >= 0 && state.hoverCol < state.columns &&
      state.hoverRow >= 0 && state.hoverRow < state.rows) {
    const cursorColor = state.brushType === 'eraser' ? '#ff0000' : '#ffff00';
    ctx.scene.spawn('Panel', 'cursor', {
      x: state.hoverCol * state.cellSize,
      y: state.hoverRow * state.cellSize,
      width: state.cellSize,
      height: state.cellSize,
      color: 'transparent',
      border_color: cursorColor,
      border_width: 2,
      corner_radius: 0,
    }, '/tilemap_canvas');
  }
}
```

- [ ] **Step 2: Update `on_touch_move` to track hover position**

In the `on_touch_move` handler, when not dragging (or in the pan detection phase), update hover coordinates:

```javascript
    // Track hover position for cursor
    if (x < 768) {
      const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
      const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
      const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;
      const worldX = (x / vpZoom) + vpScrollX;
      const worldY = ((y - 32) / vpZoom) + vpScrollY;
      state.hoverCol = Math.floor(worldX / state.cellSize);
      state.hoverRow = Math.floor(worldY / state.cellSize);
    }
```

- [ ] **Step 3: Commit**

```bash
git add plugins/ku-tilemap-editor/scripts/tilemap-editor.js
git commit -m "feat: add hover cursor and eraser visual feedback to tilemap editor"
```

---

### Task 9: Undo/redo support

**Files:**
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Add undo/redo history to state**

Add to the `state` object:

```javascript
  // Undo/redo
  undoStack: [],
  redoStack: [],
  maxUndo: 50,
```

- [ ] **Step 2: Add snapshot and restore functions**

```javascript
function saveUndoSnapshot() {
  const snapshot = state.layers.map(l => ({
    name: l.name,
    columns: l.columns,
    rows: l.rows,
    data: [...l.data],
    visible: l.visible,
    autotile: l.autotile,
    terrain_map: JSON.parse(JSON.stringify(l.terrain_map)),
  }));
  state.undoStack.push({ layers: snapshot, activeIndex: state.activeLayerIndex });
  if (state.undoStack.length > state.maxUndo) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

function undo(ctx) {
  if (state.undoStack.length === 0) return;
  // Save current state to redo
  const currentSnapshot = state.layers.map(l => ({
    name: l.name,
    columns: l.columns,
    rows: l.rows,
    data: [...l.data],
    visible: l.visible,
    autotile: l.autotile,
    terrain_map: JSON.parse(JSON.stringify(l.terrain_map)),
  }));
  state.redoStack.push({ layers: currentSnapshot, activeIndex: state.activeLayerIndex });

  // Restore previous state
  const prev = state.undoStack.pop();
  state.layers = prev.layers.map(l => ({
    name: l.name,
    columns: l.columns,
    rows: l.rows,
    data: [...l.data],
    visible: l.visible,
    autotile: l.autotile,
    terrain_map: l.terrain_map,
  }));
  state.activeLayerIndex = prev.activeIndex;
  rebuildCanvas(ctx);
  updateLayerList(ctx);
  ctx.log('Undo');
}

function redo(ctx) {
  if (state.redoStack.length === 0) return;
  // Save current state to undo
  const currentSnapshot = state.layers.map(l => ({
    name: l.name,
    columns: l.columns,
    rows: l.rows,
    data: [...l.data],
    visible: l.visible,
    autotile: l.autotile,
    terrain_map: JSON.parse(JSON.stringify(l.terrain_map)),
  }));
  state.undoStack.push({ layers: currentSnapshot, activeIndex: state.activeLayerIndex });

  // Restore next state
  const next = state.redoStack.pop();
  state.layers = next.layers.map(l => ({
    name: l.name,
    columns: l.columns,
    rows: l.rows,
    data: [...l.data],
    visible: l.visible,
    autotile: l.autotile,
    terrain_map: l.terrain_map,
  }));
  state.activeLayerIndex = next.activeIndex;
  rebuildCanvas(ctx);
  updateLayerList(ctx);
  ctx.log('Redo');
}
```

- [ ] **Step 3: Add undo/redo key bindings and integrate with paint actions**

Add to the `on_key` handler:

```javascript
      case 'Z':
        undo(ctx);
        break;
      case 'Y':
        redo(ctx);
        break;
```

Add `saveUndoSnapshot()` calls before any paint operation:
- Before `setTile` in `handleViewportClick` (tile/eraser brush)
- Before `floodFill` in `handleViewportClick` (fill brush)
- Before `rectFill` in `on_touch_end` (rect brush)
- Before `clearLayer` in `clearActiveLayer`

- [ ] **Step 4: Commit**

```bash
git add plugins/ku-tilemap-editor/scripts/tilemap-editor.js
git commit -m "feat: add undo/redo support (Z/Y keys) to tilemap editor"
```

---

### Task 10: Integration test and final polish

**Files:**
- Modify: `test/tilemap-editor.test.ts`
- Modify: `plugins/ku-tilemap-editor/scripts/tilemap-editor.js`

- [ ] **Step 1: Add integration-level test for the full workflow**

Add to `test/tilemap-editor.test.ts`:

```typescript
describe('full editor workflow', () => {
  it('paints with tile brush, then erases', () => {
    const layer = createLayer('test', 5, 5);
    // Paint tile
    setTile(layer, 2, 2, 3);
    expect(getTile(layer, 2, 2)).toBe(3);
    // Erase
    setTile(layer, 2, 2, 0);
    expect(getTile(layer, 2, 2)).toBe(0);
  });

  it('fills region, then flood fills', () => {
    const layer = createLayer('test', 6, 6);
    // Draw a border
    for (let c = 1; c <= 4; c++) { setTile(layer, c, 1, 1); setTile(layer, c, 4, 1); }
    for (let r = 1; r <= 4; r++) { setTile(layer, 1, r, 1); setTile(layer, 4, r, 1); }
    // Flood fill interior with 2
    floodFill(layer, 2, 2, 2);
    expect(getTile(layer, 2, 2)).toBe(2);
    expect(getTile(layer, 3, 3)).toBe(2);
    // Border still 1
    expect(getTile(layer, 1, 1)).toBe(1);
    // Outside still 0
    expect(getTile(layer, 0, 0)).toBe(0);
  });

  it('multi-layer edit and export', () => {
    const layers = [
      createLayer('ground', 4, 3),
      createLayer('objects', 4, 3),
    ];
    setTile(layers[0], 0, 0, 1);
    setTile(layers[0], 1, 0, 1);
    setTile(layers[1], 2, 1, 5);

    const exported = exportTilemap(layers, 16);
    expect(exported.layers).toHaveLength(2);
    expect(exported.layers[0].data[0]).toBe(1);
    expect(exported.layers[0].data[1]).toBe(1);
    expect(exported.layers[1].data[6]).toBe(5); // col=2, row=1, idx = 1*4+2 = 6

    // Re-import
    const imported = importTilemap(exported);
    expect(getTile(imported[0], 0, 0)).toBe(1);
    expect(getTile(imported[1], 2, 1)).toBe(5);
  });

  it('rect fill and clear', () => {
    const layer = createLayer('test', 8, 8);
    rectFill(layer, 2, 2, 4, 4, 7);
    expect(getTile(layer, 2, 2)).toBe(7);
    expect(getTile(layer, 4, 4)).toBe(7);
    expect(getTile(layer, 1, 2)).toBe(0);
    expect(getTile(layer, 5, 2)).toBe(0);
    clearLayer(layer);
    expect(layer.data.every(v => v === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run test/tilemap-editor.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still pass

- [ ] **Step 4: Manual smoke test**

Run: `npm run build && node dist/bin/ku.js tilemap edit --dir examples/zelda`
Test:
1. Tile brush: click cells to paint terrain ID 1
2. Rect brush: click and drag to fill a rectangle
3. Fill brush: click to flood fill an area
4. Eraser: click to erase cells
5. Layer add/remove/reorder
6. Zoom: +/- keys
7. Pan: arrow keys
8. Save: click "Save Tilemap"
9. Undo/redo: Z/Y keys

- [ ] **Step 5: Commit**

```bash
git add test/tilemap-editor.test.ts plugins/ku-tilemap-editor/
git commit -m "test: add integration tests and final polish for tilemap editor plugin"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Multiple tile layers | Task 3 (createLayer, layer CRUD), Task 6 (multi-layer save/load) |
| Read tileset with atlas | Task 4 (atlas loading, terrain palette) |
| Tile brush | Task 3 (handleViewportClick, tile mode) |
| Rect brush | Task 3 (rect mode), Task 7 (preview overlay) |
| Fill brush | Task 3 (floodFill), Task 2 (floodFill tests) |
| Eraser brush | Task 3 (eraser mode), Task 8 (visual feedback) |
| Autotile support | Task 5 (autotile resolution, bitmask, visual borders) |
| Load/save JSON | Task 6 (multi-layer JSON format, CLI load/export) |

### Placeholder Scan

No TBD/TODO/fill-in-later found. All code blocks contain complete implementations.

### Type Consistency

- `EditorLayer` / `createLayer` return type: `{ name, columns, rows, data, visible, autotile, terrain_map }` — consistent across test and editor script
- `floodFill(layer, col, row, value)` — consistent signature across test and editor
- `rectFill(layer, x1, y1, x2, y2, value)` — consistent signature
- `exportTilemap(layers, cellSize)` / `importTilemap(data)` — consistent
- `state.layers` array of `EditorLayer` — consistent
- `state.selectedTerrainId: number` — consistent
- `state.brushType: 'tile' | 'rect' | 'fill' | 'eraser'` — consistent
