// FIXTURE DATA: used only with ?fixture=1. Values are fake placeholders, never from a real run.
export const FIXTURE_IMPACT = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  gitSha: 'FIXTURE',
  environment: { note: 'fixture' },
  fleet: { registered: 12, running: 12, unregisteredRunning: 0 },
  drill: {
    runs: 20, windowMs: 8000,
    spendProtectedUsd: { ungovernedMean: 2.4, governedMean: 0.1, protectedMean: 2.3, protectedTotal: 46 },
    timeToContainMs: { p50: 2900, p95: 3400, max: 3600, samples: 20 },
    stagesP95Ms: { detected: 1200, throttled: 1400, paged: 1900, killed: 2900, proof: 3300 },
    command: 'make drill',
  },
  detector: { tp: 20, fp: 0, fn: 0, tn: 40, precision: 1, recall: 1, cases: 60 },
  bench: { governed: { p50: 0.4, p95: 0.9, p99: 1.6 }, direct: { p50: 0.2, p95: 0.4, p99: 0.7 }, overheadP99Ms: 0.9, throughputRps: 1200, command: 'make bench' },
  assumptions: {
    pricesUsdPerCall: { 'llm.complete': 0.04, 'ledger.read': 0.0005, 'kyc.lookup': 0.002, 'docs.search': 0.001, 'payments.transfer': 0.01, 'agent.call': 0.0 },
    hoursSavedPerTask: 0.1, loadedHourlyRateUsd: 80,
  },
};
