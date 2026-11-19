import type { ActionEvent, FleetSummary, IncidentEvent, IncidentStage, StreamMessage, Verdict } from '../../../contracts/types.ts';
import { PROBE_ARGS_HASH } from '../../lib/hash.ts';
import { sleep } from '../../lib/http.ts';
import { createDetector } from './detector.ts';
import type { Detector, Finding } from './detector.ts';
import type { Registry } from './registry.ts';
import type { FleetControl } from './runtime.ts';

export interface EngineDeps {
  registry: Registry;
  clock: () => number;
  publish: (m: StreamMessage) => void;
  runtime: () => FleetControl | undefined;
  gateways: () => string[];
  acks: () => Record<string, { version: number; ts: number }>;   // bundle version each gateway last reported
  lastToken: (agentId: string) => { token: string; expiresAt: number } | undefined;
  mintToken: (agentId: string, ttlMs: number) => string;
  ackMs?: number;                                                // simulated owner auto-ack delay
  clearMs?: number;                                              // soft incidents resolve after this long without a finding
}
type Incident = { id: string; agentId: string; level: 'soft' | 'hard'; autoKill: boolean; lastFindingAt: number; pagedAt?: number; acked?: boolean; killP?: Promise<IncidentEvent> };

/** Independent probe: its own tiny HTTP path, shares no code with the gateway or the kill logic. */
async function probe(gw: string, token: string, agentId: string, tool: string, target?: string): Promise<{ verdict: Verdict; code: string; receiptId: string }> {
  const r = await fetch(gw + '/v1/act', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-rollcall-probe': '1' },
    body: JSON.stringify({ agentId, tool, args: { probe: true }, targetAgentId: target, taskId: 'kill-probe' }), signal: AbortSignal.timeout(2000),
  });
  const b = await r.json() as { verdict: Verdict; code: string; receiptId: string };
  return { verdict: b.verdict, code: b.code, receiptId: b.receiptId };
}

export function createEngine(d: EngineDeps) {
  const ackMs = d.ackMs ?? 1000, clearMs = d.clearMs ?? 5000;
  let detector: Detector = createDetector();
  let ledger: ActionEvent[] = [];
  let log: IncidentEvent[] = [];
  const open = new Map<string, Incident>();
  const pages: { ts: number; to: string; incidentId: string; simulated: true }[] = [];
  let seq = 0;

  const emit = (inc: Incident, stage: IncidentStage, message: string, extra: Partial<IncidentEvent> = {}): IncidentEvent => {
    const ev: IncidentEvent = { incidentId: inc.id, agentId: inc.agentId, stage, ts: d.clock(), message, ...extra };
    log.push(ev); if (log.length > 5000) log = log.slice(-4000);
    d.publish({ type: 'incident', data: ev });
    return ev;
  };

  function ingest(events: ActionEvent[]): void {
    for (const e of events) {
      ledger.push(e); detector.observe(e); d.publish({ type: 'action', data: e });
    }
    if (ledger.length > 150_000) ledger = ledger.slice(-100_000);
  }

  const describe = (f: Finding): string => {
    const p: string[] = [];
    if (f.signals.rateRatio) p.push(`call rate ${f.signals.rateRatio}x its own baseline`);
    if (f.signals.repeatCount) p.push(`the same call repeated ${f.signals.repeatCount} times in 5 s`);
    if (f.signals.cycle) p.push(`agent-to-agent cycle ${f.signals.cycle.join(' -> ')}`);
    if (f.signals.scopeDrift) p.push(`attempts to use '${f.signals.scopeDrift}', outside its declared scopes`);
    return `${f.kind} suspected: ${p.join('; ')}.`;
  };

  function throttle(inc: Incident, f: Finding, hard: boolean): void {
    const rate = hard ? Math.max(0.5, f.baselineRate * 0.25) : Math.max(2, f.baselineRate * 2);
    d.registry.setThrottle(inc.agentId, { ratePerSec: rate, hard, reason: f.kind });
    emit(inc, 'throttled', hard
      ? `Hard throttle: capped at ${rate.toFixed(1)} calls/s. Confirmed by ${f.kind === 'scope-drift' ? 'sustained out-of-scope attempts' : 'two independent signals'}.`
      : `Soft throttle: capped at ${rate.toFixed(1)} calls/s (2x its normal rate). One signal so far.`, { signals: f.signals });
  }

  function page(inc: Incident): void {
    const rec = d.registry.get(inc.agentId); const to = rec?.owner.escalation ?? 'unknown';
    inc.pagedAt = d.clock();
    pages.push({ ts: inc.pagedAt, to, incidentId: inc.id, simulated: true });
    emit(inc, 'paged', `Paged ${rec?.owner.name ?? 'owner'} via ${to}. SIMULATED pager: no real page was sent.`);
  }

  function handle(f: Finding, now: number): void {
    if (d.registry.isRevoked(f.agentId)) return;
    let inc = open.get(f.agentId);
    if (!inc) {
      inc = { id: `INC-${Date.now().toString(36)}-${++seq}`, agentId: f.agentId, level: 'soft', autoKill: false, lastFindingAt: now };
      open.set(f.agentId, inc);
      emit(inc, 'detected', describe(f), { signals: f.signals });
      if (f.level === 'soft' && f.kind !== 'scope-drift') throttle(inc, f, false);
    }
    inc.lastFindingAt = now;
    if (f.level === 'hard' && inc.level === 'soft') {
      inc.level = 'hard'; inc.autoKill = f.autoKill;
      emit(inc, 'detected', `Escalated: ${describe(f)}`, { signals: f.signals });
      throttle(inc, f, true); page(inc);
    }
  }

  function tick(now = d.clock()): void {
    const active = new Set<string>();
    for (const f of detector.evaluate(now)) { active.add(f.agentId); handle(f, now); }
    for (const inc of open.values()) {
      if (inc.killP) continue;
      if (inc.level === 'soft' && !active.has(inc.agentId) && now - inc.lastFindingAt >= clearMs) {
        d.registry.clearThrottle(inc.agentId); open.delete(inc.agentId);
        emit(inc, 'resolved', 'Signals cleared; throttle lifted.');
      } else if (inc.level === 'hard' && inc.pagedAt !== undefined && !inc.acked && now - inc.pagedAt >= ackMs) {
        inc.acked = true;
        emit(inc, 'owner_ack', `Owner acknowledged (auto-ack after ${ackMs} ms: SIMULATED).${inc.autoKill ? ' Policy "confirmed loop -> kill" proceeding.' : ' Agent stays quarantined until the owner decides.'}`);
        if (inc.autoKill) kill(inc.agentId, 'policy: confirmed loop').catch(() => {});
      }
    }
  }

  /** Revoke identity in the bundle, stop the runtime, then prove it with an independent probe. Returns the 'proof' event, or 'kill_unconfirmed' when the probe was not denied with REVOKED. */
  function kill(agentId: string, reason: string): Promise<IncidentEvent> {
    let inc = open.get(agentId);
    if (!inc) {
      inc = { id: `INC-${Date.now().toString(36)}-${++seq}`, agentId, level: 'hard', autoKill: false, lastFindingAt: d.clock() };
      open.set(agentId, inc);
      emit(inc, 'detected', `Manual kill requested: ${reason}.`);
    }
    if (inc.killP) return inc.killP;
    const incident = inc;
    incident.killP = (async () => {
      const now = d.clock();
      const last = [...ledger].reverse().find(e => e.agentId === agentId && e.governed && e.argsHash !== PROBE_ARGS_HASH);
      const tool = last?.tool ?? d.registry.get(agentId)?.scopes.tools[0] ?? 'ledger.read';
      const t = d.lastToken(agentId);
      const fresh = !(t && t.expiresAt - now > 3000);
      const token = fresh ? d.mintToken(agentId, 15_000) : t!.token; // the identity as it was before revocation
      d.registry.revoke(agentId, now);
      d.registry.clearThrottle(agentId);
      let stopped = 'no runtime attached';
      try {
        const done = await Promise.race([d.runtime()?.stop(agentId).then(() => true), sleep(2000).then(() => false)]);
        if (d.runtime()) stopped = done ? `runtime ${d.registry.get(agentId)?.runtimeRef.kind ?? ''} ${d.registry.get(agentId)?.runtimeRef.name ?? ''} stopped`.replace('  ', ' ') : 'runtime stop not confirmed after 2 s';
      } catch { stopped = 'runtime stop failed'; }
      const version = d.registry.version();
      emit(incident, 'killed', `Killed (${reason}): identity revoked, ${stopped}.`);
      // wait until every live gateway reports it holds the revocation, so the probe tests enforcement rather than propagation lag
      for (let i = 0; i < 80; i++) {
        const live = Object.values(d.acks()).filter(a => d.clock() - a.ts < 3000);
        if (live.length && live.every(a => a.version >= version)) break;
        await sleep(25);
      }
      const probes: { attemptedTool: string; verdict: Verdict; code: string; receiptId: string }[] = [];
      for (const gw of d.gateways()) {
        try { probes.push({ attemptedTool: tool, ...(await probe(gw, token, agentId, tool, last?.targetAgentId)) }); } catch { /* gateway unreachable: try the next */ }
      }
      // Proof means every reachable gateway answered deny/REVOKED. Anything else is not proof, whatever the bundle says.
      const bad = probes.find(p => !(p.verdict === 'deny' && p.code === 'REVOKED'));
      const proof = bad ?? probes[0];
      const who = fresh ? 'a fresh short-lived token (the old one was about to expire)' : "the agent's old token";
      const ev = probes.length && !bad
        ? emit(incident, 'proof', `Independent probe replayed ${tool} with ${who}: ${proof.verdict.toUpperCase()} (${proof.code}), receipt ${proof.receiptId}.`, { proof })
        : emit(incident, 'kill_unconfirmed', proof
          ? `KILL NOT PROVEN: the independent probe replayed ${tool} and got ${proof.verdict.toUpperCase()} (${proof.code}), not DENY (REVOKED), receipt ${proof.receiptId}. The agent may still be acting. Treat as live and escalate.`
          : 'KILL NOT PROVEN: the probe could not reach any gateway. The revocation is in the bundle but unverified. Treat the agent as live and escalate.', proof ? { proof } : {});
      if (ev.stage === 'kill_unconfirmed') incident.killP = undefined; // allow a retry
      return ev;
    })();
    return incident.killP;
  }

  function reset(): void {
    for (const inc of open.values()) emit(inc, 'resolved', 'Reset: fleet restored to its seeded state.');
    open.clear(); detector = createDetector(); ledger = [];
  }

  async function summary(now = d.clock()): Promise<FleetSummary> {
    let running: string[] = [];
    try { running = (await d.runtime()?.running()) ?? []; } catch { /* runtime unreachable: report 0 running */ }
    const spend: Record<string, number> = {};
    for (let i = ledger.length - 1; i >= 0 && ledger[i].ts > now - 70_000; i--) if (ledger[i].ts > now - 60_000) spend[ledger[i].agentId] = (spend[ledger[i].agentId] ?? 0) + ledger[i].costUsd;
    const states: FleetSummary['states'] = {};
    for (const r of d.registry.list()) {
      const th = d.registry.getThrottle(r.id);
      states[r.id] = d.registry.isRevoked(r.id) ? 'killed' : th ? 'throttled' : open.has(r.id) ? 'alert' : 'healthy';
    }
    return {
      registered: d.registry.list().length, running: running.length,
      unregisteredRunning: running.filter(id => !d.registry.get(id)).length,
      spendPerMinUsd: Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6])), states,
    };
  }

  return {
    ingest, tick, kill, reset, summary, pages,
    incidents: (agentId?: string): IncidentEvent[] => (agentId ? log.filter(e => e.agentId === agentId) : log),
    openIncidents: (agentId: string): IncidentEvent[] => (open.has(agentId) ? log.filter(e => e.incidentId === open.get(agentId)!.id) : []),
    /** Measured events in [from, to], probe replays excluded. */
    eventsBetween: (from: number, to: number, agentId?: string): ActionEvent[] =>
      ledger.filter(e => e.ts >= from && e.ts <= to && (!agentId || e.agentId === agentId) && e.argsHash !== PROBE_ARGS_HASH),
  };
}
export type Engine = ReturnType<typeof createEngine>;
