import type { DrillResult, IncidentStage } from '../contracts/types.ts';
import type { ControlHandle } from '../services/control/src/app.ts';
import type { DrillMode, FaultKind, FleetControl } from '../services/control/src/runtime.ts';
import { sleep } from '../services/lib/http.ts';

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
