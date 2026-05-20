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
  children: NodeData[];
  scripts: ScriptRule[];
  instance?: string;
  js_script?: string;
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
