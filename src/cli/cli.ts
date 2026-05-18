import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { editCommand, stopCommand, attachCommand, detachCommand } from './commands/edit.js';
import { playCommand } from './commands/play.js';
import { listInstances } from './commands/instances.js';
import { sceneCreate, sceneList, sceneLoad, sceneTree, sceneSave } from './commands/scene.js';
import { nodeAdd, nodeRm, nodeSet, nodeGet, nodeList, nodeMove } from './commands/node.js';
import { inputKey, inputClick, inputAxis } from './commands/input.js';
import { pauseCommand, resumeCommand, stepCommand } from './commands/runtime.js';
import { queryScene, queryNodes, queryDiff, queryCollisions } from './commands/query.js';
import { buildCommand } from './commands/build.js';

function getProjectDir(): string {
  return process.cwd();
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('ku')
    .description('CLI-based 2D game engine for AI agents')
    .version('0.1.0');

  // Project init
  program
    .command('init <name>')
    .option('--dir <path>', 'Target directory (default: <name>)')
    .description('Create a new ku project')
    .action(async (name: string, opts: { dir?: string }) => {
      await initCommand(name, opts.dir);
    });

  // Instance management
  program
    .command('edit [scene]')
    .description('Start editor instance')
    .action(async (scene?: string) => {
      await editCommand(getProjectDir(), scene);
    });

  program
    .command('stop [instance]')
    .description('Stop an instance (default: play)')
    .action(async (instance?: string) => {
      await stopCommand(getProjectDir(), instance);
    });

  program
    .command('attach <instance>')
    .description('Attach CLI to an instance (edit|play)')
    .action(async (instance: string) => {
      await attachCommand(getProjectDir(), instance as 'edit' | 'play');
    });

  program
    .command('detach')
    .description('Detach CLI from current instance')
    .action(async () => {
      await detachCommand(getProjectDir());
    });

  program
    .command('instances')
    .description('List running instances')
    .action(async () => {
      await listInstances(getProjectDir());
    });

  program
    .command('play')
    .option('--hot-reload', 'Subscribe to editor changes while running')
    .description('Spawn play instance from editor snapshot')
    .action(async (opts: { hotReload?: boolean }) => {
      await playCommand(getProjectDir(), opts.hotReload ?? false);
    });

  // Build
  program
    .command('build')
    .option('--output <dir>', 'Output directory', 'build')
    .description('Package project for distribution')
    .action(async (opts: { output: string }) => {
      await buildCommand(getProjectDir(), opts.output);
    });

  // Scene
  const scene = program.command('scene').description('Scene management');

  scene
    .command('create <name>')
    .description('Create empty scene file')
    .action(async (name: string) => {
      await sceneCreate(getProjectDir(), name);
    });

  scene
    .command('list')
    .description('List all scenes')
    .action(async () => {
      await sceneList(getProjectDir());
    });

  scene
    .command('load <name>')
    .description('Load scene into editor')
    .action(async (name: string) => {
      await sceneLoad(getProjectDir(), name);
    });

  scene
    .command('tree')
    .description('Print current node tree')
    .action(async () => {
      await sceneTree(getProjectDir());
    });

  scene
    .command('save [name]')
    .description('Save editor state to file')
    .action(async (name?: string) => {
      await sceneSave(getProjectDir(), name);
    });

  // Node
  const node = program.command('node').description('Node operations');

  node
    .command('add <path> <type> <id>')
    .option('--props <json>', 'Node properties as JSON', '{}')
    .description('Add child node')
    .action(async (path: string, type: string, id: string, opts: { props: string }) => {
      await nodeAdd(getProjectDir(), path, type, id, opts.props);
    });

  node
    .command('rm <path>')
    .description('Remove node')
    .action(async (path: string) => {
      await nodeRm(getProjectDir(), path);
    });

  node
    .command('set <path.property> <value>')
    .description('Set property')
    .action(async (pathProp: string, value: string) => {
      await nodeSet(getProjectDir(), pathProp, value);
    });

  node
    .command('get <path.property>')
    .description('Get property or full node')
    .action(async (pathProp: string) => {
      await nodeGet(getProjectDir(), pathProp);
    });

  node
    .command('list <path>')
    .description('List children')
    .action(async (path: string) => {
      await nodeList(getProjectDir(), path);
    });

  node
    .command('move <path> <newParent>')
    .description('Reparent node')
    .action(async (path: string, newParent: string) => {
      await nodeMove(getProjectDir(), path, newParent);
    });

  // Runtime control
  program
    .command('pause')
    .description('Pause game loop')
    .action(async () => {
      await pauseCommand(getProjectDir());
    });

  program
    .command('resume')
    .description('Resume game loop')
    .action(async () => {
      await resumeCommand(getProjectDir());
    });

  program
    .command('step')
    .description('Advance one frame (when paused)')
    .action(async () => {
      await stepCommand(getProjectDir());
    });

  // Input (play instance)
  const input = program.command('input').description('AI player input');

  input
    .command('key <key> [direction]')
    .description('Simulate key event (down|up)')
    .action(async (key: string, direction?: string) => {
      await inputKey(getProjectDir(), key, direction);
    });

  input
    .command('click <x> <y>')
    .description('Simulate click')
    .action(async (x: string, y: string) => {
      await inputClick(getProjectDir(), parseFloat(x), parseFloat(y));
    });

  input
    .command('axis <name> <value>')
    .description('Set axis value (-1 to 1)')
    .action(async (name: string, value: string) => {
      await inputAxis(getProjectDir(), name, parseFloat(value));
    });

  // Query
  const query = program.command('query').description('Query game state');

  query
    .command('scene')
    .description('Full scene state as JSON')
    .action(async () => {
      await queryScene(getProjectDir());
    });

  query
    .command('nodes [type]')
    .description('List nodes, optionally filtered by type')
    .action(async (type?: string) => {
      await queryNodes(getProjectDir(), type);
    });

  query
    .command('diff')
    .description('Frame-over-frame property deltas')
    .action(async () => {
      await queryDiff(getProjectDir());
    });

  query
    .command('collisions')
    .description('Active collision pairs')
    .action(async () => {
      await queryCollisions(getProjectDir());
    });

  return program;
}
