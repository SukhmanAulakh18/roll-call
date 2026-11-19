import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentRecord, PromotionEvidence } from '../../../contracts/types.ts';
import { FLEET } from '../../../sim/fleet.ts';
import { POLICY, evaluatePromotion, statsOf } from './lifecycle.ts';

const NOW = Date.parse('2026-11-19T00:00:00Z');
const rec = (o: Partial<AgentRecord> = {}): AgentRecord => ({ ...structuredClone(FLEET.find(a => a.id === 'invoice-recon')!), lifecycleState: 'canary', ...o });
const good: PromotionEvidence = {
  to: 'production', now: NOW,
  drills: { uncontained: 0, containP95Ms: 2000, containBudgetMs: 30_000 }, attackSuite: { positives: 9, missed: 0 },
  canary: { candidate: { calls: 10, errors: 0, p99Ms: 1 }, baseline: { calls: 40, errors: 0, p99Ms: 1 } }, budget: { calls: 200, errors: 0 },
};
const gate = (r: ReturnType<typeof evaluatePromotion>, name: string) => r.checks.find(c => c.name === name)!;

test('lifecycle: all gates green allows production, with a plain reason', () => {
  const r = evaluatePromotion(rec(), good);
  assert.equal(r.allowed, true); assert.match(r.reason, /^Allowed/); assert.equal(r.checks.length, 6); assert.ok(r.checks.every(c => c.passed));
});

test('lifecycle: no evaluation evidence blocks production with the plain-English reason', () => {
  const r = evaluatePromotion(rec({ evaluation: null }), good);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'Blocked: no evaluation evidence on file — production needs a passing evaluation');
});

test('lifecycle: failed and stale evaluations are blocked', () => {
  assert.match(gate(evaluatePromotion(rec({ evaluation: { evidenceUrl: 'u', passed: false, date: '2026-05-20' } }), good), 'Evaluation evidence').detail, /failed/);
  const stale = gate(evaluatePromotion(rec({ evaluation: { evidenceUrl: 'u', passed: true, date: '2025-01-01' } }), good), 'Evaluation evidence');
  assert.equal(stale.passed, false); assert.match(stale.detail, /days old/);
  const edge = (days: number) => new Date(NOW - days * 86_400_000).toISOString().slice(0, 10);
  assert.equal(gate(evaluatePromotion(rec({ evaluation: { evidenceUrl: 'u', passed: true, date: edge(POLICY.evalMaxAgeDays) } }), good), 'Evaluation evidence').passed, true);
});

test('lifecycle: drill regression needs results, full containment and p95 within budget', () => {
  assert.equal(gate(evaluatePromotion(rec(), { ...good, drills: null }), 'Drill regression').passed, false);
  assert.equal(gate(evaluatePromotion(rec(), { ...good, drills: { ...good.drills!, uncontained: 1 } }), 'Drill regression').passed, false);
  assert.equal(gate(evaluatePromotion(rec(), { ...good, drills: { ...good.drills!, containP95Ms: 31_000 } }), 'Drill regression').passed, false);
});

test('lifecycle: attack suite must have zero escapes', () => {
  const r = evaluatePromotion(rec(), { ...good, attackSuite: { positives: 9, missed: 2 } });
  assert.equal(gate(r, 'Attack suite').passed, false); assert.match(gate(r, 'Attack suite').detail, /2 of 9 attacks escaped/);
  assert.equal(gate(evaluatePromotion(rec(), { ...good, attackSuite: null }), 'Attack suite').passed, false);
});

test('lifecycle: canary analysis fails on error rate, on p99, and on too little traffic', () => {
  const c = (candidate: { calls: number; errors: number; p99Ms: number }) => evaluatePromotion(rec(), { ...good, canary: { candidate, baseline: good.canary!.baseline } });
  const errs = gate(c({ calls: 10, errors: 3, p99Ms: 1 }), 'Canary analysis');
  assert.equal(errs.passed, false); assert.match(errs.detail, /error rate 30\.0% on the new version vs 0\.0% on stable/);
  assert.match(gate(c({ calls: 10, errors: 0, p99Ms: 40 }), 'Canary analysis').detail, /p99 40\.00 ms/);
  assert.match(gate(c({ calls: 3, errors: 0, p99Ms: 1 }), 'Canary analysis').detail, /only 3 canary decisions/);
  assert.equal(gate(evaluatePromotion(rec(), { ...good, canary: null }), 'Canary analysis').passed, false);
  assert.equal(gate(c({ calls: 20, errors: 1, p99Ms: 1 }), 'Canary analysis').passed, true, '5% = at the margin passes');
});

test('lifecycle: exhausted error budget freezes every forward promotion', () => {
  const ex = { calls: 200, errors: 3 }; // 1% of 200 = 2 allowed
  const r = evaluatePromotion(rec(), { ...good, budget: ex });
  assert.equal(r.allowed, false); assert.match(gate(r, 'Error budget').detail, /promotions are frozen/);
  assert.equal(evaluatePromotion(rec({ lifecycleState: 'shadow' }), { ...good, to: 'canary', budget: ex }).allowed, false);
  assert.equal(gate(evaluatePromotion(rec(), { ...good, budget: { calls: 200, errors: 2 } }), 'Error budget').passed, true);
  assert.equal(gate(evaluatePromotion(rec(), { ...good, budget: { calls: 10, errors: 10 } }), 'Error budget').passed, true, 'too few decisions to judge');
  assert.equal(evaluatePromotion(rec(), { ...good, to: 'retired', budget: ex }).allowed, true, 'retiring is never frozen');
});

test('lifecycle: states advance one step at a time; retired is reachable from any live state and final', () => {
  assert.equal(evaluatePromotion(rec({ lifecycleState: 'draft' }), { ...good, to: 'production' }).allowed, false);
  assert.equal(evaluatePromotion(rec({ lifecycleState: 'draft' }), { ...good, to: 'shadow' }).allowed, true);
  assert.equal(evaluatePromotion(rec({ lifecycleState: 'shadow', evaluation: null }), { ...good, to: 'canary' }).allowed, false);
  assert.equal(evaluatePromotion(rec({ lifecycleState: 'production' }), { ...good, to: 'canary' }).allowed, false);
  assert.equal(evaluatePromotion(rec({ lifecycleState: 'production' }), { ...good, to: 'retired' }).allowed, true);
  assert.equal(evaluatePromotion(rec({ lifecycleState: 'retired' }), { ...good, to: 'retired' }).allowed, false);
});

test('lifecycle: statsOf counts non-allow verdicts and takes the nearest-rank p99', () => {
  const evs = Array.from({ length: 100 }, (_, i) => ({ verdict: i < 3 ? 'deny' : 'allow', latencyMs: i + 1 }));
  assert.deepEqual(statsOf(evs), { calls: 100, errors: 3, p99Ms: 99 });
  assert.deepEqual(statsOf([]), { calls: 0, errors: 0, p99Ms: 0 });
});
