// Roll Call contracts. Single source of truth for every service, the UI and the tests.
// Change here first, then in code. Plain TS types only (Node native type stripping: no enums/namespaces).

export type RiskRating = 'low' | 'medium' | 'high' | 'critical';
export type LifecycleState = 'draft' | 'shadow' | 'canary' | 'production' | 'retired';
export type Origin = 'internal' | 'vendor' | 'open-source';
export type Verdict = 'allow' | 'deny' | 'throttle';

/** E-23-style inventory entry. Mirrors the AgentRecord CRD spec (deploy/k8s/agentrecord-crd.yaml). */
export interface AgentRecord {
  id: string;                    // DNS-safe, e.g. "aml-testgen"
  name: string;
  purpose: string;
  owner: { name: string; team: string; escalation: string }; // escalation = simulated pager target
  developer: string;
  origin: Origin;
  riskRating: RiskRating;
  version: string;
  deploymentDate: string;        // ISO date
  reviewer: string;
  approver: string;
  dataSources: string[];
  approvedUses: string[];        // plain-English
  limitations: string[];
  scopes: { tools: string[]; data: string[] }; // tools it may call through the gateway
  models: string[];              // allowed model ids
  residency: string;             // e.g. "ca-central"
  lifecycleState: LifecycleState;
  evaluation: { evidenceUrl: string; passed: boolean; date: string } | null;
  budgets: { perHourUsd: number; perDayUsd: number; perTaskUsd: number };
  reviewDate: string;
  nextMonitoringDate: string;
  runtimeRef: { kind: 'Deployment' | 'Agent' | 'Sandbox' | 'SimProcess'; name: string; namespace: string };
}

/** Request an agent sends to the gateway: POST /v1/act  (Authorization: Bearer <identity token>) */
export interface ActRequest {
  agentId: string;
  tool: string;                  // e.g. "ledger.read", "payments.transfer", "llm.complete", "agent.call"
  args: Record<string, unknown>;
  taskId?: string;
  model?: string;                // for llm.* tools
  targetAgentId?: string;        // for agent.call (A2A), enables cycle detection
}

/** Gateway reply. HTTP 200 allow, 403 deny, 429 throttle. */
export interface ActResponse {
  verdict: Verdict;
  reason: string;                // plain English, e.g. "Agent identity has been revoked (killed at 12:01:03)"
  code: string;                  // machine code, e.g. "REVOKED", "OUT_OF_SCOPE", "BUDGET_EXCEEDED", "THROTTLED", "UNREGISTERED", "STALE_POLICY_HIGH_RISK", "OK"
  receiptId: string;             // "<gatewayId>:<seq>"
  costUsd: number;
  latencyMs: number;             // gateway decision-path time, excludes the tool itself
  result?: unknown;
}

/** One event per gateway decision, pushed in batches to control: POST /v1/events {events: ActionEvent[]} */
export interface ActionEvent {
  ts: number;                    // epoch ms
  gatewayId: string;
  receiptId: string;
  agentId: string;
  tool: string;
  argsHash: string;              // sha256 of canonical JSON args, first 16 hex chars
  targetAgentId?: string;
  verdict: Verdict;
  code: string;
  costUsd: number;
  latencyMs: number;
  governed: boolean;             // false only for /v1/direct (ungoverned baseline)
}

/** Hash-chained receipt. One chain per gateway replica, JSONL at <dataDir>/receipts/<gatewayId>.jsonl */
export interface Receipt {
  seq: number;
  ts: number;
  gatewayId: string;
  agentId: string;
  tool: string;
  argsHash: string;
  verdict: Verdict;
  code: string;
  costUsd: number;
  prevHash: string;              // "GENESIS" for seq 0
  hash: string;                  // sha256(prevHash + canonicalJSON(receipt without hash))
}

/** Policy bundle the gateway pulls from control: GET /v1/bundle. Cached for static stability. */
export interface PolicyBundle {
  version: number;
  issuedAt: number;
  agents: Record<string, Pick<AgentRecord, 'id' | 'riskRating' | 'lifecycleState' | 'scopes' | 'models' | 'budgets'>>;
  revoked: Record<string, number>;           // agentId -> revokedAt (epoch ms)
  throttles: Record<string, { ratePerSec: number; hard: boolean; reason: string }>;
  highRiskTools: string[];                   // fail closed when bundle is stale
  prices: Record<string, number>;            // USD per call by tool (ASSUMPTION, editable)
  staleAfterMs: number;                      // after this with no fresh bundle, high-risk tools fail closed
}

export type IncidentStage = 'detected' | 'throttled' | 'paged' | 'owner_ack' | 'killed' | 'proof' | 'kill_unconfirmed' | 'resolved';

export interface IncidentEvent {
  incidentId: string;
  agentId: string;
  stage: IncidentStage;
  ts: number;
  message: string;               // plain English for the UI timeline
  signals?: { rateRatio?: number; repeatCount?: number; cycle?: string[]; scopeDrift?: string };
  proof?: { attemptedTool: string; verdict: Verdict; code: string; receiptId: string };
}

/** Server-sent events on control GET /v1/stream. `type` discriminates. */
export type StreamMessage =
  | { type: 'action'; data: ActionEvent }
  | { type: 'incident'; data: IncidentEvent }
  | { type: 'fleet'; data: FleetSummary }
  | { type: 'admission'; data: AdmissionResult & { workload: string; ts: number } };

export interface FleetSummary {
  registered: number;
  running: number;
  unregisteredRunning: number;   // must be 0
  spendPerMinUsd: Record<string, number>; // by agentId, measured
  states: Record<string, 'healthy' | 'alert' | 'throttled' | 'killed'>;
}

/** Admission: POST /v1/admission/review — accepts {workload} or a k8s AdmissionReview v1. */
export interface WorkloadSpec {
  name: string;
  namespace: string;
  labels: Record<string, string>;   // must carry "rollcall.dev/agent-id"
}
export interface AdmissionResult { allowed: boolean; reason: string; code: string }

export interface DrillResult {
  drill: string;                 // "runaway-loop" | "ping-pong" | "scope-drift" | "healthy-burst" | "slow-repeat" | ...
  mode: 'governed' | 'ungoverned';
  agentId: string;
  startedAt: number;             // epoch ms when the fault was injected (t0)
  durationMs: number;
  spendUsd: number;              // measured spend by the faulty agent during the drill window
  calls: number;
  stages: Partial<Record<IncidentStage, number>>; // ms since t0
  timeToContainMs: number | null; // ms from t0 to 'proof' (governed only)
  detected: boolean;
  hardContained: boolean;        // hard throttle or kill happened (negatives: on ANY agent, so collateral false positives count)
  collateralIncidents?: string[]; // other agents that raised an incident during the window
}
