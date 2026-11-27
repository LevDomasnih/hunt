#!/usr/bin/env node
// One version for the plugin and the server: the two plugin manifests, crm/src/version.ts and CHANGELOG.md.
// Claude Code and Codex hand out a new plugin only when the manifest's version changes, so every release raises it.
//   node scripts/release.mjs 0.3.0 [--min-plugin 0.3.0]   set the version, turn "## Unreleased" into "## 0.3.0 (<date>)"
//   node scripts/release.mjs --check                      exit 1 when the files disagree or the version has no changelog section
// Merging the raised version into main is the release: .github/workflows/release.yml tags it and publishes the Docker image.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFESTS = ['plugins/hunt/.claude-plugin/plugin.json', 'plugins/hunt/.codex-plugin/plugin.json'];
const VERSION_TS = 'crm/src/version.ts';
const SEMVER = /^\d+\.\d+\.\d+$/;
const read = (p) => readFileSync(join(root, p), 'utf8');
const tsConst = (txt, name) => txt.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1];

function current() {
  const ts = read(VERSION_TS);
  return {
    manifests: MANIFESTS.map((p) => [p, JSON.parse(read(p)).version]),
    server: tsConst(ts, 'VERSION'),
    minPlugin: tsConst(ts, 'MIN_PLUGIN'),
  };
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  const c = current(), errors = [];
  for (const [p, v] of c.manifests) if (v !== c.server) errors.push(`${p} has ${v}, ${VERSION_TS} has ${c.server}`);
  if (!SEMVER.test(c.server ?? '')) errors.push(`${VERSION_TS}: VERSION is not x.y.z`);
  if (!SEMVER.test(c.minPlugin ?? '')) errors.push(`${VERSION_TS}: MIN_PLUGIN is not x.y.z`);
  if (!new RegExp(`^## ${c.server.replace(/\./g, '\\.')} \\(`, 'm').test(read('CHANGELOG.md'))) errors.push(`CHANGELOG.md has no "## ${c.server} (…)" section`);
  if (errors.length) { console.log(errors.join('\n') + '\nrun node scripts/release.mjs <version>'); process.exit(1); }
  console.log(`release: ${c.server} everywhere (plugin ≥ ${c.minPlugin})`);
  process.exit(0);
}

const version = args.find((a) => !a.startsWith('--'));
const mi = args.indexOf('--min-plugin');
const minPlugin = mi >= 0 ? args[mi + 1] : null;
if (!version || !SEMVER.test(version) || (minPlugin && !SEMVER.test(minPlugin))) {
  console.log('usage: node scripts/release.mjs <x.y.z> [--min-plugin <x.y.z>] | --check');
  process.exit(2);
}
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
const was = current().server;
if (cmp(version, was) <= 0) { console.log(`${version} is not above the current ${was}`); process.exit(1); }
if (minPlugin && cmp(minPlugin, version) > 0) { console.log('--min-plugin cannot be above the version'); process.exit(1); }

let log = read('CHANGELOG.md');
const unreleased = log.match(/^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
if (!unreleased || !unreleased[1].trim()) { console.log('CHANGELOG.md: write what changed under "## Unreleased" first'); process.exit(1); }
const date = new Date().toISOString().slice(0, 10);
log = log.replace(/^## Unreleased\n/m, `## Unreleased\n\n## ${version} (${date})\n`);

for (const p of MANIFESTS) writeFileSync(join(root, p), read(p).replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
let ts = read(VERSION_TS).replace(/export const VERSION = '[^']+'/, `export const VERSION = '${version}'`);
if (minPlugin) ts = ts.replace(/export const MIN_PLUGIN = '[^']+'/, `export const MIN_PLUGIN = '${minPlugin}'`);
writeFileSync(join(root, VERSION_TS), ts);
writeFileSync(join(root, 'CHANGELOG.md'), log);
console.log(`release: ${was} → ${version}${minPlugin ? `, plugin ≥ ${minPlugin}` : ''}. Review the diff, then merge into main: the release workflow tags v${version}.`);
