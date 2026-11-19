// FIXTURE DATA: fictional agents used only with ?fixture=1.
import type { AgentRecord, LifecycleState, RiskRating } from '../../../contracts/types';

const mk = (id: string, name: string, purpose: string, team: string, risk: RiskRating, life: LifecycleState, tools: string[], data: string[], ok = true): AgentRecord => ({
  id, name, purpose, owner: { name: `${team} lead`, team, escalation: `pager:${team.toLowerCase().replace(/\s/g, '-')}` },
  developer: 'Platform Engineering', origin: 'internal', riskRating: risk, version: '1.2.0', deploymentDate: '2025-09-01',
  reviewer: 'Model Risk', approver: 'Head of ' + team, dataSources: data, approvedUses: [purpose], limitations: ['Fixture record'],
  scopes: { tools, data }, models: ['small-1', 'large-1'], residency: 'ca-central', lifecycleState: life,
  evaluation: ok ? { evidenceUrl: 'evidence/fixture.md', passed: true, date: '2025-10-01' } : null,
  budgets: { perHourUsd: 5, perDayUsd: 40, perTaskUsd: 0.5 }, reviewDate: '2026-06-01', nextMonitoringDate: '2026-03-01',
  runtimeRef: { kind: 'SimProcess', name: id, namespace: 'fleet' },
});

export const FIXTURE_AGENTS: AgentRecord[] = [
  mk('aml-testgen', 'AML test generator', 'Writes test cases for anti-money-laundering rules.', 'Financial Crime', 'medium', 'production', ['docs.search', 'llm.complete'], ['policy-docs']),
  mk('kyc-summarizer', 'KYC summarizer', 'Summarizes customer onboarding files for reviewers.', 'Onboarding', 'high', 'production', ['kyc.lookup', 'llm.complete'], ['kyc-store']),
  mk('payments-triage', 'Payments triage', 'Sorts failed payments into repair queues.', 'Payments Ops', 'high', 'production', ['ledger.read', 'payments.transfer', 'llm.complete'], ['ledger']),
  mk('dispute-drafter', 'Dispute drafter', 'Drafts replies to card disputes.', 'Cards', 'medium', 'production', ['ledger.read', 'email.draft', 'llm.complete'], ['ledger', 'case-db']),
  mk('sanctions-screener', 'Sanctions screener', 'Screens counterparties against watch lists.', 'Financial Crime', 'critical', 'production', ['sanctions.screen', 'kyc.lookup'], ['kyc-store']),
  mk('policy-qa', 'Policy Q&A', 'Answers staff questions about internal policy.', 'Operations', 'low', 'production', ['docs.search', 'llm.complete'], ['policy-docs']),
  mk('report-builder', 'Report builder', 'Assembles monthly regulatory reports.', 'Finance', 'medium', 'canary', ['ledger.read', 'report.generate'], ['ledger']),
  mk('fraud-ranker', 'Fraud ranker', 'Ranks flagged transactions by likely fraud.', 'Fraud', 'high', 'production', ['ledger.read', 'llm.complete', 'agent.call'], ['ledger', 'case-db']),
  mk('case-router', 'Case router', 'Routes new cases to the right team.', 'Operations', 'low', 'production', ['case.write', 'agent.call'], ['case-db']),
  mk('collections-nudger', 'Collections nudger', 'Drafts polite payment reminders.', 'Collections', 'medium', 'shadow', ['email.draft', 'ledger.read'], ['ledger'], false),
  mk('branch-assistant', 'Branch assistant', 'Helps branch staff find procedures.', 'Retail', 'low', 'production', ['docs.search', 'llm.complete'], ['policy-docs']),
  mk('treasury-forecaster', 'Treasury forecaster', 'Projects daily cash positions.', 'Treasury', 'high', 'production', ['ledger.read', 'report.generate', 'llm.complete'], ['ledger']),
];
