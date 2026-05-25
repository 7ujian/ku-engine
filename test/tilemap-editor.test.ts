import { describe, it, expect } from 'vitest';

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
      for (let i = 0; i < 25; i++) layer.data[i] = 1;
      floodFill(layer, 2, 2, 2);
      expect(layer.data.every(v => v === 2)).toBe(true);
    });

    it('does not cross boundaries with different values', () => {
      const layer = createLayer('test', 5, 5);
      for (let i = 0; i < 25; i++) layer.data[i] = 1;
      setTile(layer, 1, 0, 3);
      setTile(layer, 1, 1, 3);
      setTile(layer, 1, 2, 3);
      setTile(layer, 1, 3, 3);
      setTile(layer, 1, 4, 3);
      floodFill(layer, 0, 0, 2);
      expect(getTile(layer, 0, 0)).toBe(2);
      expect(getTile(layer, 2, 0)).toBe(1);
      expect(getTile(layer, 1, 2)).toBe(3);
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
      for (let r = 2; r <= 4; r++) {
        for (let c = 2; c <= 5; c++) {
          expect(getTile(layer, c, r)).toBe(7);
        }
      }
      expect(getTile(layer, 1, 2)).toBe(0);
      expect(getTile(layer, 6, 2)).toBe(0);
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

describe('autotile resolution', () => {
  const BITMASK_TO_SUFFIX = [
    'top_left', 'center_left', 'center_right', 'center',
    'bottom_mid', 'bottom_left', 'bottom_right', 'bottom_mid',
    'top_mid', 'top_left', 'top_right', 'top_mid',
    'center', 'center_left', 'center_right', 'center',
  ];

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
    return {
      color: '#ffffff',
      borders: { top: !up, bottom: !down, left: !left, right: !right },
      suffix: BITMASK_TO_SUFFIX[mask],
    };
  }

  it('resolves isolated cell with border on all sides', () => {
    const layer = createLayer('test', 5, 5);
    setTile(layer, 2, 2, 1);
    layer.autotile = true;
    layer.terrain_map = { '1': { atlas: 'water.json', mode: '3x3', prefix: 'water' } };
    const result = resolveAutotileCellTest(layer, 2, 2);
    expect(result!.borders.top).toBe(true);
    expect(result!.borders.bottom).toBe(true);
    expect(result!.borders.left).toBe(true);
    expect(result!.borders.right).toBe(true);
    expect(result!.suffix).toBe('top_left');
  });

  it('resolves fully surrounded cell with no borders', () => {
    const layer = createLayer('test', 3, 3);
    for (let i = 0; i < 9; i++) layer.data[i] = 1;
    layer.autotile = true;
    layer.terrain_map = { '1': { atlas: 'water.json', mode: '3x3', prefix: 'water' } };
    const result = resolveAutotileCellTest(layer, 1, 1);
    expect(result!.borders.top).toBe(false);
    expect(result!.borders.bottom).toBe(false);
    expect(result!.borders.left).toBe(false);
    expect(result!.borders.right).toBe(false);
    expect(result!.suffix).toBe('center');
  });

  it('skips resolution for fill mode', () => {
    const layer = createLayer('test', 3, 3);
    setTile(layer, 1, 1, 1);
    layer.autotile = true;
    layer.terrain_map = { '1': { atlas: 'grass.json', mode: 'fill', prefix: 'grass_fill' } };
    const result = resolveAutotileCellTest(layer, 1, 1);
    expect(result).not.toBeNull();
    expect(result!.suffix).toBe('');
  });
});

describe('multi-layer export/import roundtrip', () => {
  it('roundtrips multi-layer tilemap data', () => {
    const layers = [
      createLayer('ground', 4, 3),
      createLayer('trees', 4, 3),
    ];
    setTile(layers[0], 0, 0, 1);
    setTile(layers[0], 1, 0, 1);
    setTile(layers[1], 2, 1, 3);
    layers[1].autotile = true;
    layers[1].terrain_map = { '3': { atlas: 'tree.json', mode: 'fill' } };

    const exported = exportTilemap(layers, 16);
    const imported = importTilemap(exported);

    expect(imported).toHaveLength(2);
    expect(imported[0].name).toBe('ground');
    expect(getTile(imported[0], 0, 0)).toBe(1);
    expect(imported[1].name).toBe('trees');
    expect(getTile(imported[1], 2, 1)).toBe(3);
    expect(imported[1].autotile).toBe(true);
    expect(imported[1].terrain_map['3']).toEqual({ atlas: 'tree.json', mode: 'fill' });
  });
});

describe('full editor workflow', () => {
  it('paints with tile brush, then erases', () => {
    const layer = createLayer('test', 5, 5);
    setTile(layer, 2, 2, 3);
    expect(getTile(layer, 2, 2)).toBe(3);
    setTile(layer, 2, 2, 0);
    expect(getTile(layer, 2, 2)).toBe(0);
  });

  it('fills region, then flood fills', () => {
    const layer = createLayer('test', 6, 6);
    for (let c = 1; c <= 4; c++) { setTile(layer, c, 1, 1); setTile(layer, c, 4, 1); }
    for (let r = 1; r <= 4; r++) { setTile(layer, 1, r, 1); setTile(layer, 4, r, 1); }
    floodFill(layer, 2, 2, 2);
    expect(getTile(layer, 2, 2)).toBe(2);
    expect(getTile(layer, 3, 3)).toBe(2);
    expect(getTile(layer, 1, 1)).toBe(1);
    expect(getTile(layer, 0, 0)).toBe(0);
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