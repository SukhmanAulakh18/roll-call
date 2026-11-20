import type { PolicyBundle, Verdict } from '../../../contracts/types.ts';

export interface PolicyCtx {
  agentId: string; tool: string; model?: string;
  bundle: PolicyBundle | null; bundleAgeMs: number;
  args?: Record<string, unknown>;  // arg-level rules read these (the gateway passes the request args)
  estCostUsd: number; spend: { hourUsd: number; dayUsd: number; taskUsd: number };
  takeToken(): boolean;            // token bucket for this agent's throttle; only called when a throttle exists
}
export interface Decision { allow: boolean; verdict: Verdict; code: string; reason: string; ruleId: string }

/** Swap point for OPA / AGT adapters (ADR-002). Pure: no I/O; the gateway owns state and feeds it in via ctx. */
export interface PolicyEngine { evaluate(ctx: PolicyCtx): Decision }

const D = (verdict: Verdict, code: string, ruleId: string, reason: string): Decision => ({ allow: verdict === 'allow', verdict, code, ruleId, reason });
const fmt = (ts: number) => new Date(ts).toISOString().slice(11, 19);

/** Default per-refund limit (CAD) when the agent record carries no argLimits entry for refunds.issue. */
export const REFUND_LIMIT_CAD = 500;
const num2dp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
/** Arg-level rules (fail closed on shape): null = no opinion. Strings, negatives, zero, NaN, fractions of a cent and containers are all INVALID_ARGS, never coerced. */
function argRule(c: PolicyCtx, limits: { tool: string; arg: string; max: number }[]): Decision | null {
  if (c.tool !== 'refunds.issue') return null;
  const a = c.args ?? {}, max = limits.find(l => l.tool === c.tool && l.arg === 'amountCad')?.max ?? REFUND_LIMIT_CAD;
  if (typeof a.ticketId !== 'string' || !/^T-\d{1,9}$/.test(a.ticketId)) return D('deny', 'INVALID_ARGS', 'args.ticketId', "refunds.issue needs ticketId like 'T-1001'.");
  const v = a.amountCad;
  if (!num2dp(v) || v <= 0) return D('deny', 'INVALID_ARGS', 'args.amount.shape', `refunds.issue amountCad must be a positive number with at most 2 decimals (got ${JSON.stringify(v) ?? 'nothing'}).`);
  if (v > max) return D('deny', 'OVER_LIMIT', 'args.amount.limit', `Refund of ${v} CAD is over the per-refund limit of ${max} CAD.`);
  return null;
}

export const defaultPolicy: PolicyEngine = {
  evaluate(c) {
    const b = c.bundle;
    if (!b) return D('deny', 'NO_POLICY', 'bundle.missing', 'No policy bundle has been received yet, so the gateway fails closed.');
    const rev = b.revoked[c.agentId];
    if (rev) return D('deny', 'REVOKED', 'identity.revoked', `Agent identity has been revoked (killed at ${fmt(rev)} UTC).`);
    const a = b.agents[c.agentId];
    if (!a) return D('deny', 'UNREGISTERED', 'registry.unregistered', `Agent '${c.agentId}' is not in the registry. Register it first.`);
    if (a.lifecycleState === 'retired' || a.lifecycleState === 'draft') return D('deny', 'NOT_ACTIVE', 'lifecycle.inactive', `Agent '${c.agentId}' is ${a.lifecycleState} and may not call tools.`);
    if (!a.scopes.tools.includes(c.tool)) return D('deny', 'OUT_OF_SCOPE', 'scope.tool', `'${c.tool}' is outside the declared scopes of '${c.agentId}'.`);
    if (a.lifecycleState === 'shadow' && b.highRiskTools.includes(c.tool)) return D('deny', 'SHADOW_HIGH_RISK', 'lifecycle.shadow', `'${c.agentId}' is in shadow and may not use high-risk tool '${c.tool}'.`);
    if (c.model && !a.models.includes(c.model)) return D('deny', 'MODEL_NOT_ALLOWED', 'scope.model', `Model '${c.model}' is not approved for '${c.agentId}'.`);
    const arg = argRule(c, a.argLimits ?? []); if (arg) return arg;
    const th = b.throttles[c.agentId];
    if (th && !c.takeToken()) return D('throttle', 'THROTTLED', th.hard ? 'throttle.hard' : 'throttle.soft', `Throttled to ${th.ratePerSec.toFixed(1)} calls/s (${th.hard ? 'hard' : 'soft'}): ${th.reason}.`);
    if (c.spend.hourUsd + c.estCostUsd > a.budgets.perHourUsd) return D('deny', 'BUDGET_EXCEEDED', 'budget.hour', `Hourly budget of $${a.budgets.perHourUsd} would be exceeded.`);
    if (c.spend.dayUsd + c.estCostUsd > a.budgets.perDayUsd) return D('deny', 'BUDGET_EXCEEDED', 'budget.day', `Daily budget of $${a.budgets.perDayUsd} would be exceeded.`);
    if (c.spend.taskUsd + c.estCostUsd > a.budgets.perTaskUsd) return D('deny', 'BUDGET_EXCEEDED', 'budget.task', `Per-task budget of $${a.budgets.perTaskUsd} would be exceeded.`);
    if (b.highRiskTools.includes(c.tool) && c.bundleAgeMs > b.staleAfterMs) return D('deny', 'STALE_POLICY_HIGH_RISK', 'stale.highrisk', `Policy is ${Math.round(c.bundleAgeMs)} ms old (limit ${b.staleAfterMs} ms). High-risk tool '${c.tool}' fails closed until control is reachable.`);
    return D('allow', 'OK', 'default.allow', 'Allowed.');
  },
};
