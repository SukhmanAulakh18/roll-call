import test from 'node:test';
import assert from 'node:assert/strict';
import type { PolicyBundle } from '../../../contracts/types.ts';
import { defaultPolicy } from './policy.ts';

const bundle = (argLimits?: PolicyBundle['agents'][string]['argLimits']): PolicyBundle => ({
  version: 1, issuedAt: 0, revoked: {}, throttles: {}, highRiskTools: [], prices: {}, staleAfterMs: 2000,
  agents: { r: { id: 'r', riskRating: 'high', lifecycleState: 'production', scopes: { tools: ['refunds.issue'], data: [] }, models: [], budgets: { perHourUsd: 9, perDayUsd: 9, perTaskUsd: 9 }, argLimits } },
});
const ask = (args: Record<string, unknown>, b = bundle()) => defaultPolicy.evaluate({ agentId: 'r', tool: 'refunds.issue', args, bundle: b, bundleAgeMs: 0, estCostUsd: 0, spend: { hourUsd: 0, dayUsd: 0, taskUsd: 0 }, takeToken: () => true });

test('arg policy: over the limit is OVER_LIMIT, at the limit is allowed', () => {
  assert.equal(ask({ ticketId: 'T-1', amountCad: 500.01 }).code, 'OVER_LIMIT');
  assert.equal(ask({ ticketId: 'T-1', amountCad: 500 }).allow, true);
  assert.equal(ask({ ticketId: 'T-1', amountCad: 0.01 }).allow, true);
});
test('arg policy: the limit comes from the agent record', () => {
  assert.equal(ask({ ticketId: 'T-1', amountCad: 200 }, bundle([{ tool: 'refunds.issue', arg: 'amountCad', max: 100 }])).code, 'OVER_LIMIT');
});
test('arg policy: obfuscated amounts are INVALID_ARGS, never coerced', () => {
  for (const amountCad of ['1000', '9e2', -5, 0, 100.555, null, true, [900], { v: 900 }, undefined])
    assert.equal(ask({ ticketId: 'T-1', amountCad }).code, 'INVALID_ARGS', JSON.stringify(amountCad));
  assert.equal(ask({ amountCad: 10 }).code, 'INVALID_ARGS');
});
test('arg policy: revocation still wins and other tools are unaffected', () => {
  const b = bundle(); b.revoked.r = 1;
  assert.equal(ask({ ticketId: 'T-1', amountCad: 10 }, b).code, 'REVOKED');
  assert.equal(defaultPolicy.evaluate({ agentId: 'r', tool: 'refunds.issue', args: {}, bundle: { ...bundle(), agents: { r: { ...bundle().agents.r, scopes: { tools: ['tickets.read'], data: [] } } } }, bundleAgeMs: 0, estCostUsd: 0, spend: { hourUsd: 0, dayUsd: 0, taskUsd: 0 }, takeToken: () => true }).code, 'OUT_OF_SCOPE');
});
