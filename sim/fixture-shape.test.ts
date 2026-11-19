import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FIXTURE_IMPACT } from '../ui/src/fixtures/FIXTURE_impact.ts';

// The UI crashed in real mode because the fixture said detector.cases was a number. Fixture keys must have the same JSON kind as impact.json.
const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
function sameShape(fx: any, real: any, path: string): void {
  for (const k of Object.keys(fx)) {
    assert.ok(k in real, `${path}.${k} is in the fixture but not in impact.json`);
    assert.equal(kind(fx[k]), kind(real[k]), `${path}.${k}: fixture is ${kind(fx[k])}, impact.json is ${kind(real[k])}`);
    if (kind(fx[k]) === 'object' && k !== 'pricesUsdPerCall' && k !== 'stagesP95Ms') sameShape(fx[k], real[k], `${path}.${k}`);
  }
}
test('fixture impact has the same shape as the real impact.json', () => {
  const real = JSON.parse(readFileSync(new URL('../impact.json', import.meta.url), 'utf8'));
  for (const sec of ['fleet', 'drill', 'detector', 'release', 'bench']) sameShape((FIXTURE_IMPACT as any)[sec], real[sec], sec);
});
