// Sprite Sheet Editor — runs as a JS script on the root node

const state = {
  regions: [],
  selectedRegion: -1,
  texturePath: '',
  atlasPath: '',
  previewPlaying: false,
  previewFrame: 0,
  previewTimer: 0,
  previewSpeed: 8,
  dragState: null,
  touchMoved: false,        // true if touch moved past drag threshold
  pendingHit: null,         // hit_node from on_gui_click, deferred to on_touch_end
  gridCols: 4,
  gridRows: 4,
  gridPrefix: 'frame_',
  initialized: false,
  editingField: null,        // 'name' | null
  editBuffer: '',
};

const REGION_COLORS = [
  '#ff6b6b', '#51cf66', '#339af0', '#fcc419',
  '#cc5de8', '#ff922b', '#20c997', '#748ffc',
];

// Layout constants (match scene template)
const VIEWPORT_W = 600;
const SIDEBAR_X = 600;
const SIDEBAR_W = 200;
const REGION_LIST_W = 188;
const REGION_LIST_ITEM_H = 22;

function regionColor(index) {
  return REGION_COLORS[index % REGION_COLORS.length];
}

const handlers = {
  on_touch_start(ctx) {
    const { x, y } = ctx.data;

    state.dragState = null;
    state.touchMoved = false;
    state.pendingHit = null;

    // If editing, commit on click outside
    if (state.editingField) {
      commitEdit(ctx);
      return;
    }

    // Sidebar region list scroll area (x >= SIDEBAR_X, y in list area)
    if (x >= SIDEBAR_X && y >= 54 && y < 234) {
      state.dragState = {
        type: 'list_scroll',
        startX: x,
        startY: y,
        scrollStartY: ctx.scene.get('/sidebar/region_list', 'scroll_y') || 0,
      };
      return;
    }

    // Only pan viewport for touches inside the viewport area
    if (x >= VIEWPORT_W) return;

    state.dragState = {
      type: 'tentative_pan',
      startX: x,
      startY: y,
      scrollStartX: ctx.scene.get('/viewport', 'scroll_x') || 0,
      scrollStartY: ctx.scene.get('/viewport', 'scroll_y') || 0,
    };
  },

  // on_gui_click fires during touchStart (not after touchEnd).
  // For touch events: defer to on_touch_end so we can distinguish tap vs drag.
  // For mouse events: dragState is null, so handle immediately.
  on_gui_click(ctx) {
    if (state.dragState) {
      // Touch-initiated: save hit for on_touch_end to process
      state.pendingHit = ctx.data.hit_node || null;
      return;
    }
    // Mouse-initiated click: handle immediately
    handleClick(ctx, ctx.data.hit_node || null);
  },

  on_touch_move(ctx) {
    if (!state.dragState) return;
    const { x, y } = ctx.data;

    if (state.dragState.type === 'list_scroll') {
      const dy = y - state.dragState.startY;
      if (Math.abs(dy) > 3) state.touchMoved = true;
      ctx.scene.set('/sidebar/region_list', 'scroll_y', state.dragState.scrollStartY - dy);
      return;
    }

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
  },

  on_touch_end(ctx) {
    // Tap (no drag): process the deferred click
    if (!state.touchMoved && state.pendingHit) {
      handleClick(ctx, state.pendingHit);
    }

    // Button release state cleanup
    if (state.pendingHit && state.pendingHit.startsWith('item_')) {
      try {
        ctx.scene.set(`/sidebar/region_list/${state.pendingHit}`, 'state', 'normal');
      } catch { /* ignore */ }
    }

    state.dragState = null;
    state.touchMoved = false;
    state.pendingHit = null;
  },

  on_key(ctx) {
    const key = ctx.data.key;

    // Handle text editing mode
    if (state.editingField === 'name') {
      handleEditKey(ctx, key);
      return;
    }

    const zoom = ctx.scene.get('/viewport', 'zoom') || 1;
    const scrollX = ctx.scene.get('/viewport', 'scroll_x') || 0;
    const scrollY = ctx.scene.get('/viewport', 'scroll_y') || 0;

    switch (key) {
      case 'PLUS':
      case '=':
        ctx.scene.set('/viewport', 'zoom', Math.min(zoom * 1.2, 10));
        updateZoomLabel(ctx);
        break;
      case '-':
        ctx.scene.set('/viewport', 'zoom', Math.max(zoom / 1.2, 0.1));
        updateZoomLabel(ctx);
        break;
      case 'UP':
      case 'DOWN':
      case 'LEFT':
      case 'RIGHT':
        if (state.selectedRegion >= 0 && state.selectedRegion < state.regions.length) {
          nudgeRegion(ctx, key);
        } else {
          // Pan viewport
          if (key === 'UP') ctx.scene.set('/viewport', 'scroll_y', scrollY - 20);
          else if (key === 'DOWN') ctx.scene.set('/viewport', 'scroll_y', scrollY + 20);
          else if (key === 'LEFT') ctx.scene.set('/viewport', 'scroll_x', scrollX - 20);
          else if (key === 'RIGHT') ctx.scene.set('/viewport', 'scroll_x', scrollX + 20);
        }
        break;
      case 'DELETE':
        if (state.selectedRegion >= 0 && state.selectedRegion < state.regions.length) {
          removeRegion(ctx, state.selectedRegion);
        }
        break;
      case 'ENTER':
        if (state.selectedRegion >= 0) {
          startEditName(ctx);
        }
        break;
      case 'ESCAPE':
        if (state.editingField) {
          cancelEdit(ctx);
        }
        break;
      case 'SPACE':
        togglePreview(ctx);
        break;
    }
  },

  on_frame(ctx) {
    if (!state.initialized) {
      state.initialized = true;
      initEditor(ctx);
    }

    const dt = ctx.data.dt || 16;

    if (state.previewPlaying && state.regions.length > 0) {
      state.previewTimer += dt;
      const frameDuration = 1000 / state.previewSpeed;
      while (state.previewTimer >= frameDuration) {
        state.previewTimer -= frameDuration;
        state.previewFrame = (state.previewFrame + 1) % state.regions.length;
      }
      updatePreview(ctx);
    }

    updateZoomLabel(ctx);
  },
};

// --- Name editing ---

function startEditName(ctx) {
  const r = state.regions[state.selectedRegion];
  state.editingField = 'name';
  state.editBuffer = r.name;
  ctx.scene.set('/sidebar/detail_panel/detail_name_btn', 'text', r.name + '|');
  ctx.scene.set('/sidebar/detail_panel/detail_name_btn', 'color', '#4a4a6e');
}

function commitEdit(ctx) {
  if (state.editingField === 'name') {
    state.regions[state.selectedRegion].name = state.editBuffer;
    updateDetailPanel(ctx);
    updateRegionList(ctx);
    updateRegionNode(ctx, state.selectedRegion);
  }
  state.editingField = null;
  state.editBuffer = '';
  ctx.scene.set('/sidebar/detail_panel/detail_name_btn', 'color', '#2a2a3e');
}

function cancelEdit(ctx) {
  state.editingField = null;
  state.editBuffer = '';
  updateDetailPanel(ctx);
  ctx.scene.set('/sidebar/detail_panel/detail_name_btn', 'color', '#2a2a3e');
}

function handleEditKey(ctx, key) {
  if (key === 'ENTER') {
    commitEdit(ctx);
  } else if (key === 'ESCAPE') {
    cancelEdit(ctx);
  } else if (key === 'BACKSPACE') {
    if (state.editBuffer.length > 0) {
      state.editBuffer = state.editBuffer.slice(0, -1);
      ctx.scene.set('/sidebar/detail_panel/detail_name_btn', 'text', state.editBuffer + '|');
    }
  } else if (key.length === 1) {
    // Printable character
    state.editBuffer += key;
    ctx.scene.set('/sidebar/detail_panel/detail_name_btn', 'text', state.editBuffer + '|');
  }
}

// --- Click dispatch ---

function handleClick(ctx, hitNode) {
  if (!hitNode) return;

  switch (hitNode) {
    case 'grid_btn':
      doGridSlice(ctx);
      break;
    case 'add_btn':
      addRegion(ctx);
      break;
    case 'preview_btn':
      togglePreview(ctx);
      break;
    case 'save_btn':
      saveAtlas(ctx);
      break;
    case 'delete_btn':
      if (state.selectedRegion >= 0 && state.selectedRegion < state.regions.length) {
        removeRegion(ctx, state.selectedRegion);
      }
      break;
    case 'detail_name_btn':
      if (state.selectedRegion >= 0 && state.selectedRegion < state.regions.length) {
        startEditName(ctx);
      }
      break;
    default:
      if (hitNode.startsWith('region_')) {
        const idx = parseInt(hitNode.split('_')[1], 10);
        if (!isNaN(idx) && idx >= 0 && idx < state.regions.length) {
          selectRegion(ctx, idx);
        }
      } else if (hitNode.startsWith('item_')) {
        const idx = parseInt(hitNode.split('_')[1], 10);
        if (!isNaN(idx) && idx >= 0 && idx < state.regions.length) {
          selectRegion(ctx, idx);
        }
      }
      break;
  }
}

// --- Region nudging ---

function nudgeRegion(ctx, key) {
  const r = state.regions[state.selectedRegion];
  const step = 1;

  switch (key) {
    case 'UP':    r.y -= step; break;
    case 'DOWN':  r.y += step; break;
    case 'LEFT':  r.x -= step; break;
    case 'RIGHT': r.x += step; break;
  }

  r.x = Math.max(0, r.x);
  r.y = Math.max(0, r.y);

  updateRegionNode(ctx, state.selectedRegion);
  updateDetailPanel(ctx);
  if (state.previewPlaying) updatePreview(ctx);
}

// --- Detail panel ---

function updateDetailPanel(ctx) {
  if (state.selectedRegion < 0 || state.selectedRegion >= state.regions.length) {
    ctx.scene.set('/sidebar/detail_panel/detail_name_btn',   'text', '');
    ctx.scene.set('/sidebar/detail_panel/detail_x_val',      'text', '-');
    ctx.scene.set('/sidebar/detail_panel/detail_y_val',      'text', '-');
    ctx.scene.set('/sidebar/detail_panel/detail_w_val',      'text', '-');
    ctx.scene.set('/sidebar/detail_panel/detail_h_val',      'text', '-');
    ctx.scene.set('/sidebar/detail_panel/detail_title',      'text', 'Frame');
    return;
  }

  const r = state.regions[state.selectedRegion];
  const sel = state.selectedRegion;
  ctx.scene.set('/sidebar/detail_panel/detail_name_btn', 'text', state.editingField === 'name' ? state.editBuffer + '|' : r.name);
  ctx.scene.set('/sidebar/detail_panel/detail_x_val',    'text', String(r.x));
  ctx.scene.set('/sidebar/detail_panel/detail_y_val',    'text', String(r.y));
  ctx.scene.set('/sidebar/detail_panel/detail_w_val',    'text', String(r.width));
  ctx.scene.set('/sidebar/detail_panel/detail_h_val',    'text', String(r.height));
  ctx.scene.set('/sidebar/detail_panel/detail_title',    'text', `Frame ${sel}`);
}

function updateRegionNode(ctx, index) {
  const r = state.regions[index];
  try {
    ctx.scene.set(`/viewport/regions/region_${index}`, 'x', r.x);
    ctx.scene.set(`/viewport/regions/region_${index}`, 'y', r.y);
    ctx.scene.set(`/viewport/regions/region_${index}`, 'width', r.width);
    ctx.scene.set(`/viewport/regions/region_${index}`, 'height', r.height);
  } catch { /* ignore */ }
}

// --- Init ---

function initEditor(ctx) {
  const texture = ctx.scene.get('/viewport/spritesheet', 'texture') || '';
  if (!texture) return;

  state.texturePath = texture;
  ctx.log(`Editor loaded: ${texture}`);

  const atlas = ctx.scene.get('/viewport/spritesheet', 'atlas') || '';
  if (atlas) {
    state.atlasPath = atlas;
    ctx.log(`Atlas: ${atlas}`);
  }

  const atlasDataStr = ctx.scene.get('/', 'atlas_data') || '';
  if (atlasDataStr) {
    try {
      const atlasData = JSON.parse(atlasDataStr);
      if (atlasData.regions && Array.isArray(atlasData.regions)) {
        for (const r of atlasData.regions) {
          state.regions.push({
            name: r.name,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          });
        }
        rebuildRegionNodes(ctx);
        if (state.regions.length > 0) {
          selectRegion(ctx, 0);
        }
        updateRegionList(ctx);
        ctx.log(`Loaded ${state.regions.length} regions from atlas`);
      }
    } catch (e) {
      ctx.log(`Failed to parse atlas data: ${e.message}`);
    }
  }
}

// --- Grid slice ---

function doGridSlice(ctx) {
  const imgW = ctx.scene.get('/viewport/spritesheet', 'width') || 256;
  const imgH = ctx.scene.get('/viewport/spritesheet', 'height') || 256;
  const cols = state.gridCols;
  const rows = state.gridRows;
  const cellW = Math.floor(imgW / cols);
  const cellH = Math.floor(imgH / rows);

  clearRegions(ctx);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const region = {
        name: `${state.gridPrefix}${r * cols + c}`,
        x: c * cellW,
        y: r * cellH,
        width: cellW,
        height: cellH,
      };
      state.regions.push(region);
      createRegionNode(ctx, state.regions.length - 1, region);
    }
  }

  selectRegion(ctx, 0);
  updateRegionList(ctx);
  ctx.log(`Grid slice: ${cols}x${rows} = ${state.regions.length} regions`);
}

// --- Region CRUD ---

function addRegion(ctx) {
  const region = {
    name: `frame_${state.regions.length}`,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
  };
  state.regions.push(region);
  createRegionNode(ctx, state.regions.length - 1, region);
  selectRegion(ctx, state.regions.length - 1);
  updateRegionList(ctx);
}

function removeRegion(ctx, index) {
  if (index < 0 || index >= state.regions.length) return;

  try {
    ctx.scene.destroy(`/viewport/regions/region_${index}`);
  } catch { /* ignore */ }

  state.regions.splice(index, 1);
  rebuildRegionNodes(ctx);
  updateRegionList(ctx);

  if (state.selectedRegion >= state.regions.length) {
    selectRegion(ctx, state.regions.length - 1);
  }
}

function selectRegion(ctx, index) {
  if (state.editingField) commitEdit(ctx);

  if (state.selectedRegion >= 0 && state.selectedRegion < state.regions.length) {
    try {
      const prevColor = regionColor(state.selectedRegion);
      ctx.scene.set(`/viewport/regions/region_${state.selectedRegion}`, 'border_color', prevColor);
      ctx.scene.set(`/viewport/regions/region_${state.selectedRegion}`, 'border_width', 2);
    } catch { /* ignore */ }
  }

  state.selectedRegion = index;

  if (index >= 0 && index < state.regions.length) {
    try {
      ctx.scene.set(`/viewport/regions/region_${index}`, 'border_color', '#ffff00');
      ctx.scene.set(`/viewport/regions/region_${index}`, 'border_width', 3);
    } catch { /* ignore */ }
    updatePreview(ctx);
    updateRegionList(ctx);
  }
  updateDetailPanel(ctx);
}

function createRegionNode(ctx, index, region) {
  const color = regionColor(index);
  ctx.scene.spawn('Panel', `region_${index}`, {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    color: 'transparent',
    border_color: color,
    border_width: 2,
    corner_radius: 0,
    clickable: true,
  }, '/viewport/regions');
}

function clearRegions(ctx) {
  for (let i = state.regions.length - 1; i >= 0; i--) {
    try {
      ctx.scene.destroy(`/viewport/regions/region_${i}`);
    } catch { /* ignore */ }
  }
  state.regions = [];
  state.selectedRegion = -1;
}

function rebuildRegionNodes(ctx) {
  for (let i = 0; i < 200; i++) {
    try {
      ctx.scene.destroy(`/viewport/regions/region_${i}`);
    } catch { break; }
  }
  for (let i = 0; i < state.regions.length; i++) {
    createRegionNode(ctx, i, state.regions[i]);
  }
}

// --- Region list ---

function updateRegionList(ctx) {
  for (let i = 0; i < 200; i++) {
    try {
      ctx.scene.destroy(`/sidebar/region_list/item_${i}`);
    } catch { break; }
  }

  for (let i = 0; i < state.regions.length; i++) {
    const region = state.regions[i];
    const isSelected = i === state.selectedRegion;
    ctx.scene.spawn('Button', `item_${i}`, {
      x: 0,
      y: i * REGION_LIST_ITEM_H,
      width: REGION_LIST_W - 4,
      height: 20,
      text: `${i}: ${region.name}`,
      color: isSelected ? '#4a4a6e' : '#2a2a3e',
      hover_color: '#3a3a5e',
      pressed_color: '#5a5a7e',
      text_color: isSelected ? '#ffff00' : '#cccccc',
      font_size: 11,
      corner_radius: 2,
      clickable: true,
      state: 'normal',
    }, '/sidebar/region_list');
  }
}

// --- Preview ---

function togglePreview(ctx) {
  state.previewPlaying = !state.previewPlaying;
  state.previewTimer = 0;
  state.previewFrame = 0;
  ctx.scene.set('/sidebar/buttons/preview_btn', 'text', state.previewPlaying ? 'Stop' : 'Preview');
  if (!state.previewPlaying) {
    ctx.scene.set('/preview_panel/preview_image', 'region_w', 0);
    ctx.scene.set('/preview_panel/preview_image', 'region_h', 0);
  }
}

function updatePreview(ctx) {
  if (state.previewFrame < 0 || state.previewFrame >= state.regions.length) return;
  const region = state.regions[state.previewFrame];
  const texture = ctx.scene.get('/viewport/spritesheet', 'texture') || '';

  ctx.scene.set('/preview_panel/preview_image', 'texture', texture);
  ctx.scene.set('/preview_panel/preview_image', 'region_x', region.x);
  ctx.scene.set('/preview_panel/preview_image', 'region_y', region.y);
  ctx.scene.set('/preview_panel/preview_image', 'region_w', region.width);
  ctx.scene.set('/preview_panel/preview_image', 'region_h', region.height);
  ctx.scene.set('/preview_panel/preview_label', 'text', `${region.name} (${state.previewFrame + 1}/${state.regions.length})`);
}

// --- Zoom ---

function updateZoomLabel(ctx) {
  const zoom = ctx.scene.get('/viewport', 'zoom') || 1;
  ctx.scene.set('/toolbar/zoom_label', 'text', `${Math.round(zoom * 100)}%`);
}

// --- Save ---

function saveAtlas(ctx) {
  if (state.regions.length === 0) {
    ctx.log('No regions to save');
    return;
  }

  const texture = ctx.scene.get('/viewport/spritesheet', 'texture') || '';
  const atlas = {
    texture: texture,
    regions: state.regions.map(r => ({
      name: r.name,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    })),
  };

  const path = state.atlasPath || 'spritesheet_atlas.json';
  ctx.emit('save_atlas', { path, atlas });
  ctx.log(`Atlas saved to ${path} (${atlas.regions.length} regions)`);
}
