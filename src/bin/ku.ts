#!/usr/bin/env node
import { createProgram } from '../cli/cli.js';

async function main() {
  const program = createProgram();
  // Load engine plugins and register their CLI commands before parse
  await (program as any).loadEnginePlugins();
  program.parse();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
