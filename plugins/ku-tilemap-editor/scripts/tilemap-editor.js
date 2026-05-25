// Tilemap Editor — runs as a JS script on the root node
// Full editor logic: initialization, canvas rendering, brushes, layers, save/export

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  columns: 20,
  rows: 15,
  cellSize: 16,
  editorScene: '',
  tilemapPath: '',
  layers: [],
  activeLayerIndex: 0,
  atlasData: null,
  atlasPath: '',
  selectedTerrainId: 0,
  brushType: 'tile',
  autotileEnabled: false,
  dragState: null,
  touchMoved: false,
  pendingHit: null,
  rectStart: null,
  painting: false,
  initialized: false,
  hoverCol: -1,
  hoverRow: -1,
};

// ─── Data Model ───────────────────────────────────────────────────────────────

function createLayer(name, columns, rows) {
  return {
    name: name,
    columns: columns,
    rows: rows,
    data: new Array(columns * rows).fill(0),
    visible: true,
    autotile: false,
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
    const key = r * layer.columns + c;
    if (visited.has(key)) continue;
    if (c < 0 || c >= layer.columns || r < 0 || r >= layer.rows) continue;
    if (layer.data[key] !== target) continue;
    visited.add(key);
    layer.data[key] = replacement;
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
}

function rectFill(layer, x1, y1, x2, y2, value) {
  const minC = Math.min(x1, x2);
  const maxC = Math.max(x1, x2);
  const minR = Math.min(y1, y2);
  const maxR = Math.max(y1, y2);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      setTile(layer, c, r, value);
    }
  }
}

// ─── Color Helpers ────────────────────────────────────────────────────────────

const TERRAIN_COLORS = [
  '#4a8c3f', '#2a6cb6', '#c4a46c', '#8b4513',
  '#6a6a8a', '#cc5de8', '#ff922b', '#20c997',
  '#fcc419', '#ff6b6b', '#339af0', '#748ffc',
  '#51cf66', '#e8d5a3', '#5a3a5e', '#3a3a5e',
];

function terrainColor(id) {
  if (id === 0) return '#1a1a2e';
  return TERRAIN_COLORS[(id - 1) % TERRAIN_COLORS.length];
}

// ─── Initialization ───────────────────────────────────────────────────────────

function initEditor(ctx) {
  // Read config from root node properties
  state.columns = ctx.scene.get('/', 'editor_columns') || 20;
  state.rows = ctx.scene.get('/', 'editor_rows') || 15;
  state.cellSize = ctx.scene.get('/', 'editor_cell_size') || 16;
  state.editorScene = ctx.scene.get('/', 'editor_scene') || '';
  state.tilemapPath = ctx.scene.get('/', 'editor_tilemap_path') || '';

  // Create default layer
  state.layers = [createLayer('Layer 0', state.columns, state.rows)];
  state.activeLayerIndex = 0;

  // Load scene data if provided
  const sceneDataStr = ctx.scene.get('/', 'editor_scene_data');
  if (sceneDataStr && typeof sceneDataStr === 'string') {
    loadFromScene(ctx, sceneDataStr);
  }

  // Set viewport zoom
  ctx.scene.set('/viewport', 'zoom', 2);
  updateZoomLabel(ctx);

  // Initial canvas rebuild
  rebuildCanvas(ctx);
  updateLayerList(ctx);
  updateGridSizeLabel(ctx);
  updateSelectedTileLabel(ctx);
  setBrush(ctx, 'tile');

  state.initialized = true;
  ctx.log('Tilemap editor initialized: ' + state.columns + 'x' + state.rows + ' @' + state.cellSize + 'px');
}

// ─── Scene Data Loading ───────────────────────────────────────────────────────

function loadFromScene(ctx, sceneDataStr) {
  try {
    const sceneData = JSON.parse(sceneDataStr);
    let tilemapNode = null;

    // Try specific path first
    if (state.tilemapPath) {
      const parts = state.tilemapPath.split('/').filter(Boolean);
      tilemapNode = findNodeInData(sceneData.root, parts);
    }

    // Fallback: find first TileMap
    if (!tilemapNode) {
      tilemapNode = findFirstTilemap(sceneData.root);
    }

    if (tilemapNode && tilemapNode.type === 'TileMap') {
      const props = tilemapNode.properties || {};
      const cols = props.columns || state.columns;
      const rows = props.rows || state.rows;
      state.columns = cols;
      state.rows = rows;

      // Rebuild layer with correct dimensions
      state.layers = [createLayer('Layer 0', cols, rows)];

      // Load tile data
      const dataStr = props.data || '';
      if (dataStr && typeof dataStr === 'string') {
        const tileData = dataStr.split(',').map(Number);
        for (let i = 0; i < tileData.length && i < cols * rows; i++) {
          state.layers[0].data[i] = tileData[i] || 0;
        }
      }

      // Load terrain map for autotile reference
      if (props.terrain_map && typeof props.terrain_map === 'object') {
        ctx.log('Loaded terrain_map with ' + Object.keys(props.terrain_map).length + ' entries');
      }

      ctx.log('Loaded tilemap: ' + cols + 'x' + rows);
    }
  } catch (err) {
    ctx.log('Error loading scene data: ' + (err.message || err));
  }
}

function findNodeInData(node, pathParts) {
  if (pathParts.length === 0) return node;
  if (!node || !node.children) return null;
  const target = pathParts[0];
  for (const child of node.children) {
    if (child.id === target) {
      return findNodeInData(child, pathParts.slice(1));
    }
  }
  return null;
}

function findFirstTilemap(node) {
  if (!node) return null;
  if (node.type === 'TileMap') return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findFirstTilemap(child);
      if (found) return found;
    }
  }
  return null;
}

// ─── Canvas Rendering ─────────────────────────────────────────────────────────

function rebuildCanvas(ctx) {
  // Destroy old tile nodes and grid lines
  for (let i = 0; i < 2000; i++) {
    try { ctx.scene.destroy('/tilemap_canvas/tile_' + i); } catch (e) { /* skip */ }
  }
  for (let i = 0; i < 500; i++) {
    try { ctx.scene.destroy('/tilemap_canvas/hline_' + i); } catch (e) { /* skip */ }
    try { ctx.scene.destroy('/tilemap_canvas/vline_' + i); } catch (e) { /* skip */ }
  }
  try { ctx.scene.destroy('/tilemap_canvas/bg'); } catch (e) { /* skip */ }

  const cs = state.cellSize;
  const totalW = state.columns * cs;
  const totalH = state.rows * cs;

  // Draw grid background
  ctx.scene.spawn('Panel', 'bg', {
    x: 0, y: 0,
    width: totalW, height: totalH,
    color: '#1a1a2e',
    border_color: '#3a3a5e',
    border_width: 1,
  }, '/tilemap_canvas');

  // Draw visible layer tiles as colored Panels (bottom to top)
  let tileIdx = 0;
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (let r = 0; r < layer.rows; r++) {
      for (let c = 0; c < layer.columns; c++) {
        const val = layer.data[r * layer.columns + c];
        if (val === 0) continue;
        ctx.scene.spawn('Panel', 'tile_' + tileIdx, {
          x: c * cs, y: r * cs,
          width: cs, height: cs,
          color: terrainColor(val),
          border_color: '#000000',
          border_width: 0,
        }, '/tilemap_canvas');
        tileIdx++;
      }
    }
  }

  // Draw grid lines
  for (let r = 0; r <= state.rows; r++) {
    ctx.scene.spawn('Block', 'hline_' + r, {
      width: totalW, height: 1,
      color: '#2a2a4e',
    }, '/tilemap_canvas');
    ctx.scene.set('/tilemap_canvas/hline_' + r, 'x', 0);
    ctx.scene.set('/tilemap_canvas/hline_' + r, 'y', r * cs);
  }
  for (let c = 0; c <= state.columns; c++) {
    ctx.scene.spawn('Block', 'vline_' + c, {
      width: 1, height: totalH,
      color: '#2a2a4e',
    }, '/tilemap_canvas');
    ctx.scene.set('/tilemap_canvas/vline_' + c, 'x', c * cs);
    ctx.scene.set('/tilemap_canvas/vline_' + c, 'y', 0);
  }
}

// ─── Viewport Coordinate Conversion ───────────────────────────────────────────

function screenToGrid(ctx, screenX, screenY) {
  const vpZoom = ctx.scene.get('/viewport', 'zoom') || 2;
  const vpScrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
  const vpScrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;
  const worldX = (screenX / vpZoom) + vpScrollX;
  const worldY = ((screenY - 32) / vpZoom) + vpScrollY;
  const col = Math.floor(worldX / state.cellSize);
  const row = Math.floor(worldY / state.cellSize);
  return { col, row };
}

// ─── Viewport Click Handler ───────────────────────────────────────────────────

function handleViewportClick(ctx, screenX, screenY) {
  const { col, row } = screenToGrid(ctx, screenX, screenY);
  if (col < 0 || col >= state.columns || row < 0 || row >= state.rows) return;

  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;

  switch (state.brushType) {
    case 'tile':
      setTile(layer, col, row, state.selectedTerrainId || 1);
      state.painting = true;
      break;
    case 'eraser':
      setTile(layer, col, row, 0);
      state.painting = true;
      break;
    case 'fill':
      floodFill(layer, col, row, state.selectedTerrainId || 1);
      break;
    case 'rect':
      if (!state.rectStart) {
        state.rectStart = { col, row };
      } else {
        rectFill(layer, state.rectStart.col, state.rectStart.row, col, row, state.selectedTerrainId || 1);
        state.rectStart = null;
      }
      break;
  }

  rebuildCanvas(ctx);
  updateCoordsLabel(ctx);
}

function paintAt(ctx, col, row) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;
  if (col < 0 || col >= state.columns || row < 0 || row >= state.rows) return;

  if (state.brushType === 'tile') {
    setTile(layer, col, row, state.selectedTerrainId || 1);
  } else if (state.brushType === 'eraser') {
    setTile(layer, col, row, 0);
  }
}

// ─── Sidebar Click Handler ────────────────────────────────────────────────────

function handleClick(ctx, hitNode) {
  if (!hitNode) return;

  switch (hitNode) {
    case 'tileset_load_btn':
      loadTilesetAtlas(ctx);
      break;
    case 'brush_tile_btn':
      setBrush(ctx, 'tile');
      break;
    case 'brush_rect_btn':
      setBrush(ctx, 'rect');
      break;
    case 'brush_fill_btn':
      setBrush(ctx, 'fill');
      break;
    case 'brush_eraser_btn':
      setBrush(ctx, 'eraser');
      break;
    case 'autotile_toggle':
      toggleAutotile(ctx);
      break;
    case 'layer_add_btn':
      addLayer(ctx);
      break;
    case 'layer_rm_btn':
      removeLayer(ctx);
      break;
    case 'layer_up_btn':
      moveLayer(ctx, -1);
      break;
    case 'layer_down_btn':
      moveLayer(ctx, 1);
      break;
    case 'layer_toggle_btn':
      toggleLayerVisibility(ctx);
      break;
    case 'save_btn':
      saveTilemap(ctx);
      break;
    case 'export_btn':
      exportTilemapJSON(ctx);
      break;
    case 'clear_btn':
      clearActiveLayer(ctx);
      break;
    default:
      // Check for layer selection button
      if (hitNode.startsWith('layer_btn_')) {
        const idx = parseInt(hitNode.slice('layer_btn_'.length), 10);
        if (!isNaN(idx)) selectLayer(ctx, idx);
      }
      break;
  }
}

// ─── Brush Management ─────────────────────────────────────────────────────────

function setBrush(ctx, type) {
  state.brushType = type;
  state.rectStart = null;
  state.painting = false;

  const btnMap = {
    tile: 'brush_tile_btn',
    rect: 'brush_rect_btn',
    fill: 'brush_fill_btn',
    eraser: 'brush_eraser_btn',
  };

  for (const [btype, btnId] of Object.entries(btnMap)) {
    const active = btype === type;
    ctx.scene.set('/' + btnId, 'color', active ? '#4a6a4e' : '#3a3a5e');
    ctx.scene.set('/' + btnId, 'text_color', active ? '#ffffff' : '#cccccc');
  }
}

// ─── Autotile Toggle ──────────────────────────────────────────────────────────

function toggleAutotile(ctx) {
  state.autotileEnabled = !state.autotileEnabled;
  const layer = state.layers[state.activeLayerIndex];
  if (layer) {
    layer.autotile = state.autotileEnabled;
  }

  ctx.scene.set('/autotile_toggle', 'text', 'Autotile: ' + (state.autotileEnabled ? 'On' : 'Off'));
  ctx.scene.set('/autotile_toggle', 'color', state.autotileEnabled ? '#4a6a4e' : '#3a3a5e');
  updateLayerList(ctx);
}

// ─── Layer Management ─────────────────────────────────────────────────────────

function addLayer(ctx) {
  const idx = state.layers.length;
  state.layers.push(createLayer('Layer ' + idx, state.columns, state.rows));
  state.activeLayerIndex = idx;
  updateLayerList(ctx);
  rebuildCanvas(ctx);
  ctx.log('Added layer: Layer ' + idx);
}

function removeLayer(ctx) {
  if (state.layers.length <= 1) {
    ctx.log('Cannot remove the last layer');
    return;
  }
  const name = state.layers[state.activeLayerIndex].name;
  state.layers.splice(state.activeLayerIndex, 1);
  if (state.activeLayerIndex >= state.layers.length) {
    state.activeLayerIndex = state.layers.length - 1;
  }
  updateLayerList(ctx);
  rebuildCanvas(ctx);
  ctx.log('Removed layer: ' + name);
}

function selectLayer(ctx, index) {
  if (index < 0 || index >= state.layers.length) return;
  state.activeLayerIndex = index;
  const layer = state.layers[index];
  state.autotileEnabled = layer.autotile;
  ctx.scene.set('/autotile_toggle', 'text', 'Autotile: ' + (state.autotileEnabled ? 'On' : 'Off'));
  ctx.scene.set('/autotile_toggle', 'color', state.autotileEnabled ? '#4a6a4e' : '#3a3a5e');
  updateLayerList(ctx);
}

function moveLayer(ctx, direction) {
  const newIdx = state.activeLayerIndex + direction;
  if (newIdx < 0 || newIdx >= state.layers.length) return;
  const temp = state.layers[state.activeLayerIndex];
  state.layers[state.activeLayerIndex] = state.layers[newIdx];
  state.layers[newIdx] = temp;
  state.activeLayerIndex = newIdx;
  updateLayerList(ctx);
  rebuildCanvas(ctx);
}

function toggleLayerVisibility(ctx) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;
  layer.visible = !layer.visible;
  updateLayerList(ctx);
  rebuildCanvas(ctx);
}

function clearActiveLayer(ctx) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;
  clearLayer(layer);
  rebuildCanvas(ctx);
  ctx.log('Cleared layer: ' + layer.name);
}

// ─── Layer List Rendering ─────────────────────────────────────────────────────

function updateLayerList(ctx) {
  // Destroy old layer buttons
  for (let i = 0; i < 50; i++) {
    try { ctx.scene.destroy('/layer_list/layer_btn_' + i); } catch (e) { /* skip */ }
  }

  // Render bottom-to-top: bottom layer at top of list
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const listIdx = state.layers.length - 1 - i;
    const isActive = (i === state.activeLayerIndex);
    let label = '';
    if (isActive) label += '> ';
    else label += '  ';
    label += layer.name;
    if (!layer.visible) label += ' [hidden]';
    if (layer.autotile) label += ' [A]';

    ctx.scene.spawn('Button', 'layer_btn_' + i, {
      x: 0, y: listIdx * 24,
      width: 236, height: 22,
      text: label,
      color: isActive ? '#4a6a4e' : '#2a2a4e',
      hover_color: isActive ? '#5a7a5e' : '#3a3a5e',
      pressed_color: isActive ? '#3a5a3e' : '#1a1a3e',
      text_color: isActive ? '#ffff00' : '#cccccc',
      font_size: 10,
      corner_radius: 2,
      clickable: true,
    }, '/layer_list');
  }
}

// ─── Save / Export ────────────────────────────────────────────────────────────

function saveTilemap(ctx) {
  const layerData = state.layers.map(function(layer) {
    return {
      name: layer.name,
      columns: layer.columns,
      rows: layer.rows,
      data: layer.data.join(','),
      visible: layer.visible,
      autotile: layer.autotile,
    };
  });

  const payload = {
    columns: state.columns,
    rows: state.rows,
    cell_size: state.cellSize,
    layers: layerData,
    editor_scene: state.editorScene,
    tilemap_path: state.tilemapPath,
  };

  ctx.emit('save_tilemap', payload);
  ctx.log('Saved tilemap: ' + state.layers.length + ' layers, ' + state.columns + 'x' + state.rows);
}

function exportTilemapJSON(ctx) {
  const layer = state.layers[state.activeLayerIndex];
  if (!layer) return;

  const payload = {
    cell_size: state.cellSize,
    columns: state.columns,
    rows: state.rows,
    data: layer.data.join(','),
    terrain_map: {},
  };

  ctx.emit('save_tilemap', payload);
  ctx.log('Exported layer: ' + layer.name);
}

// ─── Tileset Atlas Loading (placeholder) ──────────────────────────────────────

function loadTilesetAtlas(ctx) {
  ctx.log('Tileset atlas loading not yet implemented (Task 4)');
}

// ─── UI Label Updates ─────────────────────────────────────────────────────────

function updateCoordsLabel(ctx) {
  const text = state.hoverCol + ', ' + state.hoverRow;
  ctx.scene.set('/toolbar/coords_label', 'text', text);
}

function updateZoomLabel(ctx) {
  const zoom = ctx.scene.get('/viewport', 'zoom') || 2;
  const pct = Math.round(zoom * 100);
  ctx.scene.set('/toolbar/zoom_label', 'text', pct + '%');
}

function updateGridSizeLabel(ctx) {
  ctx.scene.set('/sidebar/actions_panel/grid_size_label', 'text',
    state.columns + 'x' + state.rows + ' @' + state.cellSize + 'px');
}

function updateSelectedTileLabel(ctx) {
  const id = state.selectedTerrainId;
  if (id === 0) {
    ctx.scene.set('/sidebar/brush_panel/selected_tile_label', 'text', 'Tile: none');
  } else {
    ctx.scene.set('/sidebar/brush_panel/selected_tile_label', 'text', 'Tile: ' + id + ' (' + terrainColor(id) + ')');
  }
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

const handlers = {
  on_touch_start(ctx) {
    const x = ctx.data.x;
    const y = ctx.data.y;
    if (x === undefined || y === undefined) return;

    state.touchMoved = false;
    state.pendingHit = ctx.data.hit || null;

    // Determine if click is in sidebar area
    const sidebarX = 768;
    if (x >= sidebarX) {
      // Sidebar click — will be handled by on_gui_click or deferred
      return;
    }

    // Viewport area — start potential paint or pan
    if (y >= 32) {
      state.dragState = {
        startScreenX: x,
        startScreenY: y,
        startScrollX: ctx.scene.get('/viewport', 'scroll_x') || 0,
        startScrollY: ctx.scene.get('/viewport', 'scroll_y') || 0,
        isPaint: false,
      };
    }
  },

  on_gui_click(ctx) {
    const hitNode = ctx.data.hit;
    if (!hitNode) return;

    if (state.touchMoved) {
      // Touch moved too far — not a click
      state.pendingHit = null;
      return;
    }

    handleClick(ctx, hitNode);
    state.pendingHit = null;
  },

  on_touch_move(ctx) {
    const x = ctx.data.x;
    const y = ctx.data.y;
    if (x === undefined || y === undefined) return;

    // Update hover position
    const { col, row } = screenToGrid(ctx, x, y);
    if (col !== state.hoverCol || row !== state.hoverRow) {
      state.hoverCol = col;
      state.hoverRow = row;
      updateCoordsLabel(ctx);
    }

    if (!state.dragState) return;

    const dx = x - state.dragState.startScreenX;
    const dy = y - state.dragState.startScreenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Only mark as moved once past 3px threshold
    if (dist >= 3) {
      state.touchMoved = true;
    }

    if (!state.dragState.isPaint && dist < 3) return;

    // Determine if painting or panning
    if (!state.dragState.isPaint) {
      if (state.painting && (state.brushType === 'tile' || state.brushType === 'eraser')) {
        // Start drag-painting
        state.dragState.isPaint = true;
      } else {
        // Pan the viewport
        const zoom = ctx.scene.get('/viewport', 'zoom') || 2;
        ctx.scene.set('/viewport', 'scroll_x', state.dragState.startScrollX - dx / zoom);
        ctx.scene.set('/viewport', 'scroll_y', state.dragState.startScrollY - dy / zoom);
        return;
      }
    }

    // Drag-paint
    if (state.dragState.isPaint && y >= 32 && x < 768) {
      paintAt(ctx, col, row);
      rebuildCanvas(ctx);
    }
  },

  on_touch_end(ctx) {
    const x = ctx.data.x;
    const y = ctx.data.y;

    // Finalize click if touch didn't move much
    if (!state.touchMoved && state.pendingHit) {
      // Sidebar click already handled by on_gui_click
      state.pendingHit = null;
    } else if (!state.touchMoved && x !== undefined && y !== undefined) {
      // Viewport click — apply brush
      if (y >= 32 && x < 768) {
        handleViewportClick(ctx, x, y);
      }
    }

    // Finalize rect brush
    if (state.brushType === 'rect' && state.rectStart && state.touchMoved && x !== undefined && y !== undefined) {
      const { col, row } = screenToGrid(ctx, x, y);
      const layer = state.layers[state.activeLayerIndex];
      if (layer && col >= 0 && col < state.columns && row >= 0 && row < state.rows) {
        rectFill(layer, state.rectStart.col, state.rectStart.row, col, row, state.selectedTerrainId || 1);
        state.rectStart = null;
        rebuildCanvas(ctx);
      }
    }

    // End painting
    state.painting = false;
    state.dragState = null;

    // Handle deferred sidebar click
    if (state.pendingHit && !state.touchMoved) {
      handleClick(ctx, state.pendingHit);
      state.pendingHit = null;
    }
  },

  on_key(ctx) {
    const key = ctx.data.key;
    if (!key) return;

    switch (key) {
      case '+':
      case '=': {
        const zoom = ctx.scene.get('/viewport', 'zoom') || 2;
        ctx.scene.set('/viewport', 'zoom', Math.min(zoom + 0.5, 8));
        updateZoomLabel(ctx);
        break;
      }
      case '-':
      case '_': {
        const zoom = ctx.scene.get('/viewport', 'zoom') || 2;
        ctx.scene.set('/viewport', 'zoom', Math.max(zoom - 0.5, 0.5));
        updateZoomLabel(ctx);
        break;
      }
      case 'ArrowLeft': {
        const sx = ctx.scene.get('/viewport', 'scroll_x') || 0;
        ctx.scene.set('/viewport', 'scroll_x', sx - 16);
        break;
      }
      case 'ArrowRight': {
        const sx = ctx.scene.get('/viewport', 'scroll_x') || 0;
        ctx.scene.set('/viewport', 'scroll_x', sx + 16);
        break;
      }
      case 'ArrowUp': {
        const sy = ctx.scene.get('/viewport', 'scroll_y') || 0;
        ctx.scene.set('/viewport', 'scroll_y', sy - 16);
        break;
      }
      case 'ArrowDown': {
        const sy = ctx.scene.get('/viewport', 'scroll_y') || 0;
        ctx.scene.set('/viewport', 'scroll_y', sy + 16);
        break;
      }
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
    // Initialize on first frame
    if (!state.initialized) {
      initEditor(ctx);
    }

    // Update hover coords from touch position if available
    if (state.hoverCol >= 0 && state.hoverRow >= 0) {
      updateCoordsLabel(ctx);
    }
  },
};
