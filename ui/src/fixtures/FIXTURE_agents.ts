// FIXTURE DATA: copy of sim/fleet.ts FLEET (fictional banking agents), used only with ?fixture=1 and the offline replay fallback.
import type { AgentRecord } from '../../../contracts/types';

export const FIXTURE_AGENTS: AgentRecord[] = [
 {
  "id": "fraud-triage",
  "name": "Fraud Triage Assistant",
  "purpose": "Ranks suspicious card transactions for analyst review and drafts the rationale.",
  "owner": {
   "name": "Dana K. (Fraud Operations)",
   "team": "Fraud Operations",
   "escalation": "pager:fraud-operations-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "high",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Prioritise alerts for human analysts",
   "Draft case rationale"
  ],
  "limitations": [
   "Never blocks a card on its own",
   "English only"
  ],
  "scopes": {
   "tools": [
    "txn.lookup",
    "kyc.lookup",
    "fraud.flag",
    "llm.complete",
    "ledger.read"
   ],
   "data": [
    "synthetic-transactions",
    "synthetic-kyc"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/fraud-triage",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "fraud-triage",
   "namespace": "agents"
  }
 },
 {
  "id": "kyc-refresh",
  "name": "KYC Refresh Agent",
  "purpose": "Checks customer due-diligence files for staleness and drafts refresh requests.",
  "owner": {
   "name": "Marcus T. (Client Onboarding)",
   "team": "Client Onboarding",
   "escalation": "pager:client-onboarding-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "medium",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Flag stale KYC files",
   "Draft refresh requests for human send"
  ],
  "limitations": [
   "Read-only on customer files"
  ],
  "scopes": {
   "tools": [
    "kyc.lookup",
    "docs.search",
    "llm.complete"
   ],
   "data": [
    "synthetic-kyc"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/kyc-refresh",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "kyc-refresh",
   "namespace": "agents"
  }
 },
 {
  "id": "aml-testgen",
  "name": "AML Test Scenario Generator",
  "purpose": "Drafts AML monitoring test scenarios. Every output waits in an approval queue for a human before it is used.",
  "owner": {
   "name": "Priya N. (Financial Crime Compliance)",
   "team": "Financial Crime Compliance",
   "escalation": "pager:financial-crime-compliance-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "high",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Generate test scenarios for monitoring-rule validation",
   "Human-governed: nothing is used until a reviewer approves it in the queue"
  ],
  "limitations": [
   "No access to production customer data",
   "Outputs are drafts, never evidence"
  ],
  "scopes": {
   "tools": [
    "docs.search",
    "llm.complete",
    "approvals.enqueue"
   ],
   "data": [
    "synthetic-aml-typologies"
   ]
  },
  "models": [
   "sim-large"
  ],
  "residency": "ca-central",
  "lifecycleState": "canary",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/aml-testgen",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "aml-testgen",
   "namespace": "agents"
  }
 },
 {
  "id": "invoice-recon",
  "name": "Invoice Reconciliation Agent",
  "purpose": "Matches supplier invoices to ledger entries and posts adjustments within tolerance.",
  "owner": {
   "name": "Hiro S. (Finance Operations)",
   "team": "Finance Operations",
   "escalation": "pager:finance-operations-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "medium",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Match invoices to ledger lines",
   "Post rounding adjustments under tolerance"
  ],
  "limitations": [
   "Adjustments capped by ledger.post policy"
  ],
  "scopes": {
   "tools": [
    "ledger.read",
    "ledger.post",
    "docs.search",
    "llm.complete"
   ],
   "data": [
    "synthetic-ledger"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/invoice-recon",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "invoice-recon",
   "namespace": "agents"
  }
 },
 {
  "id": "mortgage-docs",
  "name": "Mortgage Document Checker",
  "purpose": "Checks mortgage application packages for missing or stale documents.",
  "owner": {
   "name": "Elena V. (Retail Lending)",
   "team": "Retail Lending",
   "escalation": "pager:retail-lending-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "medium",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Completeness checks on applications"
  ],
  "limitations": [
   "Does not assess creditworthiness"
  ],
  "scopes": {
   "tools": [
    "docs.search",
    "llm.complete",
    "kyc.lookup"
   ],
   "data": [
    "synthetic-mortgage-files"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/mortgage-docs",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "mortgage-docs",
   "namespace": "agents"
  }
 },
 {
  "id": "support-summarizer",
  "name": "Support Case Summarizer",
  "purpose": "Summarises customer support cases for the next agent in the queue.",
  "owner": {
   "name": "Sam O. (Customer Care)",
   "team": "Customer Care",
   "escalation": "pager:customer-care-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "low",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Summarise cases"
  ],
  "limitations": [
   "No money movement of any kind"
  ],
  "scopes": {
   "tools": [
    "docs.search",
    "llm.complete",
    "txn.lookup"
   ],
   "data": [
    "synthetic-cases"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/support-summarizer",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 20,
   "perDayUsd": 250,
   "perTaskUsd": 3
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "support-summarizer",
   "namespace": "agents"
  }
 },
 {
  "id": "limits-checker",
  "name": "Credit Limits Checker",
  "purpose": "Confirms exposure against approved credit limits and answers other agents.",
  "owner": {
   "name": "Anika R. (Credit Risk)",
   "team": "Credit Risk",
   "escalation": "pager:credit-risk-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "high",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Limit confirmation"
  ],
  "limitations": [
   "Advisory only"
  ],
  "scopes": {
   "tools": [
    "limits.get",
    "ledger.read",
    "agent.call",
    "llm.complete"
   ],
   "data": [
    "synthetic-limits"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/limits-checker",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "limits-checker",
   "namespace": "agents"
  }
 },
 {
  "id": "credit-memo",
  "name": "Credit Memo Drafter",
  "purpose": "Drafts credit memos and asks the limits checker to confirm exposure.",
  "owner": {
   "name": "Jonas B. (Credit Risk)",
   "team": "Credit Risk",
   "escalation": "pager:credit-risk-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "high",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Draft memos for human credit officers"
  ],
  "limitations": [
   "Recommendation field left blank for the human approver"
  ],
  "scopes": {
   "tools": [
    "docs.search",
    "ledger.read",
    "llm.complete",
    "agent.call",
    "limits.get"
   ],
   "data": [
    "synthetic-limits",
    "synthetic-credit-files"
   ]
  },
  "models": [
   "sim-large"
  ],
  "residency": "ca-central",
  "lifecycleState": "canary",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/credit-memo",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "credit-memo",
   "namespace": "agents"
  }
 },
 {
  "id": "payment-orchestrator",
  "name": "Payment Orchestrator",
  "purpose": "Routes approved low-value payments to the cheapest available rail.",
  "owner": {
   "name": "Priya N. (Payments Ops)",
   "team": "Payments Operations",
   "escalation": "pager:payments-operations-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "critical",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Route approved payments under the per-payment cap"
  ],
  "limitations": [
   "Cap of 500 CAD per payment enforced by the payments rail"
  ],
  "scopes": {
   "tools": [
    "payments.transfer",
    "ledger.read",
    "txn.lookup",
    "fraud.flag"
   ],
   "data": [
    "synthetic-payments"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/payment-orchestrator",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 40,
   "perDayUsd": 500,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "payment-orchestrator",
   "namespace": "agents"
  }
 },
 {
  "id": "collections-nudge",
  "name": "Collections Reminder Agent",
  "purpose": "Drafts and queues friendly payment reminders.",
  "owner": {
   "name": "Lucia M. (Collections)",
   "team": "Collections",
   "escalation": "pager:collections-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "medium",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Send pre-approved reminder templates"
  ],
  "limitations": [
   "Templates only; no negotiation"
  ],
  "scopes": {
   "tools": [
    "mail.send",
    "ledger.read",
    "llm.complete"
   ],
   "data": [
    "synthetic-arrears"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "production",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/collections-nudge",
   "passed": true,
   "date": "2026-05-20"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "collections-nudge",
   "namespace": "agents"
  }
 },
 {
  "id": "regulatory-digest",
  "name": "Regulatory Digest Agent",
  "purpose": "Summarises new supervisory publications for compliance staff.",
  "owner": {
   "name": "Owen P. (Compliance Advisory)",
   "team": "Compliance Advisory",
   "escalation": "pager:compliance-advisory-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "low",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Shadow-mode summaries, not yet shown to staff"
  ],
  "limitations": [
   "Evaluation failed: summaries omitted key obligations in 3 of 20 samples"
  ],
  "scopes": {
   "tools": [
    "docs.search",
    "llm.complete"
   ],
   "data": [
    "synthetic-publications"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "shadow",
  "evaluation": {
   "evidenceUrl": "https://evidence.rollcall.local/evals/regulatory-digest",
   "passed": false,
   "date": "2026-06-11"
  },
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "regulatory-digest",
   "namespace": "agents"
  }
 },
 {
  "id": "treasury-forecast",
  "name": "Treasury Forecast Narrator",
  "purpose": "Writes plain-English commentary on liquidity forecasts.",
  "owner": {
   "name": "Mei L. (Treasury)",
   "team": "Treasury",
   "escalation": "pager:treasury-oncall (simulated)"
  },
  "developer": "Agent Platform Team (fictional)",
  "origin": "internal",
  "riskRating": "medium",
  "version": "1.0.0",
  "deploymentDate": "2026-06-02",
  "reviewer": "R. Okafor (Model Risk, fictional)",
  "approver": "T. Lindqvist (Risk Committee, fictional)",
  "dataSources": [
   "synthetic-ledger"
  ],
  "approvedUses": [
   "Shadow-mode commentary for the treasury team"
  ],
  "limitations": [
   "No evaluation on record yet"
  ],
  "scopes": {
   "tools": [
    "ledger.read",
    "llm.complete",
    "docs.search"
   ],
   "data": [
    "synthetic-liquidity"
   ]
  },
  "models": [
   "sim-small"
  ],
  "residency": "ca-central",
  "lifecycleState": "shadow",
  "evaluation": null,
  "budgets": {
   "perHourUsd": 30,
   "perDayUsd": 400,
   "perTaskUsd": 5
  },
  "reviewDate": "2026-09-01",
  "nextMonitoringDate": "2027-03-01",
  "runtimeRef": {
   "kind": "SimProcess",
   "name": "treasury-forecast",
   "namespace": "agents"
  }
 }
];
