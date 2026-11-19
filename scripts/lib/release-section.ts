// The `release` section of impact.json: N bad-release and N good-release drills, each on a fresh stack. Nothing here is typed by hand.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DrillResult } from '../../contracts/types.ts';
import { POLICY } from '../../services/control/src/lifecycle.ts';
import { startStack } from '../../sim/stack.ts';
import { runReleaseDrill } from '../../sim/drills.ts';
import { pct } from './impact.ts';

export async function releaseSection(runs: number, command: string) {
  const bad: DrillResult[] = [], good: DrillResult[] = [];
  for (let i = 0; i < runs; i++) {
    for (const [name, into] of [['bad-release', bad], ['good-release', good]] as const) {
      const s = await startStack({ dataDir: mkdtempSync(join(tmpdir(), 'rollcall-release-')) });
      try {
        const r = await runReleaseDrill(s, name); into.push(r);
        console.log(`${name} ${i + 1}/${runs}: ${r.outcome}${r.timeToRollbackMs != null ? ` after ${r.timeToRollbackMs} ms` : ''} | gates failed: ${r.gates?.filter(g => !g.passed).map(g => g.name).join(', ') || 'none'}`);
      } finally { await s.close(); }
    }
  }
  const samples = bad.map(b => b.timeToRollbackMs).filter((x): x is number => x != null);
  return {
    command, agentId: 'invoice-recon',
    definition: 'bad-release: a new version of invoice-recon takes canary traffic; every 3rd call it sends is malformed and fails at the tool. good-release: the same canary with no fault. Time to rollback is measured from the moment the new version starts taking traffic (fault start) to the rolled_back event. One simulated fault kind (errors); latency and out-of-scope regressions are covered by the gate but not drilled.',
    badRuns: bad.length, goodRuns: good.length,
    autoRollbacks: bad.filter(b => b.outcome === 'rolled_back').length,          // bad releases that rolled back on their own
    badNotRolledBack: bad.filter(b => b.outcome !== 'rolled_back').length,       // escapes: promoted or undecided
    falseRollbacks: good.filter(g => g.outcome === 'rolled_back').length,        // good releases that were rolled back
    goodPromoted: good.filter(g => g.outcome === 'promoted').length,
    timeToRollbackMs: { p50: Math.round(pct(samples, 50)), p95: Math.round(pct(samples, 95)), max: Math.max(...samples), samples },
    policy: { ...POLICY },
  };
}
