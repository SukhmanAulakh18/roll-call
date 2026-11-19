import type { ActionEvent, IncidentEvent } from '../../../contracts/types.ts';

export interface DetectorConfig {
  rateWindowMs: number;     // window for the "current" call rate
  baseWindowMs: number;     // longer window for the agent's own baseline
  minBaseSecs: number;      // baseline needs this many full seconds of history before signal 1 can fire
  rateRatio: number;        // signal 1: current rate / baseline median >= this ...
  rateFloor: number;        // ... AND current rate >= this absolute calls/s
  repeatWindowMs: number;   // signal 2a: same tool+argsHash
  repeatMin: number;
  cycleWindowMs: number;    // signal 2b: A2A cycle where every edge was called >= cycleMinEdge times
  cycleMinEdge: number;
  driftWindowMs: number;    // scope drift: OUT_OF_SCOPE denials
  driftHard: number;
}
export const DEFAULTS: DetectorConfig = {
  rateWindowMs: 2000, baseWindowMs: 60_000, minBaseSecs: 2, rateRatio: 5, rateFloor: 10,
  repeatWindowMs: 5000, repeatMin: 8, cycleWindowMs: 5000, cycleMinEdge: 3, driftWindowMs: 10_000, driftHard: 5,
};

export interface Finding {
  agentId: string;
  kind: 'runaway-loop' | 'ping-pong' | 'rate-spike' | 'repeat' | 'cycle' | 'scope-drift';
  level: 'soft' | 'hard';          // soft = one signal; hard = two independent signals (or sustained scope drift)
  autoKill: boolean;               // policy auto-kill applies to confirmed loops only
  baselineRate: number;
  signals: NonNullable<IncidentEvent['signals']>;
}

type Ev = { ts: number; sig: string; tool: string; target?: string; code: string };
type AgentState = { evs: Ev[]; buckets: Map<number, number>; firstSec: number };

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Pure and deterministic: same events + same `now` => same findings. Ungoverned (/v1/direct) events are not observed. */
export function createDetector(cfg: Partial<DetectorConfig> = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const agents = new Map<string, AgentState>();

  function observe(e: ActionEvent): void {
    if (!e.governed) return;
    let s = agents.get(e.agentId);
    const sec = Math.floor(e.ts / 1000);
    if (!s) { s = { evs: [], buckets: new Map(), firstSec: sec }; agents.set(e.agentId, s); }
    s.evs.push({ ts: e.ts, sig: e.tool + ':' + e.argsHash, tool: e.tool, target: e.targetAgentId, code: e.code });
    s.buckets.set(sec, (s.buckets.get(sec) ?? 0) + 1);
  }

  function cycleFor(agent: string, edges: Map<string, Set<string>>): string[] | undefined {
    const dfs = (node: string, path: string[]): string[] | undefined => {
      for (const nx of edges.get(node) ?? []) {
        if (nx === agent) return [...path, agent];
        if (!path.includes(nx) && path.length < 6) { const r = dfs(nx, [...path, nx]); if (r) return r; }
      }
      return undefined;
    };
    return dfs(agent, [agent]);
  }

  function evaluate(now: number): Finding[] {
    const maxAge = Math.max(c.repeatWindowMs, c.cycleWindowMs, c.driftWindowMs, c.rateWindowMs);
    const edgeCount = new Map<string, number>();
    for (const [id, s] of agents) {
      while (s.evs.length && s.evs[0].ts < now - maxAge) s.evs.shift();
      for (const k of s.buckets.keys()) if (k < Math.floor((now - c.baseWindowMs) / 1000)) s.buckets.delete(k);
      for (const e of s.evs) if (e.tool === 'agent.call' && e.target && e.ts >= now - c.cycleWindowMs) { const k = id + '>' + e.target; edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1); }
    }
    const edges = new Map<string, Set<string>>();
    for (const [k, n] of edgeCount) if (n >= c.cycleMinEdge) { const [a, b] = k.split('>'); (edges.get(a) ?? edges.set(a, new Set()).get(a)!).add(b); }

    const out: Finding[] = [];
    for (const [id, s] of agents) {
      const cur = s.evs.filter(e => e.ts > now - c.rateWindowMs).length / (c.rateWindowMs / 1000);
      // baseline: median calls/s over whole seconds before the rate window, skipping the (partial) first second
      const lo = Math.max(Math.floor((now - c.baseWindowMs) / 1000), s.firstSec + 1), hi = Math.floor((now - c.rateWindowMs) / 1000) - 1;
      const counts: number[] = []; for (let k = lo; k <= hi; k++) counts.push(s.buckets.get(k) ?? 0);
      const ready = counts.length >= c.minBaseSecs;
      const baseRate = Math.max(ready ? median(counts) : 1, 1);
      const ratio = cur / baseRate;
      const s1 = ready && ratio >= c.rateRatio && cur >= c.rateFloor;

      const reps = new Map<string, number>();
      for (const e of s.evs) if (e.ts >= now - c.repeatWindowMs) reps.set(e.sig, (reps.get(e.sig) ?? 0) + 1);
      const repeatCount = Math.max(0, ...reps.values());
      const cyc = cycleFor(id, edges);
      const s2 = repeatCount >= c.repeatMin || !!cyc;

      const drift = s.evs.filter(e => e.code === 'OUT_OF_SCOPE' && e.ts >= now - c.driftWindowMs);
      const signals: Finding['signals'] = {};
      if (s1) signals.rateRatio = Math.round(ratio * 10) / 10;
      if (repeatCount >= c.repeatMin) signals.repeatCount = repeatCount;
      if (cyc) signals.cycle = cyc;
      if (drift.length) signals.scopeDrift = drift[drift.length - 1].tool;
      const base = { agentId: id, baselineRate: baseRate, signals };

      if (s1 && s2) out.push({ ...base, kind: cyc ? 'ping-pong' : 'runaway-loop', level: 'hard', autoKill: true });
      else if (drift.length >= c.driftHard) out.push({ ...base, kind: 'scope-drift', level: 'hard', autoKill: false });
      else if (s1) out.push({ ...base, kind: 'rate-spike', level: 'soft', autoKill: false });
      else if (s2) out.push({ ...base, kind: cyc ? 'cycle' : 'repeat', level: 'soft', autoKill: false });
      else if (drift.length) out.push({ ...base, kind: 'scope-drift', level: 'soft', autoKill: false });
    }
    return out;
  }
  return { observe, evaluate };
}
export type Detector = ReturnType<typeof createDetector>;
