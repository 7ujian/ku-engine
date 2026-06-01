import type { PropertyMap } from './types.js';
import { Node } from './node.js';
import { pluginRegistry } from './plugin-registry.js';

type NodeFactory = (id: string, overrides?: Partial<PropertyMap>) => Node;

function factory(type: string, defaults: PropertyMap): NodeFactory {
  return (id: string, overrides?: Partial<PropertyMap>) => {
    const props: PropertyMap = { ...defaults };
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined) props[k] = v as PropertyMap[string];
      }
    }
    return new Node(id, type, props);
  };
}

/** Base Control properties shared by all UI widget types */
const CONTROL_BASE: PropertyMap = {
  anchor_left: 0,
  anchor_right: 0,
  anchor_top: 0,
  anchor_bottom: 0,
  margin_left: 0,
  margin_right: 0,
  margin_top: 0,
  margin_bottom: 0,
  grow_horizontal: 'end',
  grow_vertical: 'end',
  size_flags_horizontal: 'fill',
  size_flags_vertical: 'fill',
  min_size: { width: 0, height: 0 },
  focus_mode: 'none',
  focus_next: '',
  focus_previous: '',
  visible: true,
  modal: false,
};

/** Create a factory with Control base properties merged in */
function controlFactory(type: string, widgetDefaults: PropertyMap): NodeFactory {
  return factory(type, { ...CONTROL_BASE, ...widgetDefaults });
}

export const createNode = factory('Node', {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: 1,
});

export const createNode2D = factory('Node2D', {
  x: 0,
  y: 0,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
  visible: true,
  y_sort_enabled: false,
  pixel_perfect_enabled: false,
});

export const createSprite = factory('Sprite', {
  texture: '',
  flip_h: false,
  flip_v: false,
  frame: 0,
  hframes: 1,
  atlas: '',
  region: '',
});

export const createAnimatedSprite = factory('AnimatedSprite', {
  frames: [],
  speed: 10,
  playing: false,
  atlas: '',
  animations: {},
  animation: '',
});

export const createRigidBody = factory('RigidBody', {
  mass: 1,
  velocity: { x: 0, y: 0 },
  gravity_scale: 1,
  linear_damping: 0,
  width: 32,
  height: 32,
  color: '#ffff00',
});

export const createArea = factory('Area', {
  monitorable: true,
});

export const createCollisionShape = factory('CollisionShape', {
  shape: 'rect',
  width: 32,
  height: 32,
  radius: 0,
  points: [],
  color: '#33cc33',
});

export const createCamera2D = factory('Camera2D', {
  zoom: 1,
  offset_x: 0,
  offset_y: 0,
  smoothing: 0,
});

export const createLabel = controlFactory('Label', {
  text: '',
  font_size: 16,
  color: '#ffffff',
  align: 'left',
  valign: 'top',
  max_width: 0,
  font: 'monospace',
  autowrap: false,
});

export const createPanel = controlFactory('Panel', {
  width: 100,
  height: 100,
  color: '#1a1a2e',
  border_color: '#ffffff',
  border_width: 0,
  corner_radius: 0,
});

export const createButton = controlFactory('Button', {
  width: 120,
  height: 40,
  text: '',
  color: '#3a3a5e',
  hover_color: '#4a4a6e',
  pressed_color: '#2a2a4e',
  text_color: '#ffffff',
  font_size: 14,
  corner_radius: 4,
  state: 'normal',
  clickable: true,
  focus_mode: 'click',
  disabled: false,
  toggle_mode: false,
  pressed: false,
  action: '',
});

export const createImageRect = controlFactory('ImageRect', {
  width: 100,
  height: 100,
  texture: '',
  region_x: 0,
  region_y: 0,
  region_w: 0,
  region_h: 0,
  preserve_aspect: true,
});

export const createScrollView = controlFactory('ScrollView', {
  width: 400,
  height: 300,
  scroll_x: 0,
  scroll_y: 0,
  zoom: 1,
  clip: true,
  clip_content: true,
});

export const createTileMap = factory('TileMap', {
  x: 0,
  y: 0,
  tileset: '',
  cell_size: 16,
  columns: 0,
  rows: 0,
  data: '',
  terrain_map: {},
  tiled_map: '',
  tile_collisions_enabled: false,
});

export const createTimer = factory('Timer', {
  wait_time: 1,
  one_shot: false,
  autostart: false,
});

export const createAudioPlayer = factory('AudioPlayer', {
  stream: '',
  volume: 1,
  playing: false,
});

export const createAnimationPlayer = factory('AnimationPlayer', {
  target: '',
  animations: {},
  current: '',
  playing: false,
  speed: 1,
  loop: false,
});

export const createBlock = factory('Block', {
  width: 32,
  height: 32,
  color: '#ffffff',
  visible: true,
});

export const createProfiler = factory('Profiler', {
  enabled: false,
  interval_ms: 5000,
  samples: [] as unknown[],
  body_count: 0,
  node_count: 0,
});

export const createProfilerGui = factory('ProfilerGui', {
  visible: false,
  target: '/profiler',
  x: 8,
  y: 8,
  width: 300,
  height: 200,
});

export const createControl = factory('Control', { ...CONTROL_BASE });

export const createCanvasLayer = factory('CanvasLayer', {
  layer: 0,
  follow_viewport: true,
  offset_x: 0,
  offset_y: 0,
  scale: 1,
  visible: true,
});

export const createVBoxContainer = controlFactory('VBoxContainer', {
  separation: 4,
  width: 200,
  height: 200,
});

export const createHBoxContainer = controlFactory('HBoxContainer', {
  separation: 4,
  width: 200,
  height: 200,
});

export const createMarginContainer = controlFactory('MarginContainer', {
  padding_left: 0,
  padding_right: 0,
  padding_top: 0,
  padding_bottom: 0,
  width: 200,
  height: 200,
});

export const createCenterContainer = controlFactory('CenterContainer', {
  width: 200,
  height: 200,
});

export const createSlider = controlFactory('Slider', {
  width: 200,
  height: 20,
  min_value: 0,
  max_value: 100,
  value: 0,
  step: 1,
  orientation: 'horizontal',
  direction: 'left_to_right',
  track_color: '#3a3a5e',
  fill_color: '#6a6aff',
  handle_color: '#ffffff',
  handle_size: 12,
  clickable: true,
  focus_mode: 'click',
});

export const createToggle = controlFactory('Toggle', {
  width: 24,
  height: 24,
  pressed: false,
  group: '',
  on_color: '#6a6aff',
  off_color: '#3a3a5e',
  label: '',
  clickable: true,
  focus_mode: 'click',
});

export const createTheme = factory('Theme', {
  colors: {
    bg_color: '#1a1a2e',
    fg_color: '#ffffff',
    accent_color: '#6a6aff',
    error_color: '#ff4444',
    disabled_color: '#666666',
    border_color: '#555555',
  },
  font_size: {
    normal: 14,
    small: 12,
    large: 18,
    title: 24,
  },
  constants: {
    margin: 8,
    spacing: 4,
    corner_radius: 4,
    border_width: 1,
  },
});

const factories: Record<string, NodeFactory> = {
  Node: createNode,
  Node2D: createNode2D,
  Sprite: createSprite,
  AnimatedSprite: createAnimatedSprite,
  RigidBody: createRigidBody,
  Area: createArea,
  CollisionShape: createCollisionShape,
  Camera2D: createCamera2D,
  Label: createLabel,
  TileMap: createTileMap,
  Timer: createTimer,
  AudioPlayer: createAudioPlayer,
  AnimationPlayer: createAnimationPlayer,
  Block: createBlock,
  Panel: createPanel,
  Button: createButton,
  ImageRect: createImageRect,
  ScrollView: createScrollView,
  Profiler: createProfiler,
  ProfilerGui: createProfilerGui,
  Control: createControl,
  CanvasLayer: createCanvasLayer,
  VBoxContainer: createVBoxContainer,
  HBoxContainer: createHBoxContainer,
  MarginContainer: createMarginContainer,
  CenterContainer: createCenterContainer,
  Slider: createSlider,
  Toggle: createToggle,
  Theme: createTheme,
};

export function createNodeByType(type: string, id: string, overrides?: Partial<PropertyMap>): Node {
  const pluginFactory = pluginRegistry.getNodeTypeFactory(type);
  if (pluginFactory) return pluginFactory(id, overrides);
  const fn = factories[type];
  if (!fn) throw new Error(`unknown node type: ${type}`);
  return fn(id, overrides);
}

export { factories };
