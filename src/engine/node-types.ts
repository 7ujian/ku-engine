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

export const createLabel = factory('Label', {
  text: '',
  font_size: 16,
  color: '#ffffff',
  align: 'left',
  valign: 'top',
  max_width: 0,
  font: 'monospace',
});

export const createPanel = factory('Panel', {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  color: '#1a1a2e',
  border_color: '#ffffff',
  border_width: 0,
  corner_radius: 0,
  visible: true,
});

export const createButton = factory('Button', {
  x: 0,
  y: 0,
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
  visible: true,
});

export const createImageRect = factory('ImageRect', {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  texture: '',
  region_x: 0,
  region_y: 0,
  region_w: 0,
  region_h: 0,
  preserve_aspect: true,
  visible: true,
});

export const createScrollView = factory('ScrollView', {
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  scroll_x: 0,
  scroll_y: 0,
  zoom: 1,
  clip: true,
  visible: true,
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
};

export function createNodeByType(type: string, id: string, overrides?: Partial<PropertyMap>): Node {
  const pluginFactory = pluginRegistry.getNodeTypeFactory(type);
  if (pluginFactory) return pluginFactory(id, overrides);
  const fn = factories[type];
  if (!fn) throw new Error(`unknown node type: ${type}`);
  return fn(id, overrides);
}

export { factories };
