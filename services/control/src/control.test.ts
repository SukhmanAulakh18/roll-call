import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActionEvent } from '../../../contracts/types.ts';
import { FLEET } from '../../../sim/fleet.ts';
import { admit, review } from './admission.ts';
import { createDetector } from './detector.ts';
import { issueToken, verifyToken } from './identity.ts';

let n = 0;
const ev = (agentId: string, ts: number, o: Partial<ActionEvent> = {}): ActionEvent => ({ ts, gatewayId: 'g', receiptId: `g:${n++}`, agentId, tool: 'ledger.read', argsHash: `h${n}`, verdict: 'allow', code: 'OK', costUsd: 0, latencyMs: 0, governed: true, ...o });
/** 2 calls/s of varied args for `secs` seconds starting at t=0 */
const baseline = (d: ReturnType<typeof createDetector>, id: string, secs: number) => { for (let t = 0; t < secs * 1000; t += 500) d.observe(ev(id, 1_000_000 + t)); };

test('identity: HMAC token round-trips, expires, and rejects tampering', () => {
  const t = issueToken('fraud-triage', 1000, 5000);
  const v = verifyToken(t.token, 5500);
  assert.ok(v.ok && v.agentId === 'fraud-triage' && v.spiffeId === 'spiffe://rollcall.local/agent/fraud-triage');
  assert.equal(verifyToken(t.token, 6001).ok, false);
  assert.equal(verifyToken(t.token.slice(0, -2) + 'xx', 5500).ok, false);
});

test('admission: every deny rule gives a plain-English reason', () => {
  const lab = (id: string) => ({ name: id, namespace: 'a', labels: { 'rollcall.dev/agent-id': id } });
  assert.equal(admit({ name: 'x', namespace: 'a', labels: {} }, FLEET).code, 'NO_LABEL');
  assert.equal(admit(lab('nope'), FLEET).code, 'NOT_REGISTERED');
  const base = FLEET[0];
  const bad = (o: object) => admit(lab(base.id), [{ ...base, ...o } as any]).code;
  assert.equal(bad({ owner: { name: '', team: '', escalation: '' } }), 'NO_OWNER');
  assert.equal(bad({ scopes: { tools: [], data: [] } }), 'NO_SCOPES');
  assert.equal(bad({ lifecycleState: 'retired' }), 'RETIRED');
  assert.equal(bad({ evaluation: null }), 'NO_PASSING_EVAL');
  assert.equal(admit(lab('regulatory-digest'), FLEET).allowed, true, 'shadow with failing eval may run (it is not production)');
});

test('admission: answers a k8s AdmissionReview in kind', () => {
  const { out } = review({ kind: 'AdmissionReview', request: { uid: 'u1', object: { metadata: { name: 'p', labels: {} } } } }, FLEET);
  assert.equal(out.response.uid, 'u1'); assert.equal(out.response.allowed, false);
});

test('fleet: 12 agents incl. required ids, a shadow agent with failing eval, and AML human-governed queue', () => {
  assert.equal(FLEET.length, 12);
  for (const id of ['fraud-triage', 'kyc-refresh', 'aml-testgen', 'invoice-recon', 'mortgage-docs', 'support-summarizer', 'limits-checker', 'credit-memo']) assert.ok(FLEET.some(a => a.id === id), id);
  assert.ok(FLEET.some(a => a.lifecycleState === 'shadow' && a.evaluation && !a.evaluation.passed));
  assert.ok(FLEET.find(a => a.id === 'aml-testgen')!.scopes.tools.includes('approvals.enqueue'));
});

test('detector: runaway loop = rate + repeat => hard', () => {
  const d = createDetector(); baseline(d, 'a', 6);
  const now = 1_000_000 + 8000;
  for (let t = 6000; t < 8000; t += 25) d.observe(ev('a', 1_000_000 + t, { argsHash: 'same' + (t % 2) }));
  const f = d.evaluate(now).find(x => x.agentId === 'a')!;
  assert.equal(f.level, 'hard'); assert.equal(f.kind, 'runaway-loop'); assert.equal(f.autoKill, true);
});

test('detector: healthy burst (rate only, varied args) => soft', () => {
  const d = createDetector(); baseline(d, 'a', 6);
  for (let t = 6000; t < 8000; t += 30) d.observe(ev('a', 1_000_000 + t));
  const f = d.evaluate(1_000_000 + 8000).find(x => x.agentId === 'a')!;
  assert.equal(f.level, 'soft'); assert.equal(f.kind, 'rate-spike');
});

test('detector: slow repeat (same call at baseline rate) => soft', () => {
  const d = createDetector();
  for (let t = 0; t < 9000; t += 500) d.observe(ev('a', 1_000_000 + t, { argsHash: 'same' }));
  const f = d.evaluate(1_000_000 + 9000).find(x => x.agentId === 'a')!;
  assert.equal(f.level, 'soft'); assert.equal(f.kind, 'repeat');
});

test('detector: no baseline yet => no rate signal; normal traffic => no finding', () => {
  const d = createDetector();
  for (let t = 0; t < 1000; t += 25) d.observe(ev('a', 1_000_000 + t));
  assert.equal(d.evaluate(1_000_000 + 1000).length, 0);
  const n = createDetector(); baseline(n, 'b', 20);
  assert.equal(n.evaluate(1_000_000 + 20_000).length, 0);
});

test('detector: A2A ping-pong with high rate => hard cycle', () => {
  const d = createDetector(); baseline(d, 'a', 6); baseline(d, 'b', 6);
  for (let t = 6000; t < 8000; t += 50) { d.observe(ev('a', 1_000_000 + t, { tool: 'agent.call', targetAgentId: 'b', argsHash: 'x' })); d.observe(ev('b', 1_000_000 + t + 25, { tool: 'agent.call', targetAgentId: 'a', argsHash: 'y' })); }
  const f = d.evaluate(1_000_000 + 8000).find(x => x.agentId === 'a')!;
  assert.equal(f.kind, 'ping-pong'); assert.deepEqual(f.signals.cycle, ['a', 'b', 'a']);
});

test('detector: sustained scope drift => hard, no auto-kill; one attempt => soft flag', () => {
  const d = createDetector();
  d.observe(ev('a', 1_000_000, { tool: 'payments.transfer', verdict: 'deny', code: 'OUT_OF_SCOPE' }));
  assert.equal(d.evaluate(1_000_100)[0].level, 'soft');
  for (let i = 1; i < 6; i++) d.observe(ev('a', 1_000_000 + i * 200, { tool: 'payments.transfer', verdict: 'deny', code: 'OUT_OF_SCOPE' }));
  const f = d.evaluate(1_002_000)[0]; assert.equal(f.kind, 'scope-drift'); assert.equal(f.level, 'hard'); assert.equal(f.autoKill, false);
});

test('detector ignores ungoverned events (the baseline run has no governance)', () => {
  const d = createDetector(); baseline(d, 'a', 6);
  for (let t = 6000; t < 8000; t += 25) d.observe(ev('a', 1_000_000 + t, { argsHash: 'same', governed: false }));
  assert.equal(d.evaluate(1_000_000 + 8000).length, 0);
});
