#!/usr/bin/env node
// The Mini App gets real types module by module. web/tsconfig.json stays loose for the whole app; the files listed in
// web/typed.json are checked again with the stricter options below, and a file that leaves the list never comes back silently.
//   node scripts/typecheck-web.mjs            check the typed files (CI)
//   node scripts/typecheck-web.mjs --report   errors per file for the whole app: what to type next
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(crm, 'web');
const ts = createRequire(join(crm, 'package.json'))('typescript');
const STRICTER = { noImplicitAny: true, noImplicitThis: true, strictBindCallApply: true, strictFunctionTypes: true, noImplicitReturns: false };
const typed = new Set(JSON.parse(readFileSync(join(web, 'typed.json'), 'utf8')).files.map((f) => join(web, f)));
const cfg = ts.getParsedCommandLineOfConfigFile(join(web, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const program = ts.createProgram(cfg.fileNames, { ...cfg.options, ...STRICTER });
const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file);
const host = { getCanonicalFileName: (f) => f, getCurrentDirectory: () => crm, getNewLine: () => '\n' };

if (process.argv.includes('--report')) {
  const n = new Map();
  for (const d of diags) { const f = relative(web, d.file.fileName); n.set(f, (n.get(f) ?? 0) + 1); }
  for (const [f, c] of [...n].sort((a, b) => a[1] - b[1])) console.log(String(c).padStart(5), f, typed.has(join(web, f)) ? '(typed)' : '');
  console.log(`${diags.length} errors in ${n.size} files under the stricter options; ${typed.size} files typed`);
} else {
  for (const f of typed) if (!cfg.fileNames.includes(f)) { console.log(`web/typed.json lists a missing file: ${relative(web, f)}`); process.exitCode = 1; }
  const mine = diags.filter((d) => typed.has(d.file.fileName));
  if (mine.length) { console.log(ts.formatDiagnostics(mine, host)); process.exitCode = 1; }
  console.log(`typecheck-web: ${typed.size} typed files, ${mine.length} errors`);
}
