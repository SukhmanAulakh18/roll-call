import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionEvent, PromotionResult } from '../../../contracts/types.ts';
import { startControl } from './app.ts';

const post = async (url: string, body: unknown = {}) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
let n = 0;
const ev = (agentId: string, ts: number, verdict: ActionEvent['verdict'] = 'allow'): ActionEvent => ({ ts, gatewayId: 'g', receiptId: `g:${n++}`, agentId, tool: 'docs.search', argsHash: `h${n}`, verdict, code: verdict === 'allow' ? 'OK' : 'TOOL_ERROR', costUsd: 0, latencyMs: 0.2, governed: true });

test('promote API: no evaluation evidence is blocked in plain English, and dryRun changes nothing', async () => {
  const c = await startControl({ dataDir: mkdtempSync(join(tmpdir(), 'rc-')), tickMs: 0 });
  try {
    const id = 'treasury-forecast'; // shadow, no evaluation on record
    const dry = await post(`${c.url}/v1/agents/${id}/promote?dryRun=1`, { to: 'canary' });
    assert.equal(dry.status, 409);
    assert.equal((dry.body as PromotionResult).reason, 'Blocked: no evaluation evidence on file — canary needs a passing evaluation');
    assert.equal(dry.body.dryRun, true);
    assert.equal((await post(`${c.url}/v1/agents/${id}/promote`, { to: 'production' })).body.checks[0].passed, false, 'cannot skip canary');
    assert.equal(c.registry.get(id)!.lifecycleState, 'shadow');
    assert.equal((await post(`${c.url}/v1/agents/${id}/promote`, { to: 'nonsense' })).status, 422);
    assert.equal((await post(`${c.url}/v1/agents/nope/promote`, { to: 'canary' })).status, 404);
  } finally { await c.close(); }
});

test('promote API: canary to production needs measured evidence; an exhausted error budget freezes it', async () => {
  const c = await startControl({ dataDir: mkdtempSync(join(tmpdir(), 'rc-')), tickMs: 0 });
  try {
    const id = 'aml-testgen', now = Date.now();
    const none = await post(`${c.url}/v1/agents/${id}/promote?dryRun=1`, { to: 'production' });
    assert.equal(none.status, 409); assert.match(none.body.checks.find((k: any) => k.name === 'Canary analysis').detail, /only 0 canary decisions/);
    c.engine.ingest(Array.from({ length: 40 }, (_, i) => ev(id, now - 9000 + i * 200, i < 30 ? 'deny' : 'allow')));
    const frozen = await post(`${c.url}/v1/agents/${id}/promote`, { to: 'production' });
    assert.equal(frozen.status, 409); assert.equal(frozen.body.checks.find((k: any) => k.name === 'Error budget').passed, false);
    assert.equal(c.registry.get(id)!.lifecycleState, 'canary');
  } finally { await c.close(); }
});

test('promote API: healthy canary traffic is promoted and the record changes; retired keeps the record but stops the identity', async () => {
  const c = await startControl({ dataDir: mkdtempSync(join(tmpdir(), 'rc-')), tickMs: 0 });
  try {
    const id = 'aml-testgen', now = Date.now();
    c.engine.ingest(Array.from({ length: 20 }, (_, i) => ev(id, now - 9500 + i * 400)));
    const up = await post(`${c.url}/v1/agents/${id}/promote`, { to: 'production' });
    assert.equal(up.status, 200, up.body.reason); assert.equal(c.registry.get(id)!.lifecycleState, 'production');
    const gone = await post(`${c.url}/v1/agents/${id}/promote`, { to: 'retired' });
    assert.equal(gone.status, 200);
    const rec = await (await fetch(`${c.url}/v1/agents/${id}`)).json() as any;
    assert.equal(rec.lifecycleState, 'retired'); assert.equal(rec.name, 'AML Test Scenario Generator');
    assert.equal((await post(`${c.url}/v1/identity/token`, { agentId: id })).status, 403);
    assert.equal((await post(`${c.url}/v1/agents/${id}/promote`, { to: 'production' })).status, 409, 'retired is final');
  } finally { await c.close(); }
});

test('promote API: a running canary of a production agent is judged as a canary (dryRun for the CD tool)', async () => {
  const c = await startControl({ dataDir: mkdtempSync(join(tmpdir(), 'rc-')), tickMs: 0 });
  try {
    const id = 'invoice-recon';
    const plain = await post(`${c.url}/v1/agents/${id}/promote?dryRun=1`, { to: 'production' });
    assert.match(plain.body.reason, /production cannot move to production/);
    c.setRuntime({ running: async () => [], stop: async () => {}, start: async () => {}, inject: async () => {}, clear: async () => {}, reset: async () => {}, startCanary: async () => {}, stopCanary: async () => {} });
    c.registry.upsert(c.registry.get(id)!);
    const rel = await c.releases.start(id, { version: '1.1.0' }).catch(() => null); // no gateway acks in this test: start waits out its ack loop, then runs
    assert.ok(rel);
    const at = rel!.startedAt + 1;
    c.engine.ingest([...Array.from({ length: 10 }, () => ev(rel!.variantId, at)), ...Array.from({ length: 10 }, () => ev(id, at))]);
    const dry = await post(`${c.url}/v1/agents/${id}/promote?dryRun=1`, { to: 'production' });
    assert.equal(dry.status, 200, dry.body.reason); assert.equal(c.registry.get(id)!.version, '1.0.0');
    assert.equal((await post(`${c.url}/v1/agents/${id}/promote`, { to: 'production' })).status, 200);
    assert.equal(c.registry.get(id)!.version, '1.1.0');
  } finally { await c.close(); }
});
