import type { AgentRecord } from '../../contracts/types.ts';

export const AGENT_ID = 'refund-processing-agent';
/** The inventory entry the agent registers with. All people and systems are fictional; refunds are sandbox-only. */
export const RECORD: AgentRecord = {
  id: AGENT_ID, name: 'Refund Processing Agent', purpose: 'Issues approved customer refunds up to the policy limit',
  owner: { name: 'Camille D. (Customer Care Operations, fictional)', team: 'Customer Care Operations', escalation: 'pager:care-ops-oncall (simulated)' },
  developer: 'Customer Care Engineering (fictional)', origin: 'internal', riskRating: 'high', version: '1.0.0', deploymentDate: '2026-11-01',
  reviewer: 'R. Okafor (Model Risk, fictional)', approver: 'T. Lindqvist (Risk Committee, fictional)',
  dataSources: ['synthetic-refund-tickets'], approvedUses: ['Issue refunds on approved tickets up to 500 CAD each'],
  limitations: ['Hard per-refund limit of 500 CAD enforced by the gateway (arg-level rule)', 'Sandbox tools only: no real money moves'],
  scopes: { tools: ['refunds.issue', 'tickets.read'], data: ['synthetic-refund-tickets'] }, models: ['rules-v1'], residency: 'ca-central',
  lifecycleState: 'production', evaluation: { evidenceUrl: 'https://evidence.rollcall.local/evals/refund-processing-agent', passed: true, date: '2026-10-20' },
  budgets: { perHourUsd: 50, perDayUsd: 400, perTaskUsd: 5 }, argLimits: [{ tool: 'refunds.issue', arg: 'amountCad', max: 500 }],
  reviewDate: '2027-02-01', nextMonitoringDate: '2027-03-01', runtimeRef: { kind: 'Agent', name: 'refund-agent', namespace: 'agents' },
};
