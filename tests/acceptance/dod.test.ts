// Acceptance tests encoding the Definition of Done (build brief section 14).
// These were written BEFORE the implementation and must fail until it exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = () => mkdtempSync(join(tmpdir(), 'rollcall-'));
const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
};

test('DoD4: unregistered agent is rejected at admission with a readable reason', async () => {
  const { admit } = await import('../../services/control/src/admission.ts');
  const { FLEET } = await import('../../sim/fleet.ts');
  const r = admit({ name: 'shadow-bot', namespace: 'agents', labels: {} }, FLEET);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /register/i);
  const ok = admit({ name: FLEET[0].id, namespace: 'agents', labels: { 'rollcall.dev/agent-id': FLEET[0].id } }, FLEET);
  assert.equal(ok.allowed, true, ok.reason);
});

test('DoD3: kill with proof — revoked agent is denied by an independent probe', async () => {
  const { startStack } = await import('../../sim/stack.ts');
  const s = await startStack({ dataDir: tmp() });
  try {
    const id = 'fraud-triage';
    const k = await post(`${s.control.url}/v1/agents/${id}/kill`, { reason: 'test' });
    assert.equal(k.status, 200);
    assert.equal(k.body.stage, 'proof');
    assert.equal(k.body.proof.verdict, 'deny');
    assert.equal(k.body.proof.code, 'REVOKED');
    const tok = await post(`${s.control.url}/v1/identity/token`, { agentId: id });
    assert.notEqual(tok.status, 200, 'revoked agent must not get a new identity');
  } finally { await s.close(); }
});

test('DoD7: receipts chain verifies, and tampering is detected at the exact record', async () => {
  const { startStack } = await import('../../sim/stack.ts');
  const { verifyChain } = await import('../../services/gateway/src/receipts.ts');
  const dir = tmp();
  const s = await startStack({ dataDir: dir });
  await new Promise(r => setTimeout(r, 1500)); // let the fleet act
  await s.close();
  const file = join(dir, 'receipts', 'gw-1.jsonl');
  assert.ok(existsSync(file));
  const good = verifyChain(file);
  assert.equal(good.ok, true, good.reason);
  assert.ok(good.count > 5);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const rec = JSON.parse(lines[3]); rec.costUsd = rec.costUsd + 1; lines[3] = JSON.stringify(rec);
  writeFileSync(file, lines.join('\n') + '\n');
  const bad = verifyChain(file);
  assert.equal(bad.ok, false);
  assert.equal(bad.brokenAt, rec.seq);
});

test('DoD6: static stability — control plane down: cached low-risk continues, high-risk fails closed, no admissions', async () => {
  const { startStack } = await import('../../sim/stack.ts');
  const s = await startStack({ dataDir: tmp() });
  try {
    const tok = (await post(`${s.control.url}/v1/identity/token`, { agentId: 'kyc-refresh' })).body.token;
    await s.control.close();
    await new Promise(r => setTimeout(r, 2500)); // > staleAfterMs
    const gw = s.gateways[0].url;
    const low = await post(`${gw}/v1/act`, { agentId: 'kyc-refresh', tool: 'kyc.lookup', args: { customer: 'C-1' } }, { authorization: `Bearer ${tok}` });
    assert.equal(low.status, 200, JSON.stringify(low.body));
    const high = await post(`${gw}/v1/act`, { agentId: 'kyc-refresh', tool: 'payments.transfer', args: { amount: 10 } }, { authorization: `Bearer ${tok}` });
    assert.notEqual(high.status, 200);
  } finally { await s.close(); }
});

test('DoD2: impact.json has >= 20 drill runs, spend protected, contain p50/p95 and detector counts', () => {
  assert.ok(existsSync('impact.json'), 'run `make drill`');
  const i = JSON.parse(readFileSync('impact.json', 'utf8'));
  assert.ok(i.drill.runs >= 20);
  assert.ok(i.drill.spendProtectedUsd.protectedMean > 0);
  assert.ok(Number.isFinite(i.drill.timeToContainMs.p95));
  assert.equal(i.drill.timeToContainMs.samples.length, i.drill.runs);
  for (const k of ['tp', 'fp', 'fn', 'tn']) assert.ok(Number.isInteger(i.detector[k]), k);
});

test('DoD5: impact.json has bench p50/p95/p99, throughput and overhead vs ungoverned', () => {
  const i = JSON.parse(readFileSync('impact.json', 'utf8'));
  for (const p of ['p50', 'p95', 'p99']) { assert.ok(Number.isFinite(i.bench.governed[p])); assert.ok(Number.isFinite(i.bench.direct[p])); }
  assert.ok(Number.isFinite(i.bench.overheadP99Ms));
  assert.ok(i.bench.throughputRps > 0);
});
