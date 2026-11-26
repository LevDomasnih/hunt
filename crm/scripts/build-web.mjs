#!/usr/bin/env node
// Builds the Mini App and the site: web/app.ts (TypeScript, Preact + htm from a pinned CDN build) → public/app.js + source map.
//   node scripts/build-web.mjs           one build (predev, predeploy, CI)
//   node scripts/build-web.mjs --watch   rebuild on every change
// The CDN modules stay external (loaded by the browser as before); everything else is one ES module.
import { build, context } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
const opts = {
  entryPoints: [join(crm, 'web', 'app.ts')],
  outfile: join(crm, 'public', 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  external: ['https://*'],
  minify: true,
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
};
if (process.argv.includes('--watch')) {
  const ctx = await context({ ...opts, logLevel: 'info' });
  await ctx.watch();
} else {
  const r = await build({ ...opts, metafile: true });
  const out = Object.entries(r.metafile.outputs).find(([f]) => f.endsWith('app.js'));
  console.log(`build-web: public/app.js ${Math.round(out[1].bytes / 1024)} KB from ${Object.keys(r.metafile.inputs).length} files`);
}
