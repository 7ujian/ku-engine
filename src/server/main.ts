import { resolve } from 'node:path';
import { EditorRuntime } from './editor-runtime.js';
import { PlayRuntime } from './play-runtime.js';
import { isPlayInstance, type InstanceType } from './discovery.js';

const args = process.argv.slice(2);
let mode: InstanceType = 'edit';
let dir = process.cwd();
let port = 0;
let syncFrom = 0;
let hotReload = false;
let scene = '';
let loadSceneName = '';
let autosave = false;
let watch = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--mode': mode = args[++i] as InstanceType; break;
    case '--dir': dir = resolve(args[++i]); break;
    case '--port': port = parseInt(args[++i], 10); break;
    case '--sync-from': syncFrom = parseInt(args[++i], 10); break;
    case '--hot-reload': hotReload = true; break;
    case '--scene': scene = args[++i]; break;
    case '--load-scene': loadSceneName = args[++i]; break;
    case '--autosave': autosave = true; break;
    case '--watch': watch = true; break;
  }
}

async function main(): Promise<void> {
  if (isPlayInstance(mode)) {
    const rt = await PlayRuntime.create({
      dir,
      port,
      name: mode,
      syncFrom: syncFrom || undefined,
      hotReload,
      loadScene: loadSceneName || undefined,
      watch,
    });
    await rt.start();

    const cleanup = async () => {
      await rt.stop();
      process.exit(0);
    };

    rt.loop.setOnExit(cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
  } else {
    const rt = await EditorRuntime.create(dir, port, scene || undefined, autosave);
    await rt.start();

    const cleanup = async () => {
      await rt.stop();
      process.exit(0);
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
  }
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
