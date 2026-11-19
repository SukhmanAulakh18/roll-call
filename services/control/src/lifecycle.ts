import type { AgentRecord, CanaryStats, GateCheck, LifecycleState, PromotionEvidence, PromotionResult } from '../../../contracts/types.ts';
import { checkRecord } from './admission.ts';

/** Promotion policy. Written once here, quoted by ADR-014; nothing is tuned per run. */
export const POLICY = {
  evalMaxAgeDays: 365,        // evaluation older than this is stale (annual revalidation)
  canaryMinCalls: 8,          // canary decisions needed before the version is judged
  canaryWindowMs: 10_000,     // canary must run at least this long before auto-promotion
  canaryShare: 0.5,           // fraction of the agent's traffic the canary takes (sim: 2 calls/s agents, so 1 call/s needs half)
  errorRateMargin: 0.05,      // canary error rate may exceed the stable one by at most 5 points
  p99Ratio: 1.5, p99SlackMs: 10, // canary p99 <= stable p99 x 1.5 + 10 ms (decision-path time; the slack absorbs timer noise)
  sloTarget: 0.99,            // error budget: 99% of an agent's decisions are allowed (not denied, throttled or failed)
  budgetMinCalls: 20,         // fewer decisions than this: no verdict, budget not exhausted
} as const;

const NEXT: Partial<Record<LifecycleState, LifecycleState>> = { draft: 'shadow', shadow: 'canary', canary: 'production' };
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const chk = (name: string, passed: boolean, detail: string): GateCheck => ({ name, passed, detail });

function evaluationGate(r: AgentRecord, to: string, now: number): GateCheck {
  const e = r.evaluation;
  if (!e || !e.evidenceUrl) return chk('Evaluation evidence', false, `no evaluation evidence on file — ${to} needs a passing evaluation`);
  if (!e.passed) return chk('Evaluation evidence', false, `the evaluation on file (${e.date}) failed — ${to} needs a passing evaluation`);
  const age = (now - Date.parse(e.date)) / 86_400_000;
  if (!Number.isFinite(age)) return chk('Evaluation evidence', false, `the evaluation date '${e.date}' is not a date, so its age cannot be checked`);
  if (age > POLICY.evalMaxAgeDays) return chk('Evaluation evidence', false, `the passing evaluation is ${Math.floor(age)} days old; the limit is ${POLICY.evalMaxAgeDays} days — re-run it`);
  return chk('Evaluation evidence', true, `passing evaluation from ${e.date} (${Math.floor(age)} days old, limit ${POLICY.evalMaxAgeDays})`);
}

function drillGate(d: PromotionEvidence['drills']): GateCheck {
  if (!d) return chk('Drill regression', false, 'no drill results on file — run make drill');
  const bad = d.uncontained > 0 ? `${d.uncontained} runaway drill(s) were not contained` : d.containP95Ms > d.containBudgetMs ? `time to contain p95 ${d.containP95Ms} ms is over the ${d.containBudgetMs} ms budget` : '';
  return chk('Drill regression', !bad, bad || `every runaway drill was contained; time to contain p95 ${d.containP95Ms} ms is within the ${d.containBudgetMs} ms budget`);
}

function attackGate(a: PromotionEvidence['attackSuite']): GateCheck {
  if (!a) return chk('Attack suite', false, 'no attack-suite results on file — run make drill');
  return chk('Attack suite', a.missed === 0, a.missed === 0 ? `0 of ${a.positives} attacks escaped containment` : `${a.missed} of ${a.positives} attacks escaped containment`);
}

/** Compares the new version with the stable one over the same canary window. Needs POLICY.canaryMinCalls decisions first. */
export function analyseCanary(c: PromotionEvidence['canary']): GateCheck {
  const name = 'Canary analysis';
  if (!c) return chk(name, false, 'no canary traffic analysed — run the new version as a canary first');
  const { candidate: k, baseline: b } = c;
  if (k.calls < POLICY.canaryMinCalls) return chk(name, false, `only ${k.calls} canary decisions so far; ${POLICY.canaryMinCalls} are needed before the new version is judged`);
  const ke = k.errors / k.calls, be = b.calls ? b.errors / b.calls : 0;
  const p99Limit = b.p99Ms * POLICY.p99Ratio + POLICY.p99SlackMs;
  const bad: string[] = [];
  if (ke > be + POLICY.errorRateMargin) bad.push(`error rate ${pct1(ke)} on the new version vs ${pct1(be)} on stable (limit: stable + ${POLICY.errorRateMargin * 100} points)`);
  if (k.p99Ms > p99Limit) bad.push(`p99 ${k.p99Ms.toFixed(2)} ms on the new version vs ${b.p99Ms.toFixed(2)} ms on stable (limit ${p99Limit.toFixed(2)} ms)`);
  return chk(name, !bad.length, bad.join('; ') || `error rate ${pct1(ke)} vs ${pct1(be)} on stable and p99 ${k.p99Ms.toFixed(2)} ms vs ${b.p99Ms.toFixed(2)} ms are within limits (${k.calls} canary decisions)`);
}

/** Error budget: with SLO 99% over the decisions control holds for the stable version, at most 1% may be non-allow. More than that = exhausted. */
export function budgetGate(b: PromotionEvidence['budget']): GateCheck {
  const name = 'Error budget';
  if (!b || b.calls < POLICY.budgetMinCalls) return chk(name, true, `only ${b?.calls ?? 0} decisions on record (fewer than ${POLICY.budgetMinCalls}), so the budget is not exhausted`);
  const allowed = b.calls * (1 - POLICY.sloTarget);
  return b.errors > allowed
    ? chk(name, false, `error budget exhausted: ${b.errors} of ${b.calls} decisions failed against ${allowed.toFixed(1)} allowed by the ${POLICY.sloTarget * 100}% objective — promotions are frozen`)
    : chk(name, true, `${b.errors} of ${b.calls} decisions failed against ${allowed.toFixed(1)} allowed by the ${POLICY.sloTarget * 100}% objective`);
}

/** Pure and deterministic: the same record and evidence always give the same verdict. */
export function evaluatePromotion(record: AgentRecord, evidence: PromotionEvidence): PromotionResult {
  const from = record.lifecycleState, to = evidence.to;
  const checks: GateCheck[] = [];
  if (to === 'retired') {
    checks.push(from === 'retired' ? chk('Lifecycle step', false, `'${record.id}' is already retired`) : chk('Lifecycle step', true, `${from} to retired (decommissioned; the record is kept)`));
  } else {
    const ok = NEXT[from] === to;
    checks.push(chk('Lifecycle step', ok, ok ? `${from} to ${to} is the next step` : `${from} cannot move to ${to}; the only forward step from ${from} is ${NEXT[from] ?? 'none'}`));
    if (ok) {
      if (to === 'shadow') { const v = checkRecord(record); checks.push(chk('Record complete', v.allowed, v.allowed ? 'owner, escalation and scopes are on the record' : v.reason)); }
      if (to === 'canary' || to === 'production') checks.push(evaluationGate(record, to, evidence.now));
      if (to === 'production') checks.push(drillGate(evidence.drills), attackGate(evidence.attackSuite), analyseCanary(evidence.canary));
      checks.push(budgetGate(evidence.budget));
    }
  }
  const failed = checks.filter(c => !c.passed);
  const reason = failed.length
    ? `Blocked: ${failed[0].detail}${failed.length > 1 ? ` (and ${failed.length - 1} more gate${failed.length > 2 ? 's' : ''} failed)` : ''}`
    : `Allowed: '${record.id}' may move from ${from} to ${to}; all ${checks.length} gates passed.`;
  return { allowed: !failed.length, reason, checks, from, to };
}

/** Stats for one version from gateway events. errors = any non-allow verdict. p99 by nearest rank. */
export function statsOf(events: { verdict: string; latencyMs: number }[]): CanaryStats {
  const lat = events.map(e => e.latencyMs).sort((a, b) => a - b);
  return { calls: events.length, errors: events.filter(e => e.verdict !== 'allow').length, p99Ms: lat.length ? lat[Math.min(lat.length - 1, Math.ceil(0.99 * lat.length) - 1)] : 0 };
}
