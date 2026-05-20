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
});

export const createTileMap = factory('TileMap', {
  tileset: '',
  cell_size: 16,
  columns: 0,
  rows: 0,
  data: '',
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
};

export function createNodeByType(type: string, id: string, overrides?: Partial<PropertyMap>): Node {
  const pluginFactory = pluginRegistry.getNodeTypeFactory(type);
  if (pluginFactory) return pluginFactory(id, overrides);
  const fn = factories[type];
  if (!fn) throw new Error(`unknown node type: ${type}`);
  return fn(id, overrides);
}

export { factories };
