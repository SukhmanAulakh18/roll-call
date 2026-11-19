// Single list of every number shown on the UI hero row and in the exec-pack briefs. exec-pack.ts renders from it,
// verify.ts and check-claim.ts check against it. Values are read from impact.json, never typed here.
import { readFileSync } from 'node:fs';

export const FORMATS: Record<string, (v: any) => string> = {
  int: v => String(Math.round(v)), ms: v => `${Math.round(v)} ms`, ms2: v => `${Number(v).toFixed(2)} ms`, ms4: v => `${Number(v).toFixed(4)} ms`,
  usd2: v => `$${Number(v).toFixed(2)}`, usd4: v => `$${Number(v).toFixed(4)}`, r2: v => Number(v).toFixed(2), r4: v => Number(v).toFixed(4),
  rps: v => `${Math.round(v)} req/s`, cores: v => `${v} cores`, reqs: v => `${v} requests`, conc: v => `concurrency ${v}`, cps: v => `${Number(v)} calls/s`, str: v => String(v), bool: v => String(v),
};
export const loadImpact = (file = 'impact.json'): any => JSON.parse(readFileSync(file, 'utf8'));
/** Dotted path; a key containing dots is written ["ledger.read"]. */
export const get = (o: any, path: string): any => (path.match(/\["[^"]+"\]|[^.[\]]+/g) ?? []).map(k => k.replace(/^\["|"\]$/g, '')).reduce((x: any, k: string) => x?.[k], o);

const CHAOS = (id: string, f: string) => `chaos.scenarios.${id}.measured.${f}`;
const scen = (id: string) => `impact.json chaos.scenarios.${id}`;
export interface Claim { claim: string; path: string; fmt: string; artifact: string; repro: string; in: string[]; ui?: string; value?: string; check?: string }
const CEO = 'exec-pack/CEO-brief.md', CTO = 'exec-pack/CTO-brief.md';
export const CLAIMS: Claim[] = [
  { claim: 'Agents registered', path: 'fleet.registered', fmt: 'int', artifact: 'impact.json fleet.registered', repro: 'make drill', in: [CEO], ui: 'What agents exist?' },
  { claim: 'Agents running without a record', path: 'fleet.unregisteredRunning', fmt: 'int', artifact: 'impact.json fleet.unregisteredRunning', repro: 'make drill', in: [CEO], ui: 'What agents exist?' },
  { claim: 'Runaway drills run (governed and ungoverned pairs)', path: 'drill.runs', fmt: 'int', artifact: 'impact.json drill.runs', repro: 'make drill', in: [CEO, CTO] },
  { claim: 'Time to contain a runaway, p95', path: 'drill.timeToContainMs.p95', fmt: 'ms', artifact: 'impact.json drill.timeToContainMs.p95', repro: 'make drill', in: [CEO, CTO], ui: 'Can I stop one, fast?' },
  { claim: 'Time to contain a runaway, p50', path: 'drill.timeToContainMs.p50', fmt: 'ms', artifact: 'impact.json drill.timeToContainMs.p50', repro: 'make drill', in: [CTO] },
  { claim: 'Time to hard throttle and page, p95 (the automatic part of containment)', path: 'drill.stagesP95Ms.paged', fmt: 'ms', artifact: 'impact.json drill.stagesP95Ms.paged', repro: 'make drill', in: [CEO, CTO], ui: 'Can I stop one, fast?' },
  { claim: 'Simulated owner acknowledgement delay included in time to contain (configured)', path: 'drill.simulatedOwnerAckMs', fmt: 'ms', artifact: 'impact.json drill.simulatedOwnerAckMs', repro: 'make drill', in: [CEO, CTO], ui: 'Can I stop one, fast?' },
  { claim: 'Time to detect, p95', path: 'drill.stagesP95Ms.detected', fmt: 'ms', artifact: 'impact.json drill.stagesP95Ms.detected', repro: 'make drill', in: [CTO] },
  { claim: 'Spend kept out per runaway drill, mean', path: 'drill.spendProtectedUsd.protectedMean', fmt: 'usd2', artifact: 'impact.json drill.spendProtectedUsd.protectedMean', repro: 'make drill', in: [CEO, CTO], ui: 'What does it cost?' },
  { claim: 'Spend kept out across all runaway drills', path: 'drill.spendProtectedUsd.protectedTotal', fmt: 'usd2', artifact: 'impact.json drill.spendProtectedUsd.protectedTotal', repro: 'make drill', in: [CEO], ui: 'What does it cost?' },
  { claim: 'Bad-release drills run (new version with a fault, canary)', path: 'release.badRuns', fmt: 'int', artifact: 'impact.json release.badRuns', repro: 'make drill-release', in: [CEO, CTO] },
  { claim: 'Bad releases rolled back automatically', path: 'release.autoRollbacks', fmt: 'int', artifact: 'impact.json release.autoRollbacks', repro: 'make drill-release', in: [CEO, CTO] },
  { claim: 'Time to roll back a bad release from fault start, p50', path: 'release.timeToRollbackMs.p50', fmt: 'ms', artifact: 'impact.json release.timeToRollbackMs.p50', repro: 'make drill-release', in: [CTO] },
  { claim: 'Time to roll back a bad release from fault start, p95', path: 'release.timeToRollbackMs.p95', fmt: 'ms', artifact: 'impact.json release.timeToRollbackMs.p95', repro: 'make drill-release', in: [CEO, CTO] },
  { claim: 'Good-release drills run (control case)', path: 'release.goodRuns', fmt: 'int', artifact: 'impact.json release.goodRuns', repro: 'make drill-release', in: [CTO] },
  { claim: 'Good releases promoted automatically', path: 'release.goodPromoted', fmt: 'int', artifact: 'impact.json release.goodPromoted', repro: 'make drill-release', in: [CTO] },
  { claim: 'False rollbacks of good releases', path: 'release.falseRollbacks', fmt: 'int', artifact: 'impact.json release.falseRollbacks', repro: 'make drill-release', in: [CEO, CTO] },
  { claim: 'Gateway decision overhead vs ungoverned, p99', path: 'bench.overheadP99Ms', fmt: 'ms2', artifact: 'impact.json bench.overheadP99Ms', repro: 'make bench', in: [CEO, CTO], ui: 'What does control cost in latency?' },
  { claim: 'Gateway decision path latency, p99', path: 'bench.governed.p99', fmt: 'ms4', artifact: 'impact.json bench.governed.p99', repro: 'make bench', in: [CTO] },
  { claim: 'Gateway throughput on the bench machine', path: 'bench.throughputRps', fmt: 'rps', artifact: 'impact.json bench.throughputRps', repro: 'make bench', in: [CTO] },
  { claim: 'Detector precision', path: 'detector.precision', fmt: 'r2', artifact: 'impact.json detector.precision', repro: 'make drill', in: [CEO, CTO], ui: 'Does the detector cry wolf?' },
  { claim: 'Detector recall', path: 'detector.recall', fmt: 'r2', artifact: 'impact.json detector.recall', repro: 'make drill', in: [CEO, CTO], ui: 'Does the detector cry wolf?' },
  { claim: 'Detector false alarms', path: 'detector.fp', fmt: 'int', artifact: 'impact.json detector.fp', repro: 'make drill', in: [CEO, CTO], ui: 'Does the detector cry wolf?' },
  { claim: 'Detector runs per case (n)', path: 'detector.runsPerCase', fmt: 'int', artifact: 'impact.json detector.runsPerCase', repro: 'make drill', in: [CEO, CTO], ui: 'Does the detector cry wolf?' },
  { claim: 'Negative-case runs that raised a soft or hard alert on some agent', path: 'detector.softOnNegatives.runsWithAlert', fmt: 'int', artifact: 'impact.json detector.softOnNegatives.runsWithAlert', repro: 'make drill', in: [CEO, CTO], ui: 'Does the detector cry wolf?' },
  { claim: 'Negative-case runs in total', path: 'detector.softOnNegatives.runs', fmt: 'int', artifact: 'impact.json detector.softOnNegatives.runs', repro: 'make drill', in: [CEO, CTO], ui: 'Does the detector cry wolf?' },
  { claim: 'End-to-end p99, governed (loopback, no TLS, single process)', path: 'bench.governed.endToEnd.p99', fmt: 'ms2', artifact: 'impact.json bench.governed.endToEnd.p99', repro: 'make bench', in: [CTO] },
  { claim: 'End-to-end p99, ungoverned (loopback, no TLS, single process)', path: 'bench.direct.endToEnd.p99', fmt: 'ms2', artifact: 'impact.json bench.direct.endToEnd.p99', repro: 'make bench', in: [CTO] },
  { claim: 'Detector missed runaways', path: 'detector.fn', fmt: 'int', artifact: 'impact.json detector.fn', repro: 'make drill', in: [CTO], ui: 'Does the detector cry wolf?' },
  { claim: 'Control stop: low-risk success ratio during outage', path: CHAOS('control-plane-stop', 'lowRiskDuringOutage.ratio'), fmt: 'r2', artifact: scen('control-plane-stop'), repro: 'make chaos', in: [CEO, CTO] },
  { claim: 'Control stop: time until gateway fails high-risk closed (MTTD)', path: CHAOS('control-plane-stop', 'mttdMs'), fmt: 'ms', artifact: scen('control-plane-stop'), repro: 'make chaos', in: [CTO] },
  { claim: 'Control stop: time to normal operation after restart (MTTR)', path: CHAOS('control-plane-stop', 'mttrMs'), fmt: 'ms', artifact: scen('control-plane-stop'), repro: 'make chaos', in: [CTO] },
  { claim: 'Control stop: high-risk calls denied after bundle went stale', path: CHAOS('control-plane-stop', 'highRiskAfterStaleDeniedRatio'), fmt: 'r2', artifact: scen('control-plane-stop'), repro: 'make chaos', in: [CTO] },
  { claim: 'Issuer down: latest first denial after the fault', path: CHAOS('identity-issuer-down', 'maxTimeToFirstDenialMs'), fmt: 'ms', artifact: scen('identity-issuer-down'), repro: 'make chaos', in: [CTO] },
  { claim: 'Issuer down: token TTL used in the game day', path: CHAOS('identity-issuer-down', 'ttlMs'), fmt: 'ms', artifact: scen('identity-issuer-down'), repro: 'make chaos', in: [CTO] },
  { claim: 'Issuer down: calls allowed on an expired token', path: CHAOS('identity-issuer-down', 'allowedAfterExpiryTotal'), fmt: 'int', artifact: scen('identity-issuer-down'), repro: 'make chaos', in: [CTO] },
  { claim: 'Gateway loss: error rate after losing 1 of 2 replicas, no failover', path: CHAOS('gateway-replica-loss', 'withoutFailover.errorRateAfterLoss'), fmt: 'r2', artifact: scen('gateway-replica-loss'), repro: 'make chaos', in: [CTO] },
  { claim: 'Gateway loss: error rate after losing 1 of 2 replicas, with failover', path: CHAOS('gateway-replica-loss', 'withFailover.errorRateAfterLoss'), fmt: 'r2', artifact: scen('gateway-replica-loss'), repro: 'make chaos', in: [CTO] },
  { claim: 'Bad bundle: lowest low-risk success ratio across variants', path: CHAOS('bad-policy-bundle', 'lowRiskSuccessMin'), fmt: 'r2', artifact: scen('bad-policy-bundle'), repro: 'make chaos', in: [CTO] },
  { claim: 'Bad bundle: last good bundle kept in every variant', path: CHAOS('bad-policy-bundle', 'versionKeptInAllVariants'), fmt: 'bool', artifact: scen('bad-policy-bundle'), repro: 'make chaos', in: [CTO] },
  { claim: 'Telemetry backlog: decision success ratio while events hang', path: CHAOS('telemetry-backlog', 'successDuringFault.ratio'), fmt: 'r2', artifact: scen('telemetry-backlog'), repro: 'make chaos', in: [CTO] },
  { claim: 'Telemetry backlog: events dropped (counted) at the buffer bound', path: CHAOS('telemetry-backlog', 'eventsDroppedFinal'), fmt: 'int', artifact: scen('telemetry-backlog'), repro: 'make chaos', in: [CTO] },
  { claim: 'Telemetry backlog: delivered plus dropped equals decisions', path: CHAOS('telemetry-backlog', 'accountingBalances'), fmt: 'bool', artifact: scen('telemetry-backlog'), repro: 'make chaos', in: [CTO] },
  { claim: 'Decision path p99 target (design budget)', path: 'bench.targetDecisionP99Ms', fmt: 'ms', artifact: 'impact.json bench.targetDecisionP99Ms; docs/latency-budget.md', repro: 'make bench', in: [CTO] },
  { claim: 'Containment p95 target (design budget)', path: 'drill.budgetsMs.containP95', fmt: 'ms', artifact: 'impact.json drill.budgetsMs.containP95; docs/latency-budget.md', repro: 'make drill', in: [CTO] },
  { claim: 'Detection target (design budget)', path: 'drill.budgetsMs.detect', fmt: 'ms', artifact: 'impact.json drill.budgetsMs.detect; docs/latency-budget.md', repro: 'make drill', in: [CTO] },
  { claim: 'Bench requests', path: 'bench.requests', fmt: 'reqs', artifact: 'impact.json bench.requests', repro: 'make bench', in: [CTO] },
  { claim: 'Bench concurrency', path: 'bench.concurrency', fmt: 'conc', artifact: 'impact.json bench.concurrency', repro: 'make bench', in: [CTO] },
  { claim: 'Cores on the machine that produced the numbers', path: 'environment.cores', fmt: 'cores', artifact: 'impact.json environment.cores', repro: 'make bench', in: [CTO] },
  { claim: 'Simulated fleet baseline call rate', path: 'fleet.baselineCallsPerSec', fmt: 'cps', artifact: 'impact.json fleet.baselineCallsPerSec', repro: 'make drill', in: [CTO] },
  { claim: 'Bundle staleness limit used in the game days', path: 'chaos.settings.bundleStaleAfterMs', fmt: 'ms', artifact: 'impact.json chaos.settings.bundleStaleAfterMs', repro: 'make chaos', in: [CTO] },
  { claim: 'Availability target, data plane (target, not measured)', path: '', fmt: 'str', value: '99.95%', artifact: 'docs/availability-model.md', repro: 'read the doc', in: [CTO], check: "grep -q '99.95%' docs/availability-model.md && grep -q '99.95%' exec-pack/CTO-brief.md" },
  { claim: 'Availability target, control plane (target, not measured)', path: '', fmt: 'str', value: '99.9%', artifact: 'docs/availability-model.md', repro: 'read the doc', in: [CTO], check: "grep -q '99.9%' docs/availability-model.md && grep -q '99.9%' exec-pack/CTO-brief.md" },
  { claim: 'OSFI E-23 effective date (as given to us; confirm against the guideline text)', path: '', fmt: 'str', value: 'May 1, 2027', artifact: 'exec-pack/e23-mapping.md', repro: 'read the doc', in: [CEO], check: "grep -q 'May 1, 2027' exec-pack/e23-mapping.md && grep -q 'May 1, 2027' exec-pack/CEO-brief.md" },
  { claim: 'Unregistered agent is refused at admission with a readable reason', path: '', fmt: 'str', value: 'pass', artifact: 'tests/acceptance/dod.test.ts (DoD4)', repro: 'npm run test:acceptance', in: [CEO], check: "node --test --test-name-pattern=DoD4 tests/acceptance/dod.test.ts" },
  { claim: 'Kill is verified by an independent probe that is denied', path: '', fmt: 'str', value: 'pass', artifact: 'tests/acceptance/dod.test.ts (DoD3)', repro: 'npm run test:acceptance', in: [CEO, CTO], check: "node --test --test-name-pattern=DoD3 tests/acceptance/dod.test.ts" },
  { claim: 'A bad release is rolled back automatically and a good release is promoted', path: '', fmt: 'str', value: 'pass', artifact: 'tests/acceptance/dod.test.ts (DoD8)', repro: 'npm run test:acceptance', in: [CEO, CTO], check: "node --test --test-name-pattern=DoD8 tests/acceptance/dod.test.ts" },
  { claim: 'Receipt tampering is detected at the exact record', path: '', fmt: 'str', value: 'pass', artifact: 'tests/acceptance/dod.test.ts (DoD7)', repro: 'npm run test:acceptance', in: [CEO, CTO], check: "node --test --test-name-pattern=DoD7 tests/acceptance/dod.test.ts" },
  { claim: 'Control down: low-risk continues, high-risk fails closed, no admissions', path: '', fmt: 'str', value: 'pass', artifact: 'tests/acceptance/dod.test.ts (DoD6)', repro: 'npm run test:acceptance', in: [CTO], check: "node --test --test-name-pattern=DoD6 tests/acceptance/dod.test.ts" },
  { claim: 'Malformed bundle is rejected and the last good bundle kept (unit test)', path: '', fmt: 'str', value: 'pass', artifact: 'services/gateway/src/gateway.test.ts', repro: 'npm test', in: [CTO], check: "node --test --test-name-pattern='malformed bundle' services/gateway/src/gateway.test.ts" },
];
export const shown = (c: Claim, impact: any): string => c.value ?? FORMATS[c.fmt](get(impact, c.path));

/** Price table rows for cost-model.md. These are ASSUMPTIONS copied from impact.json; the claim is that the doc matches the file. */
export const priceClaims = (impact: any): Claim[] => Object.keys(impact.assumptions?.pricesUsdPerCall ?? {}).map(k => ({
  claim: `ASSUMPTION: price per ${k.startsWith('llm.') && k !== 'llm.complete' ? '1k tokens' : 'call'} for ${k}`, path: `assumptions.pricesUsdPerCall["${k}"]`, fmt: 'usd4',
  artifact: 'impact.json assumptions.pricesUsdPerCall (from contracts/prices.ts)', repro: 'make drill', in: ['exec-pack/cost-model.md'],
}));
export const allClaims = (impact: any): Claim[] => [...CLAIMS, ...priceClaims(impact)];
export const claimFor = (path: string): Claim => allClaims(loadImpact()).find(c => c.path === path) ?? (() => { throw new Error(`no claim row for ${path}`); })();
