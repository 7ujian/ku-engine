// Sprite Sheet Editor — runs as a JS script on the root node
// State is managed in the handlers closure

const state = {
  regions: [],
  selectedRegion: -1,
  texturePath: '',
  atlasPath: '',
  previewPlaying: false,
  previewFrame: 0,
  previewTimer: 0,
  previewSpeed: 8,
  dragState: null, // null | { type: 'pan'|'region'|'new', startX, startY, ... }
  gridCols: 4,
  gridRows: 4,
  gridPrefix: 'frame_',
};

const REGION_COLORS = [
  '#ff6b6b', '#51cf66', '#339af0', '#fcc419',
  '#cc5de8', '#ff922b', '#20c997', '#748ffc',
];

function regionColor(index) {
  return REGION_COLORS[index % REGION_COLORS.length];
}

const handlers = {
  on_touch_start(ctx) {
    const { x, y } = ctx.data;
    const cam = ctx.scene;

    // Convert screen coords to viewport-local coords
    // For now, use the raw coords
    if (state.dragState) return;

    state.dragState = {
      type: 'pan',
      startX: x,
      startY: y,
      scrollStartX: ctx.scene.get('/root/viewport', 'scroll_x') || 0,
      scrollStartY: ctx.scene.get('/root/viewport', 'scroll_y') || 0,
    };
  },

  on_touch_move(ctx) {
    if (!state.dragState) return;
    const { x, y } = ctx.data;

    if (state.dragState.type === 'pan') {
      const dx = x - state.dragState.startX;
      const dy = y - state.dragState.startY;
      ctx.scene.set('/root/viewport', 'scroll_x', state.dragState.scrollStartX - dx);
      ctx.scene.set('/root/viewport', 'scroll_y', state.dragState.scrollStartY - dy);
    }
  },

  on_touch_end(ctx) {
    state.dragState = null;
  },

  on_gui_click(ctx) {
    const nodeId = ctx.data.node;

    switch (nodeId) {
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
      default:
        // Check if it's a region overlay
        if (nodeId.startsWith('region_')) {
          const idx = parseInt(nodeId.replace('region_', ''), 10);
          selectRegion(ctx, idx);
        }
        break;
    }
  },

  on_key(ctx) {
    const key = ctx.data.key;
    const zoom = ctx.scene.get('/root/viewport', 'zoom') || 1;
    const scrollX = ctx.scene.get('/root/viewport', 'scroll_x') || 0;
    const scrollY = ctx.scene.get('/root/viewport', 'scroll_y') || 0;

    switch (key) {
      case 'PLUS':
      case '=':
        ctx.scene.set('/root/viewport', 'zoom', Math.min(zoom * 1.2, 10));
        updateZoomLabel(ctx);
        break;
      case '-':
        ctx.scene.set('/root/viewport', 'zoom', Math.max(zoom / 1.2, 0.1));
        updateZoomLabel(ctx);
        break;
      case 'UP':
        ctx.scene.set('/root/viewport', 'scroll_y', scrollY - 20);
        break;
      case 'DOWN':
        ctx.scene.set('/root/viewport', 'scroll_y', scrollY + 20);
        break;
      case 'LEFT':
        ctx.scene.set('/root/viewport', 'scroll_x', scrollX - 20);
        break;
      case 'RIGHT':
        ctx.scene.set('/root/viewport', 'scroll_x', scrollX + 20);
        break;
      case 'DELETE':
        if (state.selectedRegion >= 0 && state.selectedRegion < state.regions.length) {
          removeRegion(ctx, state.selectedRegion);
        }
        break;
      case 'SPACE':
        togglePreview(ctx);
        break;
    }
  },

  on_frame(ctx) {
    const dt = ctx.data.dt || 16;

    // Animation preview
    if (state.previewPlaying && state.regions.length > 0) {
      state.previewTimer += dt;
      const frameDuration = 1000 / state.previewSpeed;
      while (state.previewTimer >= frameDuration) {
        state.previewTimer -= frameDuration;
        state.previewFrame = (state.previewFrame + 1) % state.regions.length;
      }
      updatePreview(ctx);
    }

    // Update coords label with mouse position (if we had it)
    // For now, update zoom label
    updateZoomLabel(ctx);
  },
};

function doGridSlice(ctx) {
  const imgW = ctx.scene.get('/root/viewport/spritesheet', 'width') || 256;
  const imgH = ctx.scene.get('/root/viewport/spritesheet', 'height') || 256;
  const cols = state.gridCols;
  const rows = state.gridRows;
  const cellW = Math.floor(imgW / cols);
  const cellH = Math.floor(imgH / rows);

  // Clear existing regions
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

function addRegion(ctx) {
  const region = {
    name: `region_${state.regions.length}`,
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
  const region = state.regions[index];

  // Destroy overlay node
  try {
    ctx.scene.destroy(`/root/viewport/regions/region_${index}`);
  } catch { /* ignore */ }

  state.regions.splice(index, 1);

  // Rebuild overlay nodes to fix indices
  rebuildRegionNodes(ctx);
  updateRegionList(ctx);

  if (state.selectedRegion >= state.regions.length) {
    selectRegion(ctx, state.regions.length - 1);
  }
}

function selectRegion(ctx, index) {
  // Deselect previous
  if (state.selectedRegion >= 0 && state.selectedRegion < state.regions.length) {
    try {
      const prevColor = regionColor(state.selectedRegion);
      ctx.scene.set(`/root/viewport/regions/region_${state.selectedRegion}`, 'border_color', prevColor);
      ctx.scene.set(`/root/viewport/regions/region_${state.selectedRegion}`, 'border_width', 2);
    } catch { /* ignore */ }
  }

  state.selectedRegion = index;

  // Highlight selected
  if (index >= 0 && index < state.regions.length) {
    try {
      ctx.scene.set(`/root/viewport/regions/region_${index}`, 'border_color', '#ffff00');
      ctx.scene.set(`/root/viewport/regions/region_${index}`, 'border_width', 3);
    } catch { /* ignore */ }
    updatePreview(ctx);
  }
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
  }, '/root/viewport/regions');
}

function clearRegions(ctx) {
  // Destroy all region nodes
  for (let i = state.regions.length - 1; i >= 0; i--) {
    try {
      ctx.scene.destroy(`/root/viewport/regions/region_${i}`);
    } catch { /* ignore */ }
  }
  state.regions = [];
  state.selectedRegion = -1;
}

function rebuildRegionNodes(ctx) {
  // Destroy all and recreate
  for (let i = 0; i < 100; i++) {
    try {
      ctx.scene.destroy(`/root/viewport/regions/region_${i}`);
    } catch { break; }
  }
  for (let i = 0; i < state.regions.length; i++) {
    createRegionNode(ctx, i, state.regions[i]);
  }
}

function updateRegionList(ctx) {
  // Destroy existing list items
  for (let i = 0; i < 100; i++) {
    try {
      ctx.scene.destroy(`/root/sidebar/region_list/item_${i}`);
    } catch { break; }
  }

  // Create list items
  for (let i = 0; i < state.regions.length; i++) {
    const region = state.regions[i];
    const isSelected = i === state.selectedRegion;
    ctx.scene.spawn('Button', `item_${i}`, {
      x: 0,
      y: i * 24,
      width: 148,
      height: 22,
      text: region.name,
      color: isSelected ? '#4a4a6e' : '#2a2a3e',
      hover_color: '#3a3a5e',
      pressed_color: '#5a5a7e',
      text_color: isSelected ? '#ffff00' : '#cccccc',
      font_size: 11,
      corner_radius: 2,
      clickable: true,
      state: 'normal',
    }, '/root/sidebar/region_list');
  }
}

function togglePreview(ctx) {
  state.previewPlaying = !state.previewPlaying;
  state.previewTimer = 0;
  state.previewFrame = 0;
  ctx.scene.set('/root/preview_btn', 'text', state.previewPlaying ? 'Stop' : 'Preview');
  if (!state.previewPlaying) {
    ctx.scene.set('/root/preview_image', 'region_w', 0);
    ctx.scene.set('/root/preview_image', 'region_h', 0);
  }
}

function updatePreview(ctx) {
  if (state.previewFrame < 0 || state.previewFrame >= state.regions.length) return;
  const region = state.regions[state.previewFrame];
  const texture = ctx.scene.get('/root/viewport/spritesheet', 'texture') || '';

  ctx.scene.set('/root/preview_image', 'texture', texture);
  ctx.scene.set('/root/preview_image', 'region_x', region.x);
  ctx.scene.set('/root/preview_image', 'region_y', region.y);
  ctx.scene.set('/root/preview_image', 'region_w', region.width);
  ctx.scene.set('/root/preview_image', 'region_h', region.height);
  ctx.scene.set('/root/preview_label', 'text', `${region.name} (${state.previewFrame + 1}/${state.regions.length})`);
}

function updateZoomLabel(ctx) {
  const zoom = ctx.scene.get('/root/viewport', 'zoom') || 1;
  ctx.scene.set('/root/zoom_label', 'text', `${Math.round(zoom * 100)}%`);
}

function saveAtlas(ctx) {
  if (state.regions.length === 0) {
    ctx.log('No regions to save');
    return;
  }

  const texture = ctx.scene.get('/root/viewport/spritesheet', 'texture') || '';
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

  // Use emit to trigger the plugin's message handler for file I/O
  const path = state.atlasPath || 'spritesheet_atlas.json';
  ctx.emit('save_atlas', { path, atlas });
  ctx.log(`Atlas saved to ${path} (${atlas.regions.length} regions)`);
}
