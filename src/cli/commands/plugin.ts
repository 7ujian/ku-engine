import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginRegistry } from '../../engine/plugin-registry.js';

export async function pluginInstallCommand(projectDir: string, pkg: string): Promise<void> {
  const pluginsDir = resolve(projectDir, 'plugins');
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true });

  try {
    execSync(`npm install ${pkg} --prefix "${pluginsDir}" --no-save`, { stdio: 'inherit' });
    console.log(JSON.stringify({ ok: true, data: { installed: pkg } }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: `install failed: ${(err as Error).message}` }));
  }
}

export async function pluginRemoveCommand(projectDir: string, name: string): Promise<void> {
  const pluginsDir = resolve(projectDir, 'plugins');
  const pluginPath = join(pluginsDir, name);
  const jsPath = join(pluginsDir, name + '.js');
  const disabledPath = join(pluginsDir, '_' + name);

  if (existsSync(pluginPath)) {
    rmSync(pluginPath, { recursive: true, force: true });
  } else if (existsSync(jsPath)) {
    rmSync(jsPath);
  } else if (existsSync(disabledPath)) {
    rmSync(disabledPath, { recursive: true, force: true });
  } else {
    console.log(JSON.stringify({ ok: false, error: `plugin not found: ${name}` }));
    return;
  }

  try { execSync(`npm uninstall ${name} --prefix "${pluginsDir}" --no-save`, { stdio: 'pipe' }); } catch { /* not npm */ }

  console.log(JSON.stringify({ ok: true, data: { removed: name } }));
}

export async function pluginListCommand(projectDir: string): Promise<void> {
  const infos = await pluginRegistry.listPlugins(projectDir);
  console.log(JSON.stringify({ ok: true, data: infos }));
}

export async function pluginCreateCommand(projectDir: string, name: string): Promise<void> {
  const pluginsDir = resolve(projectDir, 'plugins');
  const pluginDir = join(pluginsDir, name);
  const indexPath = join(pluginDir, 'index.js');

  if (existsSync(indexPath)) {
    console.log(JSON.stringify({ ok: false, error: `plugin already exists: ${name}` }));
    return;
  }

  mkdirSync(pluginDir, { recursive: true });

  const template = `export const plugin = {
  name: '${name}',
  version: '1.0.0',

  init(host) {
    // Register custom node type
    host.registerNodeType('${name}', (id, overrides) => {
      return host.createNode(id, '${name}', {}, overrides);
    });

    // Register renderer for the node type
    host.registerNodeRenderer('${name}', (ctx, node, wx, wy) => {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.fillText('${name}', wx, wy);
      ctx.restore();
    });

    // Register custom script action
    // Usage in scene: { "${name.toLowerCase()}": true }
    host.registerAction('${name.toLowerCase()}', (node, action, context, event, ctx) => {
      ctx.recordError(node.id, event, '${name.toLowerCase()}', 'action fired');
    });
  }
};
`;

  writeFileSync(indexPath, template);
  console.log(JSON.stringify({ ok: true, data: { created: name, path: indexPath } }));
}

export async function pluginInfoCommand(projectDir: string, name: string): Promise<void> {
  const pluginsDir = resolve(projectDir, 'plugins');
  const entryPath = await resolvePluginPath(pluginsDir, name);
  if (!entryPath) {
    console.log(JSON.stringify({ ok: false, error: `plugin not found: ${name}` }));
    return;
  }

  try {
    const mod = await import(pathToFileURL(entryPath).href);
    const plugin = mod.default ?? mod.plugin ?? mod;
    const info: Record<string, unknown> = {
      name: plugin.name ?? name,
      version: plugin.version ?? '?',
      path: entryPath,
      hasInit: typeof plugin.init === 'function',
      hasDestroy: typeof plugin.destroy === 'function',
    };
    console.log(JSON.stringify({ ok: true, data: info }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: `failed to load: ${(err as Error).message}` }));
  }
}

export async function pluginCheckCommand(pluginPath: string): Promise<void> {
  const absPath = resolve(pluginPath);
  if (!existsSync(absPath)) {
    console.log(JSON.stringify({ ok: false, error: `file not found: ${absPath}` }));
    return;
  }

  try {
    const mod = await import(pathToFileURL(absPath).href);
    const plugin = mod.default ?? mod.plugin ?? mod;
    const errors: string[] = [];
    if (!plugin.name) errors.push('missing "name" field');
    if (!plugin.version) errors.push('missing "version" field');
    if (plugin.init !== undefined && typeof plugin.init !== 'function') errors.push('"init" must be a function');
    if (plugin.destroy !== undefined && typeof plugin.destroy !== 'function') errors.push('"destroy" must be a function');

    if (errors.length > 0) {
      console.log(JSON.stringify({ ok: false, error: errors.join('; ') }));
    } else {
      console.log(JSON.stringify({ ok: true, data: { name: plugin.name, version: plugin.version, valid: true } }));
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: `import failed: ${(err as Error).message}` }));
  }
}

export async function pluginDisableCommand(projectDir: string, name: string): Promise<void> {
  const pluginsDir = resolve(projectDir, 'plugins');
  const enabled = join(pluginsDir, name);
  const enabledJs = join(pluginsDir, name + '.js');
  const disabled = join(pluginsDir, '_' + name);

  if (existsSync(disabled)) {
    console.log(JSON.stringify({ ok: false, error: `already disabled: ${name}` }));
    return;
  }

  if (existsSync(enabled)) {
    renameSync(enabled, disabled);
    console.log(JSON.stringify({ ok: true, data: { disabled: name } }));
  } else if (existsSync(enabledJs)) {
    renameSync(enabledJs, join(pluginsDir, '_' + name + '.js'));
    console.log(JSON.stringify({ ok: true, data: { disabled: name } }));
  } else {
    console.log(JSON.stringify({ ok: false, error: `plugin not found: ${name}` }));
  }
}

export async function pluginEnableCommand(projectDir: string, name: string): Promise<void> {
  const pluginsDir = resolve(projectDir, 'plugins');
  const disabled = join(pluginsDir, '_' + name);
  const disabledJs = join(pluginsDir, '_' + name + '.js');
  const enabled = join(pluginsDir, name);
  const enabledJs = join(pluginsDir, name + '.js');

  if (existsSync(disabled)) {
    renameSync(disabled, enabled);
    console.log(JSON.stringify({ ok: true, data: { enabled: name } }));
  } else if (existsSync(disabledJs)) {
    renameSync(disabledJs, enabledJs);
    console.log(JSON.stringify({ ok: true, data: { enabled: name } }));
  } else {
    console.log(JSON.stringify({ ok: false, error: `disabled plugin not found: ${name}` }));
  }
}

async function resolvePluginPath(pluginsDir: string, name: string): Promise<string | null> {
  const direct = join(pluginsDir, name);
  if (name.endsWith('.js')) {
    try { readFileSync(direct); return direct; } catch { return null; }
  }
  const indexPath = join(direct, 'index.js');
  try { readFileSync(indexPath); return indexPath; } catch { /* fallthrough */ }
  try {
    const pkg = JSON.parse(readFileSync(join(direct, 'package.json'), 'utf-8'));
    if (pkg.main) return resolve(direct, pkg.main);
  } catch { /* fallthrough */ }
  return null;
}
