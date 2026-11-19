// FIXTURE DATA: scripted and simulated stream messages used only with ?fixture=1. Not real measurements.
import type { ActionEvent, AgentRecord, DrillResult, FleetSummary, GateCheck, IncidentEvent, IncidentStage, LifecycleState, PromotionResult, StreamMessage } from '../../../contracts/types';
import { FIXTURE_AGENTS } from './FIXTURE_agents';
import { FIXTURE_IMPACT } from './FIXTURE_impact';

const ids = FIXTURE_AGENTS.map((a) => a.id);
const PRICE = FIXTURE_IMPACT.assumptions.pricesUsdPerCall as Record<string, number>;
export const fixtureCost = (tool: string) => PRICE[tool] ?? 0.0003;

// ---- a fixture hash chain (a cheap 256-bit mixer, NOT SHA-256; labelled FIXTURE wherever shown) ----
const mix = (str: string): string => {
  let out = '';
  for (let k = 0; k < 8; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1);
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 0x01000193); h ^= h >>> 13; }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
};
export interface FixtureReceipt { seq: number; prevHash: string; hash: string }
const chain = new Map<string, FixtureReceipt>();
let seq = 4800, tip = 'GENESIS';
export const nextSeq = () => ++seq;
export const fixtureReceipt = (id: string) => chain.get(id);
export const fixtureChainSize = () => chain.size;
/** Called by the store for every fixture governed action, in arrival order, so the chain matches what the ticker shows. */
export function chainAction(a: ActionEvent) {
  if (!a.governed || chain.has(a.receiptId)) return;
  const n = Number(a.receiptId.split(':')[1]);
  const prevHash = tip;
  const hash = mix(prevHash + JSON.stringify([n, a.ts, a.agentId, a.tool, a.argsHash, a.verdict, a.code, a.costUsd]));
  chain.set(a.receiptId, { seq: n, prevHash, hash }); tip = hash;
}
export function verifyFixtureChain(): { ok: boolean; count: number } {
  let prev = 'GENESIS';
  for (const r of chain.values()) { if (r.prevHash !== prev) return { ok: false, count: chain.size }; prev = r.hash; }
  return { ok: true, count: chain.size };
}

export const fixtureFleet = (states: FleetSummary['states'] = {}, spend: Record<string, number> = {}, ts?: number): StreamMessage => ({
  type: 'fleet', ts,
  data: {
    registered: 12, running: 12, unregisteredRunning: 0,
    spendPerMinUsd: Object.fromEntries(ids.map((id) => [id, spend[id] ?? 0])),
    states: Object.fromEntries(ids.map((id) => [id, states[id] ?? 'healthy'])) as FleetSummary['states'],
  },
} as StreamMessage);

function act(ts: number, agentId: string, tool: string, verdict: ActionEvent['verdict'], code: string, costUsd: number, governed: boolean, n = 0, target?: string): ActionEvent {
  const gw = governed ? 'gw-1' : 'direct';
  return { ts, gatewayId: gw, receiptId: `${gw}:${governed ? nextSeq() : 9000 + n}`, agentId, tool, argsHash: mix(`${agentId}${tool}${n}`).slice(0, 16), targetAgentId: target, verdict, code, costUsd, latencyMs: 0.3 + ((n * 7) % 9) / 10, governed };
}
export const fixtureProbe = (agentId: string, tool: string, ts: number) => act(ts, agentId, tool, 'deny', 'REVOKED', 0, true, 77);

const BASE_RATE: Record<string, number> = Object.fromEntries(ids.map((id, i) => [id, 0.5 + ((i * 5) % 7) * 0.22]));
let rng = 20260101;
const rand = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296);

/** Quiet history so Spend and Value have something on first paint. */
export function fixtureBaseline(now: number): StreamMessage[] {
  const out: StreamMessage[] = [];
  const recent: Record<string, number[]> = {};
  for (let s = 240; s > 0; s -= 1) {
    for (const a of FIXTURE_AGENTS) {
      if (rand() < BASE_RATE[a.id] * 0.5) {
        const tool = a.scopes.tools[Math.floor(rand() * a.scopes.tools.length)];
        const cost = fixtureCost(tool);
        out.push({ type: 'action', data: act(now - s * 1000, a.id, tool, 'allow', 'OK', cost, true, out.length, tool === 'agent.call' ? 'limits-checker' : undefined) });
        (recent[a.id] ??= []).push(s, cost);
      }
    }
    if (s % 3 === 0) {
      const spend: Record<string, number> = {};
      for (const [id, l] of Object.entries(recent)) { let t = 0; for (let i = 0; i < l.length; i += 2) if (l[i] - s <= 30 && l[i] >= s) t += l[i + 1]; spend[id] = t * 2; }
      out.push(fixtureFleet({}, spend, now - s * 1000));
    }
  }
  return out;
}

/** Live traffic: a few calls per agent every tick. Returns the stop function. */
export function startFixtureSim(ingest: (m: StreamMessage) => void, getRecent: () => ActionEvent[], getFleet: () => FleetSummary | null) {
  const tick = () => {
    const now = Date.now();
    for (const a of FIXTURE_AGENTS) {
      const st = getFleet()?.states?.[a.id];
      if (st === 'killed' || st === 'throttled') continue;
      if (rand() < BASE_RATE[a.id] * 0.5) {
        const tool = a.scopes.tools[Math.floor(rand() * a.scopes.tools.length)];
        const target = tool === 'agent.call' ? (a.id === 'credit-memo' ? 'limits-checker' : undefined) : undefined;
        ingest({ type: 'action', data: act(now, a.id, tool, 'allow', 'OK', fixtureCost(tool), true, Math.floor(now / 100) % 997, target) });
      }
    }
    const cur = getFleet();
    const spend: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    for (let i = getRecent().length - 1; i >= 0; i--) { const e = getRecent()[i]; if (e.ts < now - 30000) break; if (e.governed && spend[e.agentId] != null) spend[e.agentId] += e.costUsd * 2; }
    ingest(fixtureFleet(cur?.states, spend, now));
  };
  const h = setInterval(tick, 500);
  return () => clearInterval(h);
}

const inc = (id: string, agentId: string, stage: IncidentStage, ts: number, message: string, extra: Partial<IncidentEvent> = {}): StreamMessage => ({ type: 'incident', data: { incidentId: id, agentId, stage, ts, message, ...extra } });

const DRILL = {
  'runaway-loop': { agent: 'invoice-recon', tool: 'llm.complete', peer: undefined as string | undefined },
  'ping-pong': { agent: 'limits-checker', tool: 'agent.call', peer: 'credit-memo' },
  'scope-drift': { agent: 'support-summarizer', tool: 'payments.transfer', peer: undefined },
} as const;

/** One scripted drill. Messages carry absolute ts starting at t0; the caller plays them back in real time. */
export function fixtureDrill(name: string, mode: 'governed' | 'ungoverned', t0: number): { msgs: StreamMessage[]; result: DrillResult } {
  const d = DRILL[name as keyof typeof DRILL] ?? DRILL['runaway-loop'];
  const agentId = d.agent;
  const gov = mode === 'governed';
  const msgs: StreamMessage[] = [];
  let spend = 0, calls = 0;
  const end = gov ? 3600 : 6000;
  const detect = name === 'scope-drift' ? 700 : 1200;
  const stages = gov ? { detected: detect, throttled: detect + 200, paged: detect + 700, owner_ack: detect + 1200, killed: detect + 1700, proof: detect + 2100 } : {};
  const step = name === 'scope-drift' ? 250 : 100;
  for (let t = 0; t < end; t += step) {
    const stopped = gov && t >= stages.killed!;
    const thr = gov && t >= stages.throttled! && !stopped;
    const drift = name === 'scope-drift';
    const tool = name === 'ping-pong' ? (calls % 2 ? 'llm.complete' : 'agent.call') : d.tool;
    const cost = drift ? 0 : stopped || thr ? 0 : fixtureCost('llm.complete') * (name === 'ping-pong' ? 0.5 : 1);
    spend += cost; calls++;
    const who = name === 'ping-pong' && calls % 4 > 1 ? 'credit-memo' : agentId;
    const target = name === 'ping-pong' && tool === 'agent.call' ? (who === agentId ? 'credit-memo' : agentId) : undefined;
    msgs.push({ type: 'action', data: act(t0 + t, who, tool, stopped ? 'deny' : drift ? 'deny' : thr ? 'throttle' : 'allow', stopped ? 'REVOKED' : drift ? 'OUT_OF_SCOPE' : thr ? 'THROTTLED' : 'OK', cost, gov, 100 + calls, target) });
  }
  const id = `inc-fixture-${name}`;
  const sig = name === 'ping-pong' ? { cycle: ['limits-checker', 'credit-memo', 'limits-checker'], repeatCount: 24 } : name === 'scope-drift' ? { scopeDrift: 'payments.transfer' } : { rateRatio: 14, repeatCount: 30 };
  if (gov) {
    msgs.push(fixtureFleet({ [agentId]: 'alert' }, {}, t0 + stages.detected!), inc(id, agentId, 'detected', t0 + stages.detected!, name === 'ping-pong' ? 'limits-checker and credit-memo are calling each other in a loop.' : name === 'scope-drift' ? `${agentId} tried to call payments.transfer, which is not in its scope.` : `${agentId} is calling ${d.tool} far faster than its own normal and repeating itself.`, { signals: sig }));
    msgs.push(fixtureFleet({ [agentId]: 'throttled' }, {}, t0 + stages.throttled!), inc(id, agentId, 'throttled', t0 + stages.throttled!, 'Calls slowed to a trickle while a person is paged.'));
    msgs.push(inc(id, agentId, 'paged', t0 + stages.paged!, 'Owner paged (simulated).'));
    msgs.push(inc(id, agentId, 'owner_ack', t0 + stages.owner_ack!, 'Owner acknowledged the page (simulated).'));
    msgs.push(fixtureFleet({ [agentId]: 'killed' }, {}, t0 + stages.killed!), inc(id, agentId, 'killed', t0 + stages.killed!, 'Identity revoked. The agent can no longer act.'));
    const probe = fixtureProbe(agentId, d.tool === 'agent.call' ? 'llm.complete' : d.tool, t0 + stages.proof!);
    msgs.push({ type: 'action', data: probe }, inc(id, agentId, 'proof', t0 + stages.proof!, `Probe tried ${probe.tool} as ${agentId}: denied (REVOKED).`, { proof: { attemptedTool: probe.tool, verdict: 'deny', code: 'REVOKED', receiptId: probe.receiptId } }));
  }
  return { msgs, result: { drill: name, mode, agentId, startedAt: t0, durationMs: end, spendUsd: +spend.toFixed(2), calls, stages, timeToContainMs: gov ? stages.proof! : null, detected: gov, hardContained: gov } };
}

// ---- release drills and promotion (FIXTURE answers: same shape as the real API, invented numbers) ----
const FX = (checks: GateCheck[]) => checks;
const RELEASE_GATES = (bad: boolean): GateCheck[] => FX([
  { name: 'Lifecycle step', passed: true, detail: 'canary to production is the next step' },
  { name: 'Evaluation evidence', passed: true, detail: 'passing evaluation from 2026-05-20 (FIXTURE)' },
  { name: 'Drill regression', passed: true, detail: 'every runaway drill was contained (FIXTURE)' },
  { name: 'Attack suite', passed: true, detail: '0 of 9 attacks escaped containment (FIXTURE)' },
  { name: 'Canary analysis', passed: !bad, detail: bad ? 'error rate 33.3% on the new version vs 0.0% on stable (limit: stable + 5 points) (FIXTURE)' : 'error rate 0.0% vs 0.0% on stable and p99 within limits (FIXTURE)' },
  { name: 'Error budget', passed: true, detail: 'only 18 decisions on record (fewer than 20), so the budget is not exhausted (FIXTURE)' },
]);
export function fixtureRelease(name: string, t0: number): { msgs: StreamMessage[]; result: DrillResult } {
  const bad = name === 'bad-release', agentId = 'invoice-recon', id = `inc-fixture-${name}`;
  const decide = bad ? 3200 : 4600, end = decide + 400;
  const msgs: StreamMessage[] = [inc(id, agentId, 'canary_started', t0, "Canary started: v1.1.0 takes 50% of invoice-recon's traffic; v1.0.0 stays stable. (FIXTURE)")];
  if (bad) msgs.push(inc(id, agentId, 'detected', t0 + decide - 100, 'Canary analysis failed: error rate 33.3% on the new version vs 0.0% on stable. (FIXTURE)'), inc(id, agentId, 'rolled_back', t0 + decide, 'Rolled back automatically: canary v1.1.0 stopped, all traffic back on v1.0.0. The record stays at v1.0.0. (FIXTURE)'));
  else msgs.push(inc(id, agentId, 'promoted', t0 + decide, 'Promoted automatically: v1.1.0 passed all 6 gates and is now the production version of invoice-recon. (FIXTURE)'));
  const stages = bad ? { canary_started: 0, detected: decide - 100, rolled_back: decide } : { canary_started: 0, promoted: decide };
  return { msgs, result: { drill: name, mode: 'governed', agentId, startedAt: t0, durationMs: end, spendUsd: 0, calls: 20, stages, timeToContainMs: null, detected: bad, hardContained: false, outcome: bad ? 'rolled_back' : 'promoted', timeToRollbackMs: bad ? decide : null, gates: RELEASE_GATES(bad) } };
}
const NEXT: Partial<Record<LifecycleState, LifecycleState>> = { draft: 'shadow', shadow: 'canary', canary: 'production' };
/** Mirrors the shape of services/control/src/lifecycle.ts evaluatePromotion; only the evaluation and step gates are computed, the measured-evidence gates are labelled FIXTURE. */
export function fixturePromote(r: AgentRecord, to: LifecycleState): PromotionResult {
  const from = r.lifecycleState, checks: GateCheck[] = [];
  const stepOk = to === 'retired' ? from !== 'retired' : NEXT[from] === to;
  checks.push({ name: 'Lifecycle step', passed: stepOk, detail: stepOk ? `${from} to ${to} is the next step` : `${from} cannot move to ${to}; the only forward step from ${from} is ${NEXT[from] ?? 'none'}` });
  if (stepOk && (to === 'canary' || to === 'production')) {
    const e = r.evaluation;
    checks.push({ name: 'Evaluation evidence', passed: !!e?.passed, detail: !e ? `no evaluation evidence on file — ${to} needs a passing evaluation` : e.passed ? `passing evaluation from ${e.date}` : `the evaluation on file (${e.date}) failed — ${to} needs a passing evaluation` });
    if (to === 'production') checks.push(...RELEASE_GATES(false).slice(2));
  }
  const failed = checks.filter((c) => !c.passed);
  return { allowed: !failed.length, from, to, checks, reason: failed.length ? `Blocked: ${failed[0].detail}` : `Allowed: '${r.id}' may move from ${from} to ${to}; all ${checks.length} gates passed. (FIXTURE answer)` };
}
