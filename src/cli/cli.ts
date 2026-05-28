import { Command } from 'commander';
import { resolve } from 'node:path';
import { initCommand } from './commands/init.js';
import { editCommand, stopCommand, attachCommand, detachCommand } from './commands/edit.js';
import { playCommand, runCommand } from './commands/play.js';
import { listInstances } from './commands/instances.js';
import { sceneCreate, sceneList, sceneLoad, sceneTree, sceneSave, sceneRm } from './commands/scene.js';
import { nodeAdd, nodeNew, nodeInstance, nodeDuplicate, nodeSave, nodeRm, nodeSet, nodeGet, nodeList, nodeMove } from './commands/node.js';
import { inputKey, inputClick, inputAxis } from './commands/input.js';
import { pauseCommand, resumeCommand, stepCommand } from './commands/runtime.js';
import { queryScene, queryNodes, queryDiff, queryCollisions, queryLogs, queryNode, queryProfile } from './commands/query.js';
import { buildCommand } from './commands/build.js';
import { shellCommand } from './commands/shell.js';
import { pluginInstallCommand, pluginRemoveCommand, pluginListCommand, pluginCreateCommand, pluginInfoCommand, pluginCheckCommand, pluginDisableCommand, pluginEnableCommand } from './commands/plugin.js';
import { importTiledCommand } from './commands/import-tiled.js';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('ku')
    .description('CLI-based 2D game engine for AI agents')
    .version('0.1.0')
    .option('-p, --project <dir>', 'Project root directory');

  function getProjectDir(): string {
    const opts = program.opts();
    return opts.project ? resolve(opts.project) : process.cwd();
  }

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
    .option('-i, --interactive', 'Start interactive shell after launch')
    .option('--autosave', 'Auto-save scene to disk on changes (2s debounce)')
    .description('Start editor instance')
    .action(async (scene?: string, opts?: { interactive?: boolean; autosave?: boolean }) => {
      await editCommand(getProjectDir(), scene, opts?.interactive ?? false, opts?.autosave ?? false);
    });

  program
    .command('stop [instance]')
    .description('Stop an instance (default: play)')
    .action(async (instance?: string) => {
      await stopCommand(getProjectDir(), instance);
    });

  program
    .command('attach <instance>')
    .description('Attach CLI to an instance (edit|playN)')
    .action(async (instance: string) => {
      await attachCommand(getProjectDir(), instance);
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
    .command('play [scene]')
    .option('-i, --interactive', 'Start interactive shell after launch')
    .option('--name <name>', 'Instance name (default: auto-assign play1, play2...)')
    .option('--watch', 'Auto-reload scene when files change')
    .description('Start play instance (loads scene, or entry scene if none specified)')
    .action(async (scene?: string, opts?: { interactive?: boolean; name?: string; watch?: boolean }) => {
      await playCommand(getProjectDir(), { interactive: opts?.interactive ?? false, scene, name: opts?.name, watch: opts?.watch });
    });

  program
    .command('run')
    .option('-i, --interactive', 'Start interactive shell after launch')
    .description('Build project and run the standalone player')
    .action(async (opts: { interactive?: boolean }) => {
      await runCommand(getProjectDir(), opts.interactive ?? false);
    });

  // Build
  program
    .command('build')
    .option('--output <dir>', 'Output directory', 'build')
    .description('Package project for distribution')
    .action(async (opts: { output: string }) => {
      await buildCommand(getProjectDir(), opts.output);
    });

  // Import Tiled map
  program
    .command('import-tiled <file>')
    .option('--name <scene-name>', 'Output scene name')
    .description('Import a Tiled map editor JSON file as a ku scene')
    .action(async (file: string, opts: { name?: string }) => {
      await importTiledCommand(getProjectDir(), file, opts.name);
    });

  // Interactive shell
  program
    .command('shell')
    .option('--command <cmd>', 'Execute a single command and exit')
    .description('Start interactive shell')
    .action(async (opts: { command?: string }) => {
      await shellCommand(getProjectDir(), opts);
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

  scene
    .command('rm <name>')
    .description('Delete a scene file')
    .action(async (name: string) => {
      await sceneRm(getProjectDir(), name);
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
    .command('new <type> [path] [id]')
    .description('Create node from type (defaults: path=/, id=auto)')
    .action(async (type: string, path: string | undefined, id: string | undefined) => {
      await nodeNew(getProjectDir(), type, path, id);
    });

  node
    .command('instance <scene> [path] [id]')
    .description('Instance a scene as a node (defaults: path=/, id=from filename)')
    .action(async (scene: string, path: string | undefined, id: string | undefined) => {
      await nodeInstance(getProjectDir(), scene, path, id);
    });

  node
    .command('duplicate <path> [parent] [new-id]')
    .description('Clone a sub-tree as a new node (defaults: parent=same, new-id=name_copy)')
    .action(async (path: string, parent: string | undefined, newId: string | undefined) => {
      await nodeDuplicate(getProjectDir(), path, parent, newId);
    });

  node
    .command('save <path> [scene-name]')
    .description('Save a sub-tree as a scene file (defaults: scene-name=node id)')
    .action(async (path: string, sceneName: string | undefined) => {
      await nodeSave(getProjectDir(), path, sceneName);
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

  query
    .command('logs')
    .option('--clear', 'Clear logs after reading')
    .description('Script engine log output')
    .action(async (opts: { clear?: boolean }) => {
      await queryLogs(getProjectDir(), opts.clear ?? false);
    });

  query
    .command('node <path>')
    .description('Show node properties and children')
    .action(async (path: string) => {
      await queryNode(getProjectDir(), path);
    });

  query
    .command('profile')
    .description('Profiler data (bodies, nodes, subsystem timing)')
    .action(async () => {
      await queryProfile(getProjectDir());
    });

  // Plugin management
  const plugin = program.command('plugin').description('Plugin management');

  plugin
    .command('install <package>')
    .description('Install a plugin from npm')
    .action(async (pkg: string) => {
      await pluginInstallCommand(getProjectDir(), pkg);
    });

  plugin
    .command('remove <name>')
    .description('Remove a plugin')
    .action(async (name: string) => {
      await pluginRemoveCommand(getProjectDir(), name);
    });

  plugin
    .command('list')
    .description('List installed plugins')
    .action(async () => {
      await pluginListCommand(getProjectDir());
    });

  plugin
    .command('create <name>')
    .description('Create a new plugin with boilerplate')
    .action(async (name: string) => {
      await pluginCreateCommand(getProjectDir(), name);
    });

  plugin
    .command('info <name>')
    .description('Show detailed plugin info')
    .action(async (name: string) => {
      await pluginInfoCommand(getProjectDir(), name);
    });

  plugin
    .command('check <path>')
    .description('Validate a plugin module file')
    .action(async (path: string) => {
      await pluginCheckCommand(path);
    });

  plugin
    .command('disable <name>')
    .description('Disable a plugin without removing')
    .action(async (name: string) => {
      await pluginDisableCommand(getProjectDir(), name);
    });

  plugin
    .command('enable <name>')
    .description('Re-enable a disabled plugin')
    .action(async (name: string) => {
      await pluginEnableCommand(getProjectDir(), name);
    });

  // Load engine plugins eagerly — their CLI commands must be registered before parse()
  // Project plugins are loaded lazily in preAction (they need projectDir)
  let projectPluginsLoaded = false;

  // Engine plugins: caller (bin/ku.ts) awaits this before parse()
  (program as any).loadEnginePlugins = async () => {
    try {
      const { pluginRegistry } = await import('../engine/plugin-registry.js');
      // Suppress load logs — CLI is transient, server will log its own
      const origLog = console.log;
      console.log = () => {};
      try {
        await pluginRegistry.loadEnginePlugins();
      } finally {
        console.log = origLog;
      }
      for (const registrar of pluginRegistry.getCliRegistrars()) {
        registrar(program);
      }
    } catch { /* ignore */ }
  };

  // Project plugins: load on first command execution (need projectDir from opts)
  program.hook('preAction', async () => {
    if (projectPluginsLoaded) return;
    projectPluginsLoaded = true;
    try {
      const { pluginRegistry } = await import('../engine/plugin-registry.js');
      await pluginRegistry.loadProjectPlugins(getProjectDir());
      for (const registrar of pluginRegistry.getCliRegistrars()) {
        registrar(program);
      }
    } catch { /* ignore — plugins dir may not exist */ }
  });

  return program;
}
