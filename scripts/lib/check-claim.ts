// node scripts/lib/check-claim.ts <impact.json path> <format> <file>...
// Passes only if impact.json holds a real value at <path> and the formatted value appears in every listed file.
import { readFileSync } from 'node:fs';
import { FORMATS, get, loadImpact } from './claims.ts';

const [path, fmt, ...files] = process.argv.slice(2);
const v = get(loadImpact(), path);
if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) { console.error(`impact.json has no value at ${path}`); process.exit(1); }
const want = FORMATS[fmt](v);
for (const f of files) if (!readFileSync(f, 'utf8').includes(want)) { console.error(`${f} does not contain '${want}' (impact.json ${path} = ${v})`); process.exit(1); }
console.log(`${path} = ${want} in ${files.length} file(s)`);
