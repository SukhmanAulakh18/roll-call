import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStack } from '../../../sim/stack.ts';
import { mask } from './app.ts';
import { defaultPolicy } from './policy.ts';
import { createReceiptWriter, verifyChain } from './receipts.ts';

const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
};
const quiet = () => startStack({ dataDir: mkdtempSync(join(tmpdir(), 'rc-')), fleet: false, tickMs: 0 });
const token = async (s: Awaited<ReturnType<typeof quiet>>, agentId: string) => (await post(`${s.control.url}/v1/identity/token`, { agentId })).body.token as string;

test('mask redacts account-number-like strings, keeps last 4, leaves other values alone', () => {
  assert.deepEqual(mask({ a: '123456789012', n: [{ b: 'acct 4111111111111111 ok' }], x: 42, s: 'C-123' }), { a: '********9012', n: [{ b: 'acct ************1111 ok' }], x: 42, s: 'C-123' });
});

test('policy: rule order and fail-closed on missing bundle', () => {
  const ctx = { agentId: 'a', tool: 't', bundle: null, bundleAgeMs: 0, estCostUsd: 0, spend: { hourUsd: 0, dayUsd: 0, taskUsd: 0 }, takeToken: () => true };
  assert.equal(defaultPolicy.evaluate(ctx).code, 'NO_POLICY');
});

test('receipts: chain resumes after reopen and tamper is located', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'rc-')), 'g.jsonl');
  const w = createReceiptWriter(f, 'g'); for (let i = 0; i < 4; i++) w.append({ agentId: 'a', tool: 't', argsHash: 'h', verdict: 'allow', code: 'OK', costUsd: 0 }); w.close();
  const w2 = createReceiptWriter(f, 'g'); w2.append({ agentId: 'a', tool: 't', argsHash: 'h', verdict: 'deny', code: 'X', costUsd: 0 }); w2.close();
  assert.deepEqual(verifyChain(f), { ok: true, count: 5 });
});

test('gateway: allow masks results, scope/model/identity denies, receipts verify', async () => {
  const s = await quiet();
  try {
    const gw = s.gateways[0].url, tok = await token(s, 'invoice-recon'), auth = { authorization: `Bearer ${tok}` };
    const ok = await post(`${gw}/v1/act`, { agentId: 'invoice-recon', tool: 'ledger.read', args: { accountId: '123456789012' } }, auth);
    assert.equal(ok.status, 200); assert.match(ok.body.result.accountNumber, /^\*+\d{4}$/); assert.ok(ok.body.costUsd > 0); assert.ok(ok.body.latencyMs >= 0);
    assert.equal((await post(`${gw}/v1/act`, { agentId: 'invoice-recon', tool: 'payments.transfer', args: {} }, auth)).body.code, 'OUT_OF_SCOPE');
    assert.equal((await post(`${gw}/v1/act`, { agentId: 'invoice-recon', tool: 'llm.complete', args: { prompt: 'x' }, model: 'rogue' }, auth)).body.code, 'MODEL_NOT_ALLOWED');
    assert.equal((await post(`${gw}/v1/act`, { agentId: 'fraud-triage', tool: 'ledger.read', args: {} }, auth)).body.code, 'IDENTITY_MISMATCH');
    assert.equal((await post(`${gw}/v1/act`, { agentId: 'invoice-recon', tool: 'ledger.read', args: {} })).body.code, 'UNAUTHENTICATED');
    const m = await (await fetch(`${gw}/metrics`)).text(); assert.match(m, /rollcall_gateway_decision_seconds_count/);
    const d = await post(`${gw}/v1/direct`, { agentId: 'invoice-recon', tool: 'payments.transfer', args: { amount: 1 } });
    assert.equal(d.status, 200, 'ungoverned baseline has no scope check');
  } finally { await s.close(); }
});

test('gateway: revocation is enforced within the poll interval', async () => {
  const s = await quiet();
  try {
    const gw = s.gateways[0].url, tok = await token(s, 'kyc-refresh');
    s.control.registry.revoke('kyc-refresh', Date.now());
    await new Promise(r => setTimeout(r, 500));
    const r = await post(`${gw}/v1/act`, { agentId: 'kyc-refresh', tool: 'kyc.lookup', args: {} }, { authorization: `Bearer ${tok}` });
    assert.equal(r.body.code, 'REVOKED'); assert.equal(r.status, 403);
  } finally { await s.close(); }
});

test('gateway: throttle returns 429 and per-task budget denies', async () => {
  const s = await quiet();
  try {
    const gw = s.gateways[0].url, tok = await token(s, 'support-summarizer'), auth = { authorization: `Bearer ${tok}` };
    s.control.registry.setThrottle('support-summarizer', { ratePerSec: 1, hard: true, reason: 'test' });
    await new Promise(r => setTimeout(r, 400));
    const res = []; for (let i = 0; i < 5; i++) res.push((await post(`${gw}/v1/act`, { agentId: 'support-summarizer', tool: 'docs.search', args: { query: `q${i}` } }, auth)).status);
    assert.ok(res.includes(429) && res[0] === 200, res.join());
    s.control.registry.clearThrottle('support-summarizer');
    const rec = { ...s.control.registry.get('support-summarizer')!, budgets: { perHourUsd: 30, perDayUsd: 400, perTaskUsd: 0.0005 } };
    s.control.registry.upsert(rec); await new Promise(r => setTimeout(r, 400));
    const a = await post(`${gw}/v1/act`, { agentId: 'support-summarizer', tool: 'kyc.lookup', args: {}, taskId: 'T' }, auth); // out of scope, ignore
    assert.equal(a.body.code, 'OUT_OF_SCOPE');
    const b1 = await post(`${gw}/v1/act`, { agentId: 'support-summarizer', tool: 'docs.search', args: { query: 'a' }, taskId: 'T' }, auth);
    const b2 = await post(`${gw}/v1/act`, { agentId: 'support-summarizer', tool: 'docs.search', args: { query: 'b' }, taskId: 'T' }, auth);
    assert.equal(b1.body.code, 'OK'); assert.equal(b2.body.code, 'BUDGET_EXCEEDED');
  } finally { await s.close(); }
});

test('gateway: stale bundle fails closed for high-risk only', async () => {
  const s = await quiet();
  try {
    const gw = s.gateways[0].url, tok = await token(s, 'payment-orchestrator'), auth = { authorization: `Bearer ${tok}` };
    const warm = await post(`${gw}/v1/act`, { agentId: 'payment-orchestrator', tool: 'payments.transfer', args: { amount: 5 } }, auth);
    assert.equal(warm.status, 200);
    await s.control.close(); await new Promise(r => setTimeout(r, 2500));
    assert.equal((await post(`${gw}/v1/act`, { agentId: 'payment-orchestrator', tool: 'payments.transfer', args: { amount: 5 } }, auth)).body.code, 'STALE_POLICY_HIGH_RISK');
    assert.equal((await post(`${gw}/v1/act`, { agentId: 'payment-orchestrator', tool: 'ledger.read', args: {} }, auth)).status, 200);
  } finally { await s.close(); }
});

test('control: manual kill returns proof and receipts verify after close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-'));
  const s = await startStack({ dataDir: dir, fleet: false, tickMs: 0 });
  try {
    const tok = await token(s, 'kyc-refresh');
    await post(`${s.gateways[0].url}/v1/act`, { agentId: 'kyc-refresh', tool: 'kyc.lookup', args: { customer: 'C-1' } }, { authorization: `Bearer ${tok}` });
    const k = await post(`${s.control.url}/v1/agents/kyc-refresh/kill`, {});
    assert.equal(k.body.proof.code, 'REVOKED'); assert.equal(k.body.proof.attemptedTool, 'kyc.lookup');
    assert.equal((await post(`${s.control.url}/v1/agents/nope/kill`, {})).status, 404);
  } finally { await s.close(); }
  assert.equal(verifyChain(join(dir, 'receipts', 'gw-1.jsonl')).ok, true);
  assert.ok(readFileSync(join(dir, 'registry.json'), 'utf8').includes('kyc-refresh'));
});
