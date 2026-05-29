export interface PropertyMap {
  [key: string]: string | number | boolean | null | PropertyMap | unknown[];
}

export interface ScriptFilter {
  [key: string]: unknown;
}

export interface ScriptAction {
  set?: string;
  to?: unknown;
  set_on?: string;
  key?: string;
  move?: { x?: number; y?: number };
  spawn?: string;
  at?: { x?: number; y?: number };
  as?: string;
  properties?: PropertyMap;
  scripts?: ScriptRule[];
  destroy?: string;
  emit?: string;
  data?: Record<string, unknown>;
  play?: string;
  from?: number;
  stop?: string;
  log?: string;
  call?: string;
  move_toward?: { x?: number; y?: number; speed?: number };
  change_scene?: string;
  animate?: string;
  on?: string;
  animate_speed?: number;
  animate_stop?: string;
}

export interface ScriptRule {
  event: string;
  name?: string;
  filter?: ScriptFilter;
  condition?: Record<string, Record<string, unknown>>;
  actions: ScriptAction[];
}

export interface NodeData {
  id: string;
  type: string;
  properties: PropertyMap;
  children?: NodeData[];
  scripts: ScriptRule[];
  instance?: string;
  js_script?: string;
  _oid?: number;
}

export interface SceneFile {
  scene: string;
  root: NodeData;
}

export interface ScriptError {
  node: string;
  event: string;
  action_type: string;
  reason: string;
  timestamp: number;
}

export interface TilesetTileDef {
  name: string;
  atlas?: string;
  region?: string;
  prefix?: string;
  texture?: string;
  regions?: TilesetRegion[];
  mode?: 'static' | '3x3' | 'fill';
  surround?: number;
  compatible?: number[];
  masks?: Record<number, string>;
}

export interface TilesetTransitionDef {
  atlas?: string;
  prefix?: string;
  texture?: string;
  regions?: TilesetRegion[];
  mode: '3x3' | 'fill';
}

export interface TilesetRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TilesetDef {
  cell_size: number;
  tiles: TilesetTileDef[];
  transitions?: Record<string, TilesetTransitionDef>;
}

/** A collision shape extracted from a Tiled tile's objectgroup */
export interface TileCollisionShape {
  type: 'rect' | 'polygon' | 'ellipse';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
}

/** Maps tile local IDs to their collision shapes */
export type TileCollisionMap = Record<number, TileCollisionShape[]>;

/** A merged collision shape in world space */
export interface MergedCollision {
  type: 'rect' | 'polygon' | 'circle';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: Array<{ x: number; y: number }>;
}

/** Tiled spritesheet layer data stored on TileMap nodes */
export interface TiledLayerData {
  image: string;
  columns: number;
  tilewidth: number;
  tileheight: number;
  firstgid: number;
  data: number[];
  width: number;
  height: number;
  opacity?: number;
  name?: string;
  /** Per-tile image overrides for image collection tilesets (localID → image info) */
  tile_images?: Record<number, { image: string; w: number; h: number }>;
  /** Tile collision shapes extracted from tileset objectgroups (local tile ID → shapes) */
  tile_collisions?: TileCollisionMap;
}
