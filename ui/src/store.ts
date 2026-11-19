import { useSyncExternalStore } from 'react';
import type { ActionEvent, AdmissionResult, AgentRecord, DrillResult, FleetSummary, IncidentEvent, StreamMessage } from '../../contracts/types';
import { FIXTURE_IMPACT } from './fixtures/FIXTURE_impact';
import { FIXTURE_AGENTS } from './fixtures/FIXTURE_agents';
import { fixtureBaseline, fixtureDrill } from './fixtures/FIXTURE_stream';

export const FIXTURE = new URLSearchParams(location.search).get('fixture') === '1';
export type Impact = Record<string, any>;
export type Source = 'live' | 'fixture' | 'replay';
export interface Totals { cost: Record<string, number>; costTool: Record<string, number>; callsTool: Record<string, number>; tasks: Record<string, number>; first: number | null; last: number | null }
export interface DrillRun { name: string; ab: boolean; phase: 'ungoverned' | 'governed' | 'done' | 'error'; starts: { ungoverned?: number; governed?: number }; results: DrillResult[]; error?: string }
export interface S {
  source: Source; impact: Impact | null; impactErr: boolean; agents: AgentRecord[]; fleet: FleetSummary | null;
  actions: ActionEvent[]; incidents: IncidentEvent[]; admissions: (AdmissionResult & { workload: string; ts: number })[];
  totals: Totals; connected: boolean; updatedAt: number | null; drillRun: DrillRun | null;
  replay: { status: 'loading' | 'playing' | 'paused' | 'done' | 'empty'; pos: number; speed: number };
}

const emptyTotals = (): Totals => ({ cost: {}, costTool: {}, callsTool: {}, tasks: {}, first: null, last: null });
const initial = (source: Source): S => ({
  source, impact: null, impactErr: false, agents: [], fleet: null, actions: [], incidents: [], admissions: [], totals: emptyTotals(),
  connected: false, updatedAt: null, drillRun: null, replay: { status: 'loading', pos: 0, speed: 4 },
});

let state: S = initial(FIXTURE ? 'fixture' : 'live');
const subs = new Set<() => void>();
const set = (p: Partial<S> | ((s: S) => Partial<S>)) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; subs.forEach((f) => f()); };
export const useStore = <T,>(sel: (s: S) => T): T => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => sel(state));
export const getState = () => state;

// ---------- ingest (batched) ----------
let buf: StreamMessage[] = [];
let flushT: ReturnType<typeof setTimeout> | undefined;
export function ingest(m: StreamMessage) {
  buf.push(m);
  flushT ??= setTimeout(flush, 150);
}
function flush() {
  flushT = undefined;
  const msgs = buf; buf = [];
  if (!msgs.length) return;
  set((s) => {
    const p: Partial<S> = { updatedAt: Date.now() };
    let actions = s.actions, incidents = s.incidents, admissions = s.admissions, totals = s.totals;
    for (const m of msgs) {
      if (m.type === 'action') {
        const a = m.data;
        actions = actions.length >= 4000 ? [...actions.slice(-3000), a] : [...actions, a];
        if (a.governed) {
          if (totals === s.totals) totals = { ...totals, cost: { ...totals.cost }, costTool: { ...totals.costTool }, callsTool: { ...totals.callsTool }, tasks: { ...totals.tasks } };
          totals.cost[a.agentId] = (totals.cost[a.agentId] ?? 0) + a.costUsd;
          totals.costTool[a.tool] = (totals.costTool[a.tool] ?? 0) + a.costUsd;
          totals.callsTool[a.tool] = (totals.callsTool[a.tool] ?? 0) + 1;
          if (a.verdict === 'allow' && !/^(llm|agent)\./.test(a.tool)) totals.tasks[a.agentId] = (totals.tasks[a.agentId] ?? 0) + 1;
          totals.first = Math.min(totals.first ?? a.ts, a.ts); totals.last = Math.max(totals.last ?? a.ts, a.ts);
        }
      } else if (m.type === 'incident') {
        if (!incidents.some((i) => i.incidentId === m.data.incidentId && i.stage === m.data.stage)) incidents = [...incidents, m.data].slice(-300);
      } else if (m.type === 'fleet') p.fleet = m.data;
      else if (m.type === 'admission') admissions = [m.data, ...admissions].slice(0, 50);
    }
    return { ...p, actions, incidents, admissions, totals };
  });
}

// ---------- plumbing ----------
const getJSON = async (url: string): Promise<any> => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };
const postJSON = async (url: string, body?: unknown): Promise<any> => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => null);
  if (!r.ok && !(j && typeof j === 'object' && ('verdict' in j || 'allowed' in j))) throw new Error((j && (j.error || j.reason)) || `HTTP ${r.status}`);
  return j;
};
let es: EventSource | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
let replayTimer: ReturnType<typeof setInterval> | undefined;
const teardown = () => { es?.close(); es = null; timers.forEach(clearTimeout); timers = []; clearInterval(replayTimer); clearTimeout(flushT); flushT = undefined; buf = []; };
const msgTs = (m: StreamMessage): number | undefined => (m as any).ts ?? (m.data as any)?.ts;

export async function refreshImpact() {
  if (FIXTURE) return set({ impact: FIXTURE_IMPACT, updatedAt: Date.now() });
  const j = await getJSON('/v1/impact');
  set(j && typeof j === 'object' ? { impact: j, impactErr: false, updatedAt: Date.now() } : { impactErr: true });
}
async function loadAgents(urls: string[]) {
  if (FIXTURE) return set({ agents: FIXTURE_AGENTS });
  for (const u of urls) { const j = await getJSON(u); const l = Array.isArray(j) ? j : j?.agents; if (Array.isArray(l)) return set({ agents: l }); }
}

/** Switch between the live dashboard (or fixture) and the static replay. */
export async function start(mode: 'live' | 'replay') {
  teardown();
  set(initial(mode === 'replay' ? 'replay' : FIXTURE ? 'fixture' : 'live'));
  if (mode === 'replay') return startReplay();
  void refreshImpact(); void loadAgents(['/v1/agents']);
  if (FIXTURE) { fixtureBaseline(Date.now()).forEach(ingest); set({ connected: true }); return; }
  void getJSON('/v1/incidents').then((l) => Array.isArray(l) && l.forEach((data: IncidentEvent) => ingest({ type: 'incident', data })));
  es = new EventSource('/v1/stream');
  es.onopen = () => set({ connected: true });
  es.onerror = () => set({ connected: false });
  es.onmessage = (e) => { try { ingest(JSON.parse(e.data)); } catch { /* ignore malformed frame */ } };
  timers.push(setInterval(refreshImpact, 30000) as unknown as ReturnType<typeof setTimeout>);
}

// ---------- replay ----------
let items: { at: number; m: StreamMessage }[] = [];
let idx = 0, vt = 0;
async function startReplay() {
  let ev = await getJSON('/replay/events.json');
  if (!Array.isArray(ev) || !ev.length) ev = FIXTURE ? (() => { const t = Date.now(); return [...fixtureBaseline(t), ...fixtureDrill('runaway-loop', 'governed', t + 1000).msgs]; })() : [];
  if (!ev.length) return set({ replay: { ...state.replay, status: 'empty' } });
  let last = 0;
  items = (ev as StreamMessage[]).map((m) => ({ at: (last = msgTs(m) ?? last), m })).sort((a, b) => a.at - b.at);
  const imp = await getJSON('/replay/impact.json');
  if (imp) set({ impact: imp }); else if (FIXTURE) void refreshImpact(); else void refreshImpact();
  await loadAgents(['/replay/agents.json', '/v1/agents']);
  if (!state.agents.length) { // derive bare nodes from the recording
    const idsSeen = [...new Set(items.flatMap(({ m }) => (m.type === 'action' || m.type === 'incident' ? [m.data.agentId] : [])))];
    set({ agents: idsSeen.map((id) => ({ id, name: id, purpose: 'Not in the recording', owner: { name: 'unknown', team: 'unknown', escalation: '' }, riskRating: 'low', lifecycleState: 'production', scopes: { tools: [], data: [] }, models: [], residency: 'unknown', evaluation: null } as unknown as AgentRecord)) });
  }
  replayRestart();
}
function tick() {
  const s = state.replay.speed;
  vt += 100 * s;
  while (idx < items.length && items[idx].at <= vt) ingest(items[idx++].m);
  const span = items[items.length - 1].at - items[0].at || 1;
  set({ replay: { ...state.replay, pos: Math.min(1, (vt - items[0].at) / span), status: idx >= items.length ? 'done' : 'playing' } });
  if (idx >= items.length) clearInterval(replayTimer);
}
export function replayPlay() { clearInterval(replayTimer); if (idx >= items.length) return replayRestart(); set({ replay: { ...state.replay, status: 'playing' } }); replayTimer = setInterval(tick, 100); }
export function replayPause() { clearInterval(replayTimer); set({ replay: { ...state.replay, status: 'paused' } }); }
export function replaySpeed(speed: number) { set({ replay: { ...state.replay, speed } }); }
export function replayRestart() {
  clearInterval(replayTimer); idx = 0; vt = items[0].at - 1;
  set({ actions: [], incidents: [], fleet: null, totals: emptyTotals(), admissions: [] });
  replayPlay();
}

// ---------- actions the person can take ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function playAbs(msgs: StreamMessage[]) {
  const now = Date.now();
  for (const m of msgs) timers.push(setTimeout(() => ingest(m), Math.max(0, (msgTs(m) ?? now) - now)));
}

export async function runDrill(name: string, ab: boolean) {
  const modes = ab ? (['ungoverned', 'governed'] as const) : (['governed'] as const);
  const run: DrillRun = { name, ab, phase: modes[0], starts: {}, results: [] };
  set({ drillRun: run });
  try {
    for (const mode of modes) {
      const t0 = Date.now();
      run.starts[mode] = t0; run.phase = mode; set({ drillRun: { ...run } });
      let res: DrillResult;
      if (FIXTURE) { const f = fixtureDrill(name, mode, t0); playAbs(f.msgs); await sleep(f.result.durationMs + 300); res = f.result; }
      else res = await postJSON(`/v1/drills/${name}`, { mode });
      run.results = [...run.results, res]; set({ drillRun: { ...run } });
    }
    run.phase = 'done';
  } catch (e) { run.phase = 'error'; run.error = (e as Error).message; }
  set({ drillRun: { ...run } });
}

export async function resetDrills() {
  let note: string | undefined;
  if (!FIXTURE) { try { await postJSON('/v1/reset'); } catch (e) { note = `The server did not confirm a reset (${(e as Error).message}).`; } }
  timers.forEach(clearTimeout); timers = [];
  set({ drillRun: note ? { name: '', ab: false, phase: 'error', starts: {}, results: [], error: note } : null, incidents: [], actions: state.actions.filter((a) => !a.agentId.startsWith('__')) });
  if (FIXTURE) ingest({ type: 'fleet', data: (fixtureBaseline(Date.now())[0] as { type: 'fleet'; data: FleetSummary }).data });
}

export async function killAgent(id: string): Promise<IncidentEvent> {
  if (FIXTURE) {
    const t = Date.now();
    const proof = { attemptedTool: 'ledger.read', verdict: 'deny' as const, code: 'REVOKED', receiptId: 'gw-1:123' };
    const ev: IncidentEvent = { incidentId: `inc-fixture-kill-${id}`, agentId: id, stage: 'proof', ts: t, message: `Probe tried ledger.read as ${id}: denied (REVOKED).`, proof };
    ingest({ type: 'incident', data: { ...ev, stage: 'killed', message: 'Identity revoked.' } }); ingest({ type: 'incident', data: ev });
    ingest({ type: 'fleet', data: { ...(state.fleet as FleetSummary), states: { ...state.fleet!.states, [id]: 'killed' }, spendPerMinUsd: { ...state.fleet!.spendPerMinUsd, [id]: 0 } } });
    return ev;
  }
  const ev: IncidentEvent = await postJSON(`/v1/agents/${encodeURIComponent(id)}/kill`);
  ingest({ type: 'incident', data: ev });
  return ev;
}

export async function reviewAdmission(workload: { name: string; namespace: string; labels: Record<string, string> }): Promise<AdmissionResult> {
  if (FIXTURE) {
    const a = state.agents.find((x) => x.id === workload.labels['rollcall.dev/agent-id']);
    return !workload.labels['rollcall.dev/agent-id'] ? { allowed: false, code: 'NO_LABEL', reason: 'FIXTURE: this workload has no agent-id label, so nobody owns it.' }
      : !a ? { allowed: false, code: 'NO_RECORD', reason: 'FIXTURE: no registry record matches this agent id.' } : { allowed: true, code: 'OK', reason: 'FIXTURE: registered, owned and approved.' };
  }
  return postJSON('/v1/admission/review', { workload });
}

export async function verifyReceipts(): Promise<{ gateway: string; ok: boolean; count?: number; reason?: string }[]> {
  if (FIXTURE) return [{ gateway: 'gw-1 (FIXTURE)', ok: true, count: 0 }];
  const j = await getJSON('/v1/receipts/verify');
  if (!j) throw new Error('Could not reach /v1/receipts/verify');
  const list = Array.isArray(j) ? j : Object.entries(j.gateways ?? j).map(([gateway, v]) => ({ gateway, ...(v as object) }));
  return list.map((x: any) => ({ gateway: x.gateway ?? x.gatewayId ?? 'gateway', ok: !!x.ok, count: x.count, reason: x.reason }));
}
