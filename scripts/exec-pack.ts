// make exec-pack: renders exec-pack/ from impact.json and repo facts. No number below is typed by hand: every figure goes through a
// row in scripts/lib/claims.ts, and verification-matrix.csv carries the command that re-checks it. Also rewrites the "Measured"
// section of docs/availability-model.md from impact.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allClaims, claimFor, loadImpact, shown, get } from './lib/claims.ts';
import type { Claim } from './lib/claims.ts';

const I = loadImpact();
const OUT = 'exec-pack';
mkdirSync(OUT, { recursive: true });
const V = (path: string): string => shown(claimFor(path), I);          // throws if a number has no matrix row
const M = (id: string, f: string): string => V(`chaos.scenarios.${id}.measured.${f}`);
const stamp = `Numbers are from the last recorded run: impact.json generatedAt ${I.generatedAt}, gitSha ${I.gitSha}` + (I.chaos?.runAt ? ` (chaos section run at ${I.chaos.runAt})` : '') + '. generatedAt is the time of the latest merge into impact.json; sections run earlier keep their own measurements.';
const write = (name: string, body: string) => writeFileSync(join(OUT, name), body.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const SIM = 'The fleet, tools and model responses are simulated; the controls are real code. Results are from one laptop-class machine (see impact.json environment).';

// ---------------------------------------------------------------- CEO brief
write('CEO-brief.md', `# Roll Call: executive brief

${stamp} ${SIM}

## The problem: four questions about every AI agent

1. **What is running?** An inventory entry with owner, purpose, risk rating, approved uses and scopes exists for each agent, and unregistered workloads are refused.
2. **What is it doing and spending?** Every call goes through a gateway that records the decision and the cost.
3. **Is each action allowed, and is there a record?** Scope, budget, throttle and policy are checked on every call; each decision lands in a hash-chained receipt anyone can verify.
4. **Can we stop it, and can we prove it stopped?** A kill revokes the identity, stops the runtime and then replays the agent's last action from outside; it must be refused.

**Why now.** OSFI Guideline E-23 (model risk management) takes effect May 1, 2027. Our engineering reading is that it expects an accurate, evergreen model inventory with owners, approved uses and monitoring, including monitoring that the model stays within its approved scope. An agent fleet changes faster than a quarterly inventory refresh. This is an engineering interpretation, not compliance advice; the mapping is in \`e23-mapping.md\`.

## Three numbers

| What | Result | Field in impact.json |
|---|---|---|
| Time to contain a runaway agent, p95 (over ${V('drill.runs')} drills; includes a SIMULATED owner acknowledgement of ${V('drill.simulatedOwnerAckMs')}) | **${V('drill.timeToContainMs.p95')}** | \`drill.timeToContainMs.p95\` |
| Of which time to hard throttle and page, p95 (automatic, no human) | **${V('drill.stagesP95Ms.paged')}** | \`drill.stagesP95Ms.paged\` |
| Spend kept out per runaway drill, mean (${V('drill.spendProtectedUsd.protectedTotal')} across all drills) | **${V('drill.spendProtectedUsd.protectedMean')}** | \`drill.spendProtectedUsd.protectedMean\` |
| Extra end-to-end latency, difference of two p99s (governed minus ungoverned), loopback, no TLS, single process. Not production latency. Zero or negative means within run-to-run noise | **${V('bench.overheadP99Ms')}** | \`bench.overheadP99Ms\` |

**Release safety.** A new agent version runs as a canary beside the stable one and is judged on its own error rate and p99 against stable. In ${V('release.badRuns')} drills with a faulty new version, ${V('release.autoRollbacks')} were rolled back automatically (p95 ${V('release.timeToRollbackMs.p95')} from the first faulty call); ${V('release.falseRollbacks')} good releases were wrongly rolled back. Simulated fault, one agent, one fault kind. Promotion to production also needs passing evaluation evidence, drill regression, zero attack escapes and an unexhausted error budget (ADR-014).

Also measured: ${V('fleet.registered')} agents registered and ${V('fleet.unregisteredRunning')} running without a record; detector precision ${V('detector.precision')} and recall ${V('detector.recall')} for HARD containment with ${V('detector.fp')} hard false alarms, at ${V('detector.runsPerCase')} runs per case (small and scripted); soft alerts, which only throttle gently, appeared in ${V('detector.softOnNegatives.runsWithAlert')} of ${V('detector.softOnNegatives.runs')} negative-case runs; low-risk success ratio ${M('control-plane-stop', 'lowRiskDuringOutage.ratio')} while the control plane was stopped. Dollar amounts use price assumptions (\`cost-model.md\`), not real invoices.

## Top three risks and what we do about them

1. **The results are from simulation.** Agents are scripted and faults are injected by us. *Mitigation:* the 30-day pilot phase is read-only discovery on real traffic, so baselines come from real agents before any enforcement.
2. **Failing closed has a business cost.** If the control plane is unreachable, high-risk tools are refused after the policy goes stale. *Mitigation:* low-risk work continued in the game day and high-risk calls were denied on purpose; the staleness limit is a setting the risk owner chooses (\`docs/runbooks/control-plane-down.md\`).
3. **A false alarm throttles a healthy agent.** *Mitigation:* a single signal only soft-throttles; two independent signals are needed for hard containment, and the owner is paged first. Measured hard false alarms are ${V('detector.fp')} on the labelled set (${V('detector.runsPerCase')} runs per case, small and synthetic), and soft alerts appeared in ${V('detector.softOnNegatives.runsWithAlert')} of ${V('detector.softOnNegatives.runs')} negative-case runs; the pilot measures this on real traffic.

## Build, buy or extend

| Piece | Role | Position |
|---|---|---|
| agentgateway | Production data plane for agent, tool and model traffic | Extend: Roll Call's policy and receipts sit behind or beside it; our gateway is a reference |
| kagent | Kubernetes runtime for agents | Extend: agents run there, registered through the AgentRecord CRD |
| agent-sandbox | Isolated runtime for untrusted agent code | Extend: recommended runtime for agents that execute code |
| Microsoft Agent Governance Toolkit | Policy primitives | Extend: candidate policy adapter (ADR-002) |
| Langfuse | LLM traces | Extend: model-level traces; we record decisions, not prompts |

**What Roll Call adds is the control loop and the proof**: detection, graded response, a kill that is verified from outside, and receipts that show the record was not changed. These open-source projects each keep their own licence and are not affiliated with this work; the licence table is in \`CTO-brief.md\`.

## 30 / 60 / 90 day pilot

- **30 days, read-only discovery.** Register what exists; observe call patterns and spend; no enforcement. Output: a real inventory and real baselines.
- **60 days, enforce where it is safe.** Admission and budgets on low-risk agents; human approval on high-risk actions. Output: measured block rates and owner feedback.
- **90 days, evidence pack and decision.** Evidence aligned to the bank's own model inventory fields; then decide to expand or stop, using the numbers from the pilot, not these.

Verification: every figure here has a row in \`verification-matrix.csv\` with the command to reproduce it.
`);

// ---------------------------------------------------------------- CTO brief
const pkg = JSON.parse(readFileSync('package.json', 'utf8')), uipkg = JSON.parse(readFileSync('ui/package.json', 'utf8'));
const lic = (dir: string, name: string): string => { try { return JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).license ?? 'not stated'; } catch { return 'not installed here (check manually)'; } };
const licRows = (p: any, dir: string, kind: string) => Object.entries({ ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) }).map(([n, v]) => [`\`${n}\``, String(v), lic(dir, n), kind]);
const licenses = table(['Package', 'Version', 'Licence (from its package.json)', 'Where'], [
  ...licRows(pkg, '.', 'backend dev tooling only (type check)'),
  ...Object.entries(uipkg.dependencies ?? {}).map(([n, v]) => [`\`${n}\``, String(v), lic('ui', n), 'UI bundle']),
  ...Object.entries(uipkg.devDependencies ?? {}).map(([n, v]) => [`\`${n}\``, String(v), lic('ui', n), 'UI build tooling']),
]);
const scn = (id: string) => I.chaos.scenarios[id];
write('CTO-brief.md', `# Roll Call: technical brief

${stamp} ${SIM}

## Architecture (C4 summary)

Full diagrams: [\`docs/architecture.md\`](../docs/architecture.md). In short: a **control plane** (registry, identity issuer, policy bundle, incident engine, admission, kill and probe) and a **data plane** of gateway replicas that every agent call passes through (authN, revocation, scope, budget and throttle, policy, masking, forward, receipt). The backend has zero runtime dependencies (\`node:*\` only). Decisions are in \`docs/adr/\`.

## Release gates and auto-rollback

A version bump runs as a canary taking half of the agent's traffic under its own identity, so gateway events tell the two versions apart. Control judges it with \`evaluatePromotion\` (\`services/control/src/lifecycle.ts\`): evaluation evidence present, passed and fresh; drill regression; attack suite with zero escapes; canary error rate and p99 against stable; error budget not exhausted. Failing gates roll the canary back; passing ones promote it after the window. Design and thresholds: ADR-014.

| Measured over ${V('release.badRuns')} bad-release and ${V('release.goodRuns')} good-release drills (simulated fleet, one fault kind) | Result | Field |
|---|---|---|
| Bad releases rolled back automatically | **${V('release.autoRollbacks')}** of ${V('release.badRuns')} | \`release.autoRollbacks\` |
| Time to roll back from fault start, p50 / p95 | **${V('release.timeToRollbackMs.p50')}** / **${V('release.timeToRollbackMs.p95')}** | \`release.timeToRollbackMs\` |
| Good releases promoted automatically | **${V('release.goodPromoted')}** of ${V('release.goodRuns')} | \`release.goodPromoted\` |
| False rollbacks of good releases | **${V('release.falseRollbacks')}** | \`release.falseRollbacks\` |

Reproduce: \`make drill-release\`. The production design (Argo Rollouts calling the same gate) is in \`deploy/k8s/rollouts/\` and is not exercised in this repo's cluster.

## Non-functional requirements: target vs measured

${table(['Requirement', 'Target', 'Measured', 'Field'], [
  ['Gateway decision path p99 (in-process timer around the decision code only; excludes I/O and TLS)', `at most ${V('bench.targetDecisionP99Ms')}`, V('bench.governed.p99'), '`bench.governed.p99`'],
  ['End-to-end p99, governed (loopback, no TLS, single process)', 'not set', V('bench.governed.endToEnd.p99'), '`bench.governed.endToEnd.p99`'],
  ['End-to-end p99, ungoverned (same setup)', 'not set', V('bench.direct.endToEnd.p99'), '`bench.direct.endToEnd.p99`'],
  ['Overhead = difference of the two end-to-end p99s above (zero or negative = within run-to-run noise). Not production latency', 'not set', V('bench.overheadP99Ms'), '`bench.overheadP99Ms`'],
  ['Time to detect, p95', `at most ${V('drill.budgetsMs.detect')}`, V('drill.stagesP95Ms.detected'), '`drill.stagesP95Ms.detected`'],
  ['Time to contain, p95 (over ' + V('drill.runs') + ' drills)', `at most ${V('drill.budgetsMs.containP95')}`, V('drill.timeToContainMs.p95'), '`drill.timeToContainMs.p95`'],
  ['Time to hard throttle and page, p95 (automatic part)', 'not set', V('drill.stagesP95Ms.paged'), '`drill.stagesP95Ms.paged`'],
  ['Simulated owner acknowledgement included in time to contain', 'configured', V('drill.simulatedOwnerAckMs'), '`drill.simulatedOwnerAckMs`'],
  ['Time to contain, p50', 'not set', V('drill.timeToContainMs.p50'), '`drill.timeToContainMs.p50`'],
  ['Spend kept out per runaway drill, mean', 'not set', V('drill.spendProtectedUsd.protectedMean'), '`drill.spendProtectedUsd.protectedMean`'],
  ['Detector HARD false alarms / missed (n = ' + V('detector.runsPerCase') + ' runs per case)', 'none', `${V('detector.fp')} / ${V('detector.fn')}`, '`detector.fp`, `detector.fn`'],
  ['Negative-case runs with a soft alert on any agent (soft alerts are not counted as false alarms)', 'not set', `${V('detector.softOnNegatives.runsWithAlert')} of ${V('detector.softOnNegatives.runs')}`, '`detector.softOnNegatives`'],
  ['Data plane availability', '99.95% (target)', 'not measured as a percentage; see game days below', 'docs/availability-model.md'],
  ['Control plane availability', '99.9% (target)', 'not measured as a percentage; see game days below', 'docs/availability-model.md'],
])}

## Control plane and data plane, and static stability

Gateways act on a cached policy bundle and poll control in the background (ADR-004). If control is unreachable, low-risk calls continue; once the bundle is older than the staleness limit (${V('chaos.settings.bundleStaleAfterMs')} in these runs), high-risk tools are refused with \`STALE_POLICY_HIGH_RISK\`. No new identities or admissions are possible while control is down. Game days (\`make chaos\`, in-process, same machine as the benchmarks):

${table(['Game day', 'Result', 'Fields'], [
  ['Control plane stopped, then restarted', `Low-risk success ratio ${M('control-plane-stop', 'lowRiskDuringOutage.ratio')}; high-risk denied after the bundle went stale: ${M('control-plane-stop', 'highRiskAfterStaleDeniedRatio')}; gateway marked it stale (MTTD) ${M('control-plane-stop', 'mttdMs')} after the stop; normal operation (MTTR) ${M('control-plane-stop', 'mttrMs')} after restart; new identity and admission refused during the outage.`, '`chaos.scenarios.control-plane-stop`'],
  ['Identity issuer fails', `Token TTL in this test ${M('identity-issuer-down', 'ttlMs')}; latest first denial ${M('identity-issuer-down', 'maxTimeToFirstDenialMs')} after the fault; calls allowed on an expired token ${M('identity-issuer-down', 'allowedAfterExpiryTotal')}; agents recovered without a restart.`, '`chaos.scenarios.identity-issuer-down`'],
  ['One of two gateway replicas killed', `Error rate after the loss: ${M('gateway-replica-loss', 'withoutFailover.errorRateAfterLoss')} without agent-side failover, ${M('gateway-replica-loss', 'withFailover.errorRateAfterLoss')} with it. **Finding:** the fleet had no failover and sent about half its calls to the dead replica; the fix retries the other replica only on connection refused.`, '`chaos.scenarios.gateway-replica-loss`'],
  ['Malformed or rejected policy bundle', `Lowest low-risk success ratio across four variants ${M('bad-policy-bundle', 'lowRiskSuccessMin')}; last good bundle kept in every variant: ${M('bad-policy-bundle', 'versionKeptInAllVariants')}. **Finding:** a well-formed but wrong-shaped bundle used to replace the good one and break the gateway; the gateway now validates the shape (\`services/gateway/src/app.ts\`, unit test in \`gateway.test.ts\`).`, '`chaos.scenarios.bad-policy-bundle`'],
  ['Event endpoint hangs', `Decision success ratio ${M('telemetry-backlog', 'successDuringFault.ratio')} during the fault; ${M('telemetry-backlog', 'eventsDroppedFinal')} events dropped and counted at the buffer bound; delivered plus dropped equals decisions: ${M('telemetry-backlog', 'accountingBalances')}.`, '`chaos.scenarios.telemetry-backlog`'],
])}

Each game day records its hypothesis, steady state, blast radius, abort condition and recovery in impact.json. Limits: the faults are injected in-process (not Chaos Mesh on a cluster); the gateway close is graceful, not a crash; a revocation issued during a control outage cannot reach gateways (ADR-004, accepted limit).

## Failure modes

The qualitative analysis is [\`docs/FMEA.md\`](../docs/FMEA.md) (copy: \`FMEA.md\`). Each row names the make target that exercises it; rows marked "planned" have no test and are not claimed. Runbooks: \`docs/runbooks/\`. Latency and availability method: \`latency-budget.md\`, \`availability-model.md\`.

## Capacity note

The bench ran ${V('bench.requests')} at ${V('bench.concurrency')} on a machine with ${V('environment.cores')}, which also ran the load generator, the mock tools and control: ${V('bench.throughputRps')} through one gateway. The simulated fleet generates ${V('fleet.baselineCallsPerSec')}. This is a laptop-scale measurement, not a capacity plan. Production sizing needs a load test against a deployed gateway (the design names k6) and a decision on the production data plane (agentgateway, ADR-001). After one of two replicas dies, the survivor takes all the traffic; headroom per replica has not been measured.

## Licences of dependencies actually used

Read from the package manifests and installed packages. The backend has no runtime dependencies. Container base images and the Valkey image in \`deploy/compose\` are not listed; Valkey is planned, not used by the code (ADR-012). The open-source projects named in the CEO brief are design options and are not dependencies of this repository.

${licenses}
`);

// ---------------------------------------------------------------- cost model
const prices = I.assumptions.pricesUsdPerCall as Record<string, number>;
write('cost-model.md', `# Cost model

${stamp}

**ASSUMPTION.** Every price below is an illustrative assumption from \`contracts/prices.ts\`, copied into impact.json \`assumptions\`. They are not vendor prices. Change the file and re-run \`make drill\` to change them. Spend figures in the briefs are measured call counts multiplied by these prices.

${table(['Tool', 'Price (USD) ASSUMPTION', 'Unit'], Object.keys(prices).map(k => [`\`${k}\``, V(`assumptions.pricesUsdPerCall["${k}"]`), k.startsWith('llm.') && k !== 'llm.complete' ? 'per 1k tokens' : k === 'llm.complete' ? 'per call (pre-call estimate only)' : 'per call']))}

Model completions are recorded responses with pre-written token counts (\`sim/recorded-llm.json\`); the price of a completion is those counts times the per-1k rates.
`);

// ---------------------------------------------------------------- E-23 mapping
write('e23-mapping.md', `# E-23 mapping

**Engineering interpretation, not compliance advice.** OSFI Guideline E-23 is stated to take effect May 1, 2027. The themes below are our reading of what an accurate, evergreen model inventory with owners, approved uses and monitoring (including monitoring of scope) asks of an engineering team. Confirm every row against the guideline text with the bank's model risk and legal functions. Roll Call is a technical control set, not a model risk framework.

${table(['Theme', 'What we read it to need', 'Roll Call control', 'Test or make target'], [
  ['Inventory', 'Every agent has a current record: purpose, owner, risk rating, version, data sources, approved uses, limitations; nothing runs unlisted.', '`AgentRecord` (`contracts/types.ts`), registry (`services/control/src/registry.ts`), admission refuses unregistered workloads (`services/control/src/admission.ts`, `deploy/k8s/`)', '`make acceptance` (DoD4); `npm test` (admission rules); `deploy/k8s/admission-demo.out.txt`'],
  ['Lifecycle', 'Defined stages, evidence before promotion, controlled change.', '`lifecycleState` draft, shadow, canary, production, retired; production and canary need passing evaluation; shadow agents cannot use high-risk tools', '`npm test` (admission, gateway policy)'],
  ['Ownership', 'Named owner and escalation path; accountability for changes.', '`owner`, `reviewer`, `approver`, `escalation`; incidents page the owner and wait for acknowledgement (simulated pager)', '`make drill` (page and owner_ack stages)'],
  ['Monitoring, including approved scope', 'Ongoing monitoring against the approved use; detect drift from scope; review dates.', 'Tool and model scopes enforced per call; scope-drift detector; spend and rate baselines; `reviewDate`, `nextMonitoringDate`; hash-chained receipts', '`make drill` (scope-drift drill, detector counts); `make verify` (chain check)'],
  ['Third-party and vendor origin', 'Know whether an agent or model is internal, vendor or open source; carry vendor risk.', '`origin` field on every record. No vendor attestation or SBOM check is implemented (limit).', '`npm test` (record fields); no test for vendor assurance'],
  ['AI and ML specifics', 'Model and data provenance, evaluation evidence, limits of use, drift and misuse monitoring.', '`models` allow-list per agent, `evaluation` evidence, `dataSources`, `limitations`; recorded model responses in the demo. Bias, explainability and model validation are not implemented (limit).', '`npm test` (model not allowed); `make acceptance`'],
  ['Decommissioning', 'Retire cleanly; no residual access.', '`retired` state is refused at admission and by the gateway; kill revokes identity, stops the runtime and proves the agent is refused', '`make acceptance` (DoD3 kill with proof); `docs/runbooks/kill-and-verify.md`'],
])}

Pilot output for the bank's own inventory: a mapping of \`AgentRecord\` fields to the bank's model inventory fields is a pilot task (90-day phase in the CEO brief); it has not been done.
`);

// ---------------------------------------------------------------- threat model
const rb = (f: string) => `[${f}](../docs/runbooks/${f})`;
write('threat-model.md', `# Threat model: OWASP Top 10 for Agentic Applications 2026

**Note:** the ASI01 to ASI10 titles below are taken from secondary summaries and are pending reconciliation with the official OWASP text. Treat the titles and scope of each item as provisional.

Each row: the control in this repository, the test that exercises it (or "not implemented, limit"), and the runbook. ${SIM}

${table(['Item', 'Control in this repo', 'Test', 'Runbook'], [
  ['ASI01 Agent Goal Hijack', 'A hijacked goal is bounded rather than prevented: per-agent tool scopes (`services/gateway/src/policy.ts`), budgets, throttles, scope-drift detector (`services/control/src/detector.ts`). No prompt-level injection filter.', '`make drill` (scope-drift); `npm test` (gateway scope denies). Prompt-injection defence: not implemented, limit', rb('runaway-agent.md')],
  ['ASI02 Tool Misuse and Exploitation', 'Tool allow-list per agent, model allow-list, per-hour, per-day and per-task budgets, rate throttle, account-number masking, high-risk tools fail closed on stale policy (`policy.ts`, `services/gateway/src/app.ts`)', '`npm test` (gateway: scope, budget, throttle, masking); `make chaos` (control stop)', rb('runaway-agent.md')],
  ['ASI03 Identity and Privilege Abuse', 'Short-lived HMAC identity tokens with a SPIFFE-style subject, token-to-agent binding, revocation, retired agents refused (`services/control/src/identity.ts`). Demo secret is a dev default; SPIRE is the production design (ADR-005).', '`npm test` (identity); `make chaos` (issuer down: no call allowed on an expired token); `make acceptance` (DoD3)', rb('identity-issuer-down.md')],
  ['ASI04 Agentic Supply Chain Vulnerabilities', 'Admission refuses unregistered agents; `origin` recorded; backend has no runtime dependencies; lockfiles pinned. No signature, SBOM or tool-server attestation check at runtime.', '`make acceptance` (DoD4); signing and attestation of agents and tool servers: not implemented, limit', rb('bad-policy-bundle.md')],
  ['ASI05 Unexpected Code Execution', 'The demo tools are mocks and no tool executes code. For real agents that run code, the design recommends an isolated runtime (agent-sandbox). Nothing in this repo sandboxes execution.', 'not implemented, limit', rb('kill-and-verify.md')],
  ['ASI06 Memory and Context Poisoning', 'Declared `dataSources` per agent; receipts store an argument hash, not content. No memory store, retrieval filter or context provenance control.', 'not implemented, limit', rb('runaway-agent.md')],
  ['ASI07 Insecure Inter-Agent Communication', 'Agent-to-agent calls go through the same gateway, so they are authenticated, scoped, budgeted and receipted; the detector finds A2A cycles. No end-to-end message integrity between agents.', '`make drill` (ping-pong); `npm test` (detector cycle). Message-level integrity: not implemented, limit', rb('runaway-agent.md')],
  ['ASI08 Cascading Failures', 'Static stability with bounded staleness, event buffer bounded with drop counter, gateway failover in the fleet client, graded containment (soft throttle, hard throttle, kill)', '`make chaos` (five game days); `make acceptance` (DoD6)', rb('control-plane-down.md')],
  ['ASI09 Human-Agent Trust Exploitation', 'Kill is proven by an independent probe instead of the agent saying it stopped; owner acknowledgement step; the AML test-generation agent only enqueues for human approval. No interface-level provenance labelling of agent output.', '`make acceptance` (DoD3); interface protections against over-trust: not implemented, limit', rb('kill-and-verify.md')],
  ['ASI10 Rogue Agents', 'Admission refuses unregistered workloads, `unregisteredRunning` is measured, detector, kill with proof, tamper-evident receipts (`services/gateway/src/receipts.ts`). Receipts have no external anchor, so tail truncation is not detected (ADR-008).', '`make acceptance` (DoD3, DoD4, DoD7); `make verify` (tamper test)', rb('receipt-chain-broken.md')],
])}
`);

// ---------------------------------------------------------------- copies of the design docs (after the availability section is regenerated)
const chaosSection = (): string => {
  const c = I.chaos; if (!c) return 'pending `make chaos`\n';
  const f = (path: string) => `\`${path}\``;
  return `Source: impact.json \`chaos\` section, run at ${c.runAt} on commit ${I.gitSha} (impact.json generatedAt ${I.generatedAt}). Topology: ${c.topology}. Command: \`${c.command}\`. This section is regenerated by \`make exec-pack\`; do not edit it by hand.

These are event durations from game days, not availability percentages. The percentages in this document are targets; no percentage has been measured.

${table(['Measure', 'Value', 'Field'], [
  ['Bundle staleness limit', V('chaos.settings.bundleStaleAfterMs'), f('chaos.settings.bundleStaleAfterMs')],
  ['Control stopped: low-risk success ratio', M('control-plane-stop', 'lowRiskDuringOutage.ratio'), f('chaos.scenarios.control-plane-stop.measured.lowRiskDuringOutage.ratio')],
  ['Control stopped: MTTD (stop to first high-risk fail-closed denial)', M('control-plane-stop', 'mttdMs'), f('chaos.scenarios.control-plane-stop.measured.mttdMs')],
  ['Control stopped: MTTR (restart to first allowed high-risk call)', M('control-plane-stop', 'mttrMs'), f('chaos.scenarios.control-plane-stop.measured.mttrMs')],
  ['Control stopped: high-risk denied once stale', M('control-plane-stop', 'highRiskAfterStaleDeniedRatio'), f('chaos.scenarios.control-plane-stop.measured.highRiskAfterStaleDeniedRatio')],
  ['Issuer down: token TTL in the test', M('identity-issuer-down', 'ttlMs'), f('chaos.scenarios.identity-issuer-down.measured.ttlMs')],
  ['Issuer down: latest first denial after the fault', M('identity-issuer-down', 'maxTimeToFirstDenialMs'), f('chaos.scenarios.identity-issuer-down.measured.maxTimeToFirstDenialMs')],
  ['Issuer down: calls allowed on an expired token', M('identity-issuer-down', 'allowedAfterExpiryTotal'), f('chaos.scenarios.identity-issuer-down.measured.allowedAfterExpiryTotal')],
  ['Gateway loss (1 of 2): error rate without failover', M('gateway-replica-loss', 'withoutFailover.errorRateAfterLoss'), f('chaos.scenarios.gateway-replica-loss.measured.withoutFailover.errorRateAfterLoss')],
  ['Gateway loss (1 of 2): error rate with failover', M('gateway-replica-loss', 'withFailover.errorRateAfterLoss'), f('chaos.scenarios.gateway-replica-loss.measured.withFailover.errorRateAfterLoss')],
  ['Bad bundle: lowest low-risk success ratio', M('bad-policy-bundle', 'lowRiskSuccessMin'), f('chaos.scenarios.bad-policy-bundle.measured.lowRiskSuccessMin')],
  ['Bad bundle: last good bundle kept in every variant', M('bad-policy-bundle', 'versionKeptInAllVariants'), f('chaos.scenarios.bad-policy-bundle.measured.versionKeptInAllVariants')],
  ['Event endpoint hung: decision success ratio', M('telemetry-backlog', 'successDuringFault.ratio'), f('chaos.scenarios.telemetry-backlog.measured.successDuringFault.ratio')],
  ['Event endpoint hung: events dropped and counted', M('telemetry-backlog', 'eventsDroppedFinal'), f('chaos.scenarios.telemetry-backlog.measured.eventsDroppedFinal')],
])}

Hypotheses that held: ${Object.values(c.scenarios).filter((s: any) => s.hypothesisHeld).map((s: any) => s.id).join(', ') || 'none'}. Not held or aborted: ${Object.values(c.scenarios).filter((s: any) => !s.hypothesisHeld).map((s: any) => s.id).join(', ') || 'none'}.

Findings from the game days:
- The simulated fleet had no gateway failover (the without-failover run above is that behaviour). It now retries the next replica on connection refused only, so a request that reached a replica is never repeated.
- A bundle that was valid JSON but the wrong shape replaced the cached bundle in the gateway. It is now validated and rejected, and the last good bundle is kept (\`rollcall_gateway_bundles_rejected_total\`).

Limits: in-process faults on one machine; graceful gateway close; the gateway and control share a clock; replicas share the same tools service; no network partition test.
`;
};
const AV = 'docs/availability-model.md';
const av = readFileSync(AV, 'utf8'), head = '## Measured (from `make chaos`)';
writeFileSync(AV, av.slice(0, av.indexOf(head)) + head + '\n\n' + chaosSection());
for (const f of ['latency-budget.md', 'availability-model.md', 'FMEA.md']) copyFileSync(join('docs', f), join(OUT, f));

// ---------------------------------------------------------------- verification matrix
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const rows = allClaims(I).map((c: Claim) => {
  const value = shown(c, I);
  const check = c.check ?? `node scripts/lib/check-claim.ts '${c.path}' ${c.fmt} ${c.in.join(' ')}`;
  return [c.claim, value, c.artifact, c.repro, check].map(q).join(',');
});
write('verification-matrix.csv', ['claim,value,evidence_artifact,reproduce_command,check_command', ...rows].join('\n'));
void get; void existsSync; void readdirSync;
console.log(`exec-pack: wrote ${readdirSync(OUT).length} files, ${rows.length} matrix rows; availability-model.md Measured section regenerated`);
