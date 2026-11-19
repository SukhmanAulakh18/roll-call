import type { DrillResult, IncidentStage } from '../contracts/types.ts';
import type { ControlHandle } from '../services/control/src/app.ts';
import type { DrillMode, FaultKind, FleetControl } from '../services/control/src/runtime.ts';
import { sleep } from '../services/lib/http.ts';
import { POLICY } from '../services/control/src/lifecycle.ts';

export interface DrillEnv { control: ControlHandle; fleet: FleetControl }
export interface DrillOpts { warmupMs?: number; windowMs?: number }

/** name -> faulty agent and fault. `normal` injects nothing. */
export const DRILLS: Record<string, { agentId: string; fault?: FaultKind; positive: boolean }> = {
  'runaway-loop': { agentId: 'invoice-recon', fault: 'runaway-loop', positive: true },
  'ping-pong': { agentId: 'limits-checker', fault: 'ping-pong', positive: true },
  'scope-drift': { agentId: 'support-summarizer', fault: 'scope-drift', positive: true },
  'healthy-burst': { agentId: 'mortgage-docs', fault: 'healthy-burst', positive: false },
  'slow-repeat': { agentId: 'kyc-refresh', fault: 'slow-repeat', positive: false },
  'normal': { agentId: 'invoice-recon', positive: false },
};
export const WARMUP_MS = 5000, WINDOW_MS = 12_000;

/**
 * Reset, warm up (so every agent has a baseline), inject at t0, run a fixed window, then read the measured result back from control.
 * ungoverned = the faulty agent bypasses the gateway checks via /v1/direct; every other agent stays governed.
 */
export async function runDrill(env: DrillEnv, name: string, mode: DrillMode, o: DrillOpts = {}): Promise<DrillResult> {
  const d = DRILLS[name]; if (!d) throw new Error(`unknown drill '${name}'`);
  const windowMs = o.windowMs ?? WINDOW_MS;
  await env.control.reset();
  await sleep(o.warmupMs ?? WARMUP_MS);
  const t0 = Date.now();
  if (d.fault) await env.fleet.inject(d.agentId, d.fault, mode);
  await sleep(windowMs);
  await env.fleet.clear();
  await sleep(800);                                              // let gateways flush their last event batches and any in-flight kill finish
  const evs = env.control.engine.eventsBetween(t0, t0 + windowMs, d.agentId);
  const inc = env.control.engine.incidents().filter(e => e.ts >= t0);
  const mine = inc.filter(e => e.agentId === d.agentId);
  const stages: Partial<Record<IncidentStage, number>> = {};
  for (const e of mine) if (stages[e.stage] === undefined) stages[e.stage] = e.ts - t0;
  const hard = (id: string) => inc.some(e => e.agentId === id && (e.stage === 'paged' || e.stage === 'killed'));
  const others = [...new Set(inc.filter(e => e.agentId !== d.agentId && e.stage === 'detected').map(e => e.agentId))];
  return {
    drill: name, mode, agentId: d.agentId, startedAt: t0, durationMs: windowMs,
    spendUsd: Math.round(evs.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6, calls: evs.length,
    stages, timeToContainMs: mode === 'governed' ? stages.proof ?? null : null,
    detected: stages.detected !== undefined,
    hardContained: d.positive ? hard(d.agentId) : hard(d.agentId) || others.some(hard),
    collateralIncidents: others.length ? others : undefined,
  };
}

/** Release drills: a new version of invoice-recon runs as a canary. bad-release ships a regression (every 3rd call is malformed); good-release is the control case. */
export const RELEASE_DRILLS: Record<string, { agentId: string; fault?: 'errors' }> = {
  'bad-release': { agentId: 'invoice-recon', fault: 'errors' },
  'good-release': { agentId: 'invoice-recon' },
};

/** t0 = the moment the new version starts taking traffic (the fault starts there in bad-release). Runs until control settles the release or the deadline passes. */
export async function runReleaseDrill(env: DrillEnv, name: string, o: DrillOpts = {}): Promise<DrillResult> {
  const d = RELEASE_DRILLS[name]; if (!d) throw new Error(`unknown release drill '${name}'`);
  await env.control.reset();
  await sleep(o.warmupMs ?? WARMUP_MS);
  const rel = await env.control.releases.start(d.agentId, { fault: d.fault });
  const t0 = rel.startedAt, deadline = t0 + (o.windowMs ?? 4 * POLICY.canaryWindowMs);
  while (rel.state === 'canary' && Date.now() < deadline) await sleep(50);
  await sleep(800);                                              // let gateways flush their last event batches
  const end = rel.endedAt ?? Date.now();
  const stages: Partial<Record<IncidentStage, number>> = {};
  for (const e of env.control.releases.log) if (e.incidentId === rel.id && stages[e.stage] === undefined) stages[e.stage] = e.ts - t0;
  const evs = [rel.agentId, rel.variantId].flatMap(id => env.control.engine.eventsBetween(t0, end + 800, id));
  return {
    drill: name, mode: 'governed', agentId: d.agentId, startedAt: t0, durationMs: end - t0,
    spendUsd: Math.round(evs.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6, calls: evs.length,
    stages, timeToContainMs: null, detected: stages.detected !== undefined, hardContained: false,
    outcome: rel.state === 'canary' ? 'undecided' : rel.state, timeToRollbackMs: stages.rolled_back ?? null, gates: rel.result?.checks,
  };
}
