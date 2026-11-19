// make verify: receipt chains from a fresh run, tamper test, every verification-matrix check, impact.json schema,
// exec-pack numbers vs impact.json, and a forbidden-strings scan. Non-zero exit on any failure.
import { execSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyChain } from '../services/gateway/src/receipts.ts';
import { sleep } from '../services/lib/http.ts';
import { startStack } from '../sim/stack.ts';
import { allClaims, loadImpact, shown } from './lib/claims.ts';

type Row = { check: string; item: string; ok: boolean; detail: string };
const rows: Row[] = [];
const add = (check: string, item: string, ok: boolean, detail = '') => rows.push({ check, item, ok, detail });

// ---- 1. receipt chains from a fresh short stack run
const dir = mkdtempSync(join(tmpdir(), 'rollcall-verify-'));
const stack = await startStack({ dataDir: dir, gateways: 2 });
await sleep(4000);
await stack.close();                                   // flushes every receipt writer
const rdir = join(dir, 'receipts');
const files = existsSync(rdir) ? readdirSync(rdir).filter(f => f.endsWith('.jsonl')) : [];
if (!files.length) add('1 chain', 'receipts', false, 'no receipt files written');
for (const f of files) { const r = verifyChain(join(rdir, f)); add('1 chain', f, r.ok && r.count > 0, r.ok ? `${r.count} receipts` : `${r.reason}`); }

// ---- 2. tamper test: edit one record, verification must fail at exactly that seq
if (files.length) {
  const src = join(rdir, files[0]), lines = readFileSync(src, 'utf8').split('\n').filter(Boolean), k = Math.floor(lines.length / 2);
  const rec = JSON.parse(lines[k]); rec.tool = 'tampered.tool'; lines[k] = JSON.stringify(rec);
  const copy = join(dir, 'tampered.jsonl'); writeFileSync(copy, lines.join('\n') + '\n');
  const r = verifyChain(copy);
  add('2 tamper', `edit seq ${k} of ${files[0]}`, !r.ok && r.brokenAt === k, r.ok ? 'tampering NOT detected' : `expected failure at seq ${r.brokenAt} (${r.reason})`);
}

// ---- 3. every check_command in the verification matrix
const csv = (line: string): string[] => { const out: string[] = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const MATRIX = 'exec-pack/verification-matrix.csv';
const matrix = existsSync(MATRIX) ? readFileSync(MATRIX, 'utf8').trim().split('\n').slice(1).map(csv) : [];
if (!matrix.length) add('3 matrix', MATRIX, false, 'missing or empty: run make exec-pack');
for (const [claim, value, , , check] of matrix) {
  const t = Date.now();
  try { execSync(check, { stdio: 'pipe', timeout: 120_000 }); add('3 matrix', claim, true, `${value}  (${Date.now() - t} ms)`); }
  catch (e) { add('3 matrix', claim, false, `${value}: ${String((e as { stderr?: Buffer }).stderr ?? e).trim().split('\n')[0]}`); }
}

// ---- 4. impact.json against contracts/impact.schema.json (required, type, minimum, properties; no deps)
type S = { type?: string; required?: string[]; properties?: Record<string, S>; minimum?: number };
const problems: string[] = [];
const validate = (v: any, s: S, at: string) => {
  const t = Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;
  if (s.type && !(s.type === t || (s.type === 'number' && t === 'integer') || (s.type === 'object' && t === 'object'))) { problems.push(`${at}: expected ${s.type}, got ${t}`); return; }
  if (s.minimum !== undefined && typeof v === 'number' && v < s.minimum) problems.push(`${at}: ${v} < ${s.minimum}`);
  if (s.type === 'object' || s.required || s.properties) {
    for (const k of s.required ?? []) if (!(k in (v ?? {}))) problems.push(`${at}.${k}: required field missing`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (v && k in v) validate(v[k], sub, `${at}.${k}`);
  }
};
const impact = loadImpact();
validate(impact, JSON.parse(readFileSync('contracts/impact.schema.json', 'utf8')), 'impact');
add('4 schema', 'impact.json vs contracts/impact.schema.json', !problems.length, problems.slice(0, 3).join('; ') || 'all required fields present');

// ---- 5. exec-pack numbers match impact.json
const bad: string[] = [];
const byClaim = new Map(matrix.map(m => [m[0], m]));
for (const c of allClaims(impact)) {
  const m = byClaim.get(c.claim);
  if (!m) { bad.push(`no matrix row: ${c.claim}`); continue; }
  if (m[1] !== shown(c, impact)) bad.push(`${c.claim}: matrix says ${m[1]}, impact.json says ${shown(c, impact)}`);
  if (c.path) for (const f of c.in) if (!existsSync(f) || !readFileSync(f, 'utf8').includes(shown(c, impact))) bad.push(`${f} lacks ${shown(c, impact)}`);
}
for (const f of ['exec-pack/CEO-brief.md', 'exec-pack/CTO-brief.md']) {
  const t = existsSync(f) ? readFileSync(f, 'utf8') : '';
  if (!t.includes(impact.generatedAt) || !t.includes(impact.gitSha)) bad.push(`${f}: timestamp or gitSha stamp does not match impact.json`);
}
add('5 numbers', `${allClaims(impact).length} claims vs briefs and impact.json`, !bad.length, bad.slice(0, 3).join('; ') || 'all match');

// ---- 6. forbidden strings (built from parts so this file does not match itself)
const words = [['cl', 'aude'], ['anthro', 'pic'], ['vi', 'sa'], ['immigr', 'ation']].map(p => p.join(''));
const re = new RegExp(words.join('|'), 'i');
const tracked = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8', maxBuffer: 64e6 }).split('\n').filter(f => f && existsSync(f) && lstatSync(f).isFile()
  && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.lock)$/.test(f) && !/\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i.test(f) && !f.startsWith('node_modules/') && !f.startsWith('ui/dist/'));
const hits: string[] = [];
for (const f of tracked) { const lines = readFileSync(f, 'utf8').split('\n'); lines.forEach((l, i) => { if (re.test(l)) hits.push(`${f}:${i + 1}`); }); }
add('6 forbidden', `${tracked.length} files scanned for ${words.length} strings`, !hits.length, hits.slice(0, 5).join(', ') || 'zero matches');

// ---- report
const w = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
console.log('\n' + ['result', 'check', 'item', 'detail'].map((h, i) => w(h, [6, 12, 62, 70][i])).join('  '));
for (const r of rows) console.log([r.ok ? 'PASS' : 'FAIL', r.check, r.item, r.detail].map((h, i) => w(h, [6, 12, 62, 70][i])).join('  '));
const failed = rows.filter(r => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
