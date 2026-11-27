#!/usr/bin/env node
// Builds the server for an ordinary machine: node/server.mjs + src/ (the Worker) → dist/server.mjs, one ES module for Node 22.5+.
//   node scripts/build-node.mjs      then: node dist/server.mjs (the Mini App needs public/: copy-art.mjs + build-web.mjs)
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [join(crm, 'node/server.mjs')],
  outfile: join(crm, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  logLevel: 'warning',
});
console.log('build-node: dist/server.mjs');
