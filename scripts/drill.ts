// make drill: N governed+ungoverned runaway-loop pairs, plus the detector evaluation set. Writes impact.json (merge) and replay/events.json.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DrillResult, IncidentStage, StreamMessage } from '../contracts/types.ts';
import { DEFAULT_ACK_MS } from '../services/control/src/engine.ts';
import { startStack } from '../sim/stack.ts';
import { DRILLS, WARMUP_MS, WINDOW_MS, runDrill } from '../sim/drills.ts';
import { PRICE_ASSUMPTIONS, mergeImpact, pct } from './lib/impact.ts';

const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const runs = arg('runs', 20), evalRuns = arg('cases', 3);
const only = process.argv.includes('--no-write');
const command = `node scripts/drill.ts --runs ${runs}` + (evalRuns !== 3 ? ` --cases ${evalRuns}` : '');
const tmp = () => mkdtempSync(join(tmpdir(), 'rollcall-drill-'));
const r2 = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

/** Records the control SSE stream (with arrival timestamps) for the UI Replay mode. */
async function record(url: string, sink: (StreamMessage & { ts: number })[]): Promise<() => void> {
  const ac = new AbortController();
  const res = await fetch(`${url}/v1/stream`, { signal: ac.signal });
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    try { for await (const chunk of res.body!) { buf += dec.decode(chunk as Uint8Array, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); if (f.startsWith('data: ')) { const m = JSON.parse(f.slice(6)) as StreamMessage; sink.push({ ...m, ts: Date.now() }); } } } } catch { /* aborted */ }
  })();
  return () => ac.abort();
}

const t00 = Date.now();
console.log(`drill: ${runs} governed+ungoverned runaway-loop pairs, then detector set (${evalRuns} runs x 6 cases). Warmup ${WARMUP_MS} ms, window ${WINDOW_MS} ms each.`);

// ---- fleet snapshot (measured at steady state)
const snap = await startStack({ dataDir: tmp() });
await new Promise(r => setTimeout(r, 7000));
const sum = await snap.control.engine.summary();
const recent = snap.control.engine.eventsBetween(Date.now() - 5000, Date.now());
const fleet = {
  registered: sum.registered, running: sum.running, unregisteredRunning: sum.unregisteredRunning,
  byRisk: Object.fromEntries(['low', 'medium', 'high', 'critical'].map(k => [k, snap.control.registry.list().filter(a => a.riskRating === k).length])),
  byLifecycle: Object.fromEntries(['shadow', 'canary', 'production'].map(k => [k, snap.control.registry.list().filter(a => a.lifecycleState === k).length])),
  baselineCallsPerSec: r2(recent.length / 5, 1), baselineSpendPerMinUsd: r2(Object.values(sum.spendPerMinUsd).reduce((s, x) => s + x, 0), 4),
  states: sum.states,
};
await snap.close();
console.log('fleet', JSON.stringify({ ...fleet, states: undefined }));

// ---- A/B pairs
const gov: DrillResult[] = [], ung: DrillResult[] = [];
const replay: (StreamMessage & { ts: number })[] = [];
for (let i = 0; i < runs; i++) {
  const s = await startStack({ dataDir: tmp() });
  try {
    const stop = i === 0 ? await record(s.control.url, replay) : null;
    const g = await runDrill(s, 'runaway-loop', 'governed'); if (i === 0) stop?.();
    const u = await runDrill(s, 'runaway-loop', 'ungoverned');
    gov.push(g); ung.push(u);
    console.log(`pair ${i + 1}/${runs}: governed $${g.spendUsd} contain ${g.timeToContainMs} ms | ungoverned $${u.spendUsd} | ${Math.round((Date.now() - t00) / 1000)}s elapsed`);
  } finally { await s.close(); }
}

// ---- detector evaluation set
const cases: Record<string, { positive: boolean; runs: number; detected: number; hardContained: number; collateral: number; anyAlert: number }> = {};
for (const name of Object.keys(DRILLS)) {
  const c = cases[name] = { positive: DRILLS[name].positive, runs: 0, detected: 0, hardContained: 0, collateral: 0, anyAlert: 0 };
  for (let i = 0; i < evalRuns; i++) {
    const s = await startStack({ dataDir: tmp() });
    try {
      const r = await runDrill(s, name, 'governed', { windowMs: 9000 });
      c.runs++; c.detected += +r.detected; c.hardContained += +r.hardContained; c.collateral += r.collateralIncidents?.length ?? 0; c.anyAlert += +(r.detected || !!r.collateralIncidents?.length);
      console.log(`eval ${name} ${i + 1}/${evalRuns}: detected=${r.detected} hard=${r.hardContained} stages=${JSON.stringify(r.stages)}`);
    } finally { await s.close(); }
  }
}
let tp = 0, fp = 0, fn = 0, tn = 0, negRuns = 0, negAlertRuns = 0;
for (const c of Object.values(cases)) { if (!c.positive) { negRuns += c.runs; negAlertRuns += c.anyAlert; } if (c.positive) { tp += c.hardContained; fn += c.runs - c.hardContained; } else { fp += c.hardContained; tn += c.runs - c.hardContained; } }

// ---- aggregate
const samples = gov.map(g => g.timeToContainMs).filter((x): x is number => x !== null);
const stageP95: Partial<Record<IncidentStage, number>> = {};
for (const st of ['detected', 'throttled', 'paged', 'owner_ack', 'killed', 'proof'] as IncidentStage[]) {
  const xs = gov.map(g => g.stages[st]).filter((x): x is number => x !== undefined); if (xs.length) stageP95[st] = Math.round(pct(xs, 95));
}
const prot = gov.map((g, i) => ung[i].spendUsd - g.spendUsd);
const drill = {
  runs, windowMs: WINDOW_MS, warmupMs: WARMUP_MS, drill: 'runaway-loop', agentId: 'invoice-recon', command,
  spendProtectedUsd: { ungovernedMean: r2(mean(ung.map(u => u.spendUsd)), 6), governedMean: r2(mean(gov.map(g => g.spendUsd)), 6), protectedMean: r2(mean(prot), 6), protectedTotal: r2(prot.reduce((s, x) => s + x, 0), 6), perRunUsd: prot.map(x => r2(x, 6)) },
  callsMean: { ungoverned: r2(mean(ung.map(u => u.calls)), 1), governed: r2(mean(gov.map(g => g.calls)), 1) },
  timeToContainMs: { p50: Math.round(pct(samples, 50)), p95: Math.round(pct(samples, 95)), max: Math.max(...samples), samples, uncontained: gov.length - samples.length },
  stagesP95Ms: stageP95,
  simulatedOwnerAckMs: DEFAULT_ACK_MS,   // configured, part of timeToContainMs
  budgetsMs: { detect: 10_000, throttle: 5000, page: 5000, killAndProof: 10_000, containP95: 30_000 },
};
const detector = {
  tp, fp, fn, tn, precision: tp + fp ? r2(tp / (tp + fp), 3) : null, recall: tp + fn ? r2(tp / (tp + fn), 3) : null,
  definition: 'HARD containment only: "hard containment fired" (hard throttle or kill), n = runsPerCase per case. Positives: runaway-loop, ping-pong, scope-drift. Negatives: healthy-burst, slow-repeat, normal (any hard incident on any agent counts as a false positive).',
  runsPerCase: evalRuns, cases,
  // Soft alerts (one signal: gentle throttle, no page) on any agent during a negative case. Hard ones are the fp above; soft ones are not counted as false alarms.
  softOnNegatives: { runs: negRuns, runsWithAlert: negAlertRuns },
};
if (!only) {
  mergeImpact({ fleet, drill, detector, assumptions: await PRICE_ASSUMPTIONS() });
  mkdirSync('replay', { recursive: true });
  writeFileSync('replay/events.json', JSON.stringify(replay));
}
console.log(JSON.stringify({ drill: { ...drill, spendProtectedUsd: { ...drill.spendProtectedUsd, perRunUsd: undefined }, timeToContainMs: { ...drill.timeToContainMs, samples: undefined } }, detector }, null, 1));
console.log(`done in ${Math.round((Date.now() - t00) / 1000)} s`);
