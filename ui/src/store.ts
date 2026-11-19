import { useSyncExternalStore } from 'react';
import type { ActionEvent, AdmissionResult, AgentRecord, DrillResult, FleetSummary, IncidentEvent, LifecycleState, PromotionResult, StreamMessage } from '../../contracts/types';
import { FIXTURE_IMPACT } from './fixtures/FIXTURE_impact';
import { FIXTURE_AGENTS } from './fixtures/FIXTURE_agents';
import { admit, checkRecord } from '../../services/control/src/admission.ts';
import { evaluatePromotion } from '../../services/control/src/lifecycle.ts';
import { chainAction, fixtureBaseline, fixtureDrill, fixtureFleet, fixtureProbe, fixturePromote, fixtureRelease, startFixtureSim, verifyFixtureChain } from './fixtures/FIXTURE_stream';

export const FIXTURE = new URLSearchParams(location.search).get('fixture') === '1';
export type Impact = Record<string, any>;
export type Source = 'live' | 'fixture' | 'replay' | 'recorded';
/** Static GitHub Pages build: no backend exists, everything is driven by the recorded run. */
export const REPLAY_ONLY = import.meta.env.VITE_REPLAY_ONLY === '1';
export const NEEDS_LIVE = 'Live in `make demo`: this needs the running backend, which the static site does not have.';
export interface Totals { cost: Record<string, number>; costTool: Record<string, number>; callsTool: Record<string, number>; tasks: Record<string, number>; first: number | null; last: number | null }
export interface DrillRun { name: string; ab: boolean; phase: 'ungoverned' | 'governed' | 'done' | 'error'; starts: { ungoverned?: number; governed?: number }; results: DrillResult[]; error?: string }
export interface S {
  source: Source; impact: Impact | null; impactErr: boolean; agents: AgentRecord[]; fleet: FleetSummary | null;
  actions: ActionEvent[]; incidents: IncidentEvent[]; admissions: (AdmissionResult & { workload: string; ts: number })[];
  totals: Totals; spendHist: Record<string, number[]>; fleetHist: { t: number; total: number }[]; connected: boolean; updatedAt: number | null; drillRun: DrillRun | null;
  /** last time each agent answered the roll: any governed or direct call, or a fleet heartbeat that did not report it stopped. */
  beat: Record<string, number>;
  replay: { status: 'loading' | 'playing' | 'paused' | 'done' | 'empty'; pos: number; speed: number; marks: { pos: number; stage: string; agentId: string }[]; startTs: number; spanMs: number };
}

const emptyTotals = (): Totals => ({ cost: {}, costTool: {}, callsTool: {}, tasks: {}, first: null, last: null });
const initial = (source: Source): S => ({
  source, impact: null, impactErr: false, agents: [], fleet: null, actions: [], incidents: [], admissions: [], totals: emptyTotals(), spendHist: {}, fleetHist: [],
  connected: false, updatedAt: null, drillRun: null, beat: {}, replay: { status: 'loading', pos: 0, speed: 4, marks: [], startTs: 0, spanMs: 0 },
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
  if (FIXTURE && m.type === 'action') chainAction(m.data);
  buf.push(m);
  flushT ??= setTimeout(flush, 150);
}
function flush() {
  flushT = undefined;
  const msgs = buf; buf = [];
  if (!msgs.length) return;
  set((s) => {
    const p: Partial<S> = { updatedAt: Date.now() };
    const beat = { ...s.beat }; const nowT = Date.now();
    let actions = s.actions, incidents = s.incidents, admissions = s.admissions, totals = s.totals, spendHist = s.spendHist, fleetHist = s.fleetHist;
    for (const m of msgs) {
      if (m.type === 'action') {
        const a = m.data; beat[a.agentId] = nowT;
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
      } else if (m.type === 'fleet') {
        p.fleet = m.data;
        for (const [id, st] of Object.entries(m.data.states ?? {})) if (st !== 'killed') beat[id] = nowT;
        spendHist = { ...spendHist };
        for (const [id, v] of Object.entries(m.data.spendPerMinUsd ?? {})) spendHist[id] = [...(spendHist[id] ?? []).slice(-59), v];
        fleetHist = [...fleetHist.slice(-119), { t: msgTs(m) ?? Date.now(), total: Object.values(m.data.spendPerMinUsd ?? {}).reduce((a, b) => a + b, 0) }];
      }
      else if (m.type === 'admission') admissions = [m.data, ...admissions].slice(0, 50);
    }
    return { ...p, actions, incidents, admissions, totals, spendHist, fleetHist, beat };
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
let stopSim: (() => void) | undefined;
let timers: ReturnType<typeof setTimeout>[] = [];
let replayTimer: ReturnType<typeof setInterval> | undefined;
const teardown = () => { stopSim?.(); stopSim = undefined; es?.close(); es = null; timers.forEach(clearTimeout); timers = []; clearInterval(replayTimer); clearTimeout(flushT); flushT = undefined; buf = []; };
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
let gen = 0;
export async function start(mode: 'live' | 'replay') {
  teardown(); const my = ++gen;
  set(initial(mode === 'replay' ? 'replay' : FIXTURE ? 'fixture' : 'live'));
  if (mode === 'replay') return startReplay();
  if (!FIXTURE && (REPLAY_ONLY || !(await getJSON('/v1/agents')))) return my === gen ? startRecorded() : undefined;
  if (my !== gen) return; // no backend: recorded data only
  void refreshImpact(); void loadAgents(['/v1/agents']);
  if (FIXTURE) { fixtureBaseline(Date.now()).forEach(ingest); set({ connected: true }); stopSim = startFixtureSim(ingest, () => state.actions, () => state.fleet); return; }
  void getJSON('/v1/incidents').then((l) => Array.isArray(l) && l.forEach((data: IncidentEvent) => ingest({ type: 'incident', data })));
  es = new EventSource('/v1/stream');
  es.onopen = () => set({ connected: true });
  es.onerror = () => set({ connected: false });
  es.onmessage = (e) => { try { ingest(JSON.parse(e.data)); } catch { /* ignore malformed frame */ } };
  timers.push(setInterval(refreshImpact, 30000) as unknown as ReturnType<typeof setTimeout>);
}


// ---------- recorded mode (static site): the recording, looped at real speed, stands in for the live stream ----------
let rec: { at: number; m: StreamMessage }[] = [];
let recT0 = 0, recSpan = 0;
const shiftMsg = (m: StreamMessage, d: number, tag: string): StreamMessage => {
  const c: any = JSON.parse(JSON.stringify(m));
  if (typeof c.ts === 'number') c.ts += d;
  if (c.data && typeof c.data.ts === 'number') c.data.ts += d;
  if (m.type === 'incident') c.data.incidentId = `${c.data.incidentId}-${tag}`;
  return c;
};
function playRec(shift: number, tag: string) { for (const { at, m } of rec) timers.push(setTimeout(() => ingest(shiftMsg(m, shift, tag)), Math.max(0, at + shift - Date.now()))); }
function loopRec(n: number) { playRec(Date.now() - recT0, `L${n}`); timers.push(setTimeout(() => loopRec(n + 1), recSpan + 1500)); }
async function startRecorded() {
  set({ source: 'recorded' });
  const b = import.meta.env.BASE_URL;
  const [ev, imp, ag] = await Promise.all([getJSON(`${b}replay/events.json`), getJSON(`${b}replay/impact.json`), getJSON(`${b}replay/agents.json`)]);
  set({ impact: imp ?? null, impactErr: !imp, agents: Array.isArray(ag) ? ag : [], updatedAt: Date.now() });
  if (!Array.isArray(ev) || !ev.length) return;
  let last = 0;
  rec = (ev as StreamMessage[]).map((m) => ({ at: (last = msgTs(m) ?? last), m })).sort((a, c) => a.at - c.at);
  recT0 = rec[0].at; recSpan = rec[rec.length - 1].at - recT0;
  rec = rec.map((x) => ({ ...x, at: x.at - recT0 })); // offsets from the start of the recording
  set({ connected: true });
  loopRec(0);
}
/** The runaway-loop drill, replayed from the recording. Stages, spend, calls and receipt ids are read from it; nothing is simulated. */
async function runRecordedDrill(name: string) {
  const run: DrillRun = { name, ab: false, phase: 'governed', starts: {}, results: [] };
  const d = state.impact?.drill;
  if (name !== 'runaway-loop' || !d || !rec.length) { set({ drillRun: { ...run, phase: 'error', error: name === 'runaway-loop' ? 'The recording did not load.' : `The recording holds only the runaway-loop drill. ${NEEDS_LIVE}` } }); return; }
  timers.forEach(clearTimeout); timers = [];
  set({ incidents: [], actions: [], drillRun: run });
  const t = Date.now(), shift = t - recT0, t0 = d.warmupMs as number, win = d.windowMs as number;
  run.starts.governed = t; set({ drillRun: { ...run } });
  playRec(shift, `D${t}`);
  const stages: DrillResult['stages'] = {};
  let spend = 0, calls = 0;
  for (const { at, m } of rec) {
    if (m.type === 'incident' && m.data.agentId === d.agentId && at >= t0 - 2000 && !(m.data.stage in stages)) stages[m.data.stage] = at - t0;
    if (m.type === 'action' && m.data.governed && m.data.agentId === d.agentId && at >= t0 && at <= t0 + win) { spend += m.data.costUsd; calls++; }
  }
  const res: DrillResult = { drill: name, mode: 'governed', agentId: d.agentId, startedAt: t0 + shift + recT0, durationMs: win, spendUsd: spend, calls, stages, timeToContainMs: stages.proof ?? null, detected: 'detected' in stages, hardContained: 'killed' in stages || 'throttled' in stages };
  await sleep(Math.max(t0 + win, recSpan) + 400);
  run.results = [res]; run.phase = 'done'; set({ drillRun: { ...run } });
  timers.push(setTimeout(() => loopRec(0), 8000));
}

// ---------- replay ----------
let items: { at: number; m: StreamMessage }[] = [];
let idx = 0, vt = 0;
async function startReplay() {
  let ev = await getJSON(`${import.meta.env.BASE_URL}replay/events.json`);
  if (!Array.isArray(ev) || !ev.length) ev = FIXTURE ? (() => { const t = Date.now(); return [...fixtureBaseline(t), ...fixtureDrill('runaway-loop', 'governed', t + 1000).msgs]; })() : [];
  if (!ev.length) return set({ replay: { ...state.replay, status: 'empty' } });
  let last = 0;
  items = (ev as StreamMessage[]).map((m) => ({ at: (last = msgTs(m) ?? last), m })).sort((a, b) => a.at - b.at);
  const imp = await getJSON(`${import.meta.env.BASE_URL}replay/impact.json`);
  if (imp) set({ impact: imp }); else if (FIXTURE) void refreshImpact(); else void refreshImpact();
  await loadAgents([`${import.meta.env.BASE_URL}replay/agents.json`, '/v1/agents']);
  if (!state.agents.length) { // derive bare nodes from the recording
    const idsSeen = [...new Set(items.flatMap(({ m }) => (m.type === 'action' || m.type === 'incident' ? [m.data.agentId] : [])))];
    set({ agents: idsSeen.map((id) => ({ id, name: id, purpose: 'Not in the recording', owner: { name: 'unknown', team: 'unknown', escalation: '' }, riskRating: 'low', lifecycleState: 'production', scopes: { tools: [], data: [] }, models: [], residency: 'unknown', evaluation: null } as unknown as AgentRecord)) });
  }
  const span = items[items.length - 1].at - items[0].at || 1;
  set({ replay: { ...state.replay, startTs: items[0].at, spanMs: span, marks: items.flatMap(({ at, m }) => (m.type === 'incident' ? [{ pos: (at - items[0].at) / span, stage: m.data.stage, agentId: m.data.agentId }] : [])) } });
  replayRestart();
}
export function replaySeek(frac: number) {
  if (!items.length) return;
  const was = state.replay.status === 'playing';
  clearInterval(replayTimer);
  const span = items[items.length - 1].at - items[0].at || 1;
  vt = items[0].at + frac * span; idx = 0;
  clearTimeout(flushT); flushT = undefined; buf = [];
  set({ actions: [], incidents: [], fleet: null, totals: emptyTotals(), admissions: [], spendHist: {}, fleetHist: [] });
  while (idx < items.length && items[idx].at <= vt) ingest(items[idx++].m);
  flush();
  set({ replay: { ...state.replay, pos: frac, status: idx >= items.length ? 'done' : was ? 'playing' : 'paused' } });
  if (was && idx < items.length) replayTimer = setInterval(tick, 100);
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
  set({ actions: [], incidents: [], fleet: null, totals: emptyTotals(), admissions: [], spendHist: {}, fleetHist: [] });
  replayPlay();
}

// ---------- actions the person can take ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function playAbs(msgs: StreamMessage[]) {
  const now = Date.now();
  for (const m of msgs) timers.push(setTimeout(() => ingest(m), Math.max(0, (msgTs(m) ?? now) - now)));
}

export async function runDrill(name: string, ab: boolean) {
  if (state.source === 'recorded') return runRecordedDrill(name);
  const modes = ab ? (['ungoverned', 'governed'] as const) : (['governed'] as const);
  const run: DrillRun = { name, ab, phase: modes[0], starts: {}, results: [] };
  set({ drillRun: run });
  try {
    for (const mode of modes) {
      const t0 = Date.now();
      run.starts[mode] = t0; run.phase = mode; set({ drillRun: { ...run } });
      let res: DrillResult;
      if (FIXTURE) { const f = name.endsWith('-release') ? fixtureRelease(name, t0) : fixtureDrill(name, mode, t0); playAbs(f.msgs); await sleep(f.result.durationMs + 300); res = f.result; }
      else res = await postJSON(`/v1/drills/${name}`, { mode });
      run.results = [...run.results, res]; set({ drillRun: { ...run } });
    }
    run.phase = 'done';
  } catch (e) { run.phase = 'error'; run.error = (e as Error).message; }
  set({ drillRun: { ...run } });
}

export async function resetDrills() {
  let note: string | undefined;
  if (state.source === 'recorded') { timers.forEach(clearTimeout); timers = []; set({ drillRun: null, incidents: [], actions: [] }); loopRec(0); return; }
  if (!FIXTURE) { try { await postJSON('/v1/reset'); } catch (e) { note = `The server did not confirm a reset (${(e as Error).message}).`; } }
  timers.forEach(clearTimeout); timers = [];
  set({ drillRun: note ? { name: '', ab: false, phase: 'error', starts: {}, results: [], error: note } : null, incidents: [], actions: state.actions.filter((a) => !a.agentId.startsWith('__')) });
  if (FIXTURE) { stopSim?.(); ingest(fixtureFleet()); stopSim = startFixtureSim(ingest, () => state.actions, () => state.fleet); }
}

/** POST /v1/agents/:id/promote. 200 (allowed) and 409 (blocked) both carry the PromotionResult; dryRun only evaluates the gates. */
export async function promoteAgent(id: string, to: LifecycleState, dryRun: boolean): Promise<PromotionResult> {
  if (state.source === 'recorded') {
    const rec = state.agents.find((x) => x.id === id); if (!rec) throw new Error(`no agent '${id}'`);
    const d = state.impact?.drill, ct = d?.timeToContainMs;
    const acts = rec_actions(id);
    const res = evaluatePromotion(rec, { to, now: Date.now(), drills: d ? { uncontained: ct.uncontained, containP95Ms: ct.p95, containBudgetMs: d.budgetsMs.containP95 } : null, attackSuite: state.impact?.detector ? { positives: state.impact.detector.tp + state.impact.detector.fn, missed: state.impact.detector.fn } : null, canary: null, budget: { calls: acts.length, errors: acts.filter((a) => a.verdict !== 'allow').length } });
    return { ...res, dryRun: true, reason: `${res.reason} (Read-only demo: nothing was changed. No canary is on file in the recording.)` };
  }
  if (FIXTURE) {
    await sleep(350);
    const rec = state.agents.find((x) => x.id === id); if (!rec) throw new Error(`no agent '${id}'`);
    const res = fixturePromote(rec, to);
    if (res.allowed && !dryRun) set({ agents: state.agents.map((x) => (x.id === id ? { ...x, lifecycleState: to } : x)) });
    return { ...res, dryRun };
  }
  const r = await fetch(`/v1/agents/${encodeURIComponent(id)}/promote${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to }) });
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object' || !Array.isArray(j.checks)) throw new Error((j && j.error) || `HTTP ${r.status}`);
  if (j.allowed && !dryRun) void loadAgents(['/v1/agents']);
  return j as PromotionResult;
}

const rec_actions = (id: string) => rec.flatMap(({ m }) => (m.type === 'action' && m.data.governed && m.data.agentId === id ? [m.data] : []));
export async function killAgent(id: string): Promise<IncidentEvent> {
  if (state.source === 'recorded') {
    const p = rec.map((x) => x.m).find((m) => m.type === 'incident' && m.data.agentId === id && m.data.stage === 'proof');
    if (!p || p.type !== 'incident') throw new Error(`The recording only holds a kill of invoice-recon, none for '${id}'. ${NEEDS_LIVE}`);
    return { ...p.data, message: `Replayed from the recorded run, not a new kill. ${p.data.message}` };
  }
  if (FIXTURE) {
    const t = Date.now();
    const tool = state.agents.find((x) => x.id === id)?.scopes.tools.find((x) => x !== 'agent.call') ?? 'ledger.read';
    const probe = fixtureProbe(id, tool, t + 50);
    const proof = { attemptedTool: tool, verdict: 'deny' as const, code: 'REVOKED', receiptId: probe.receiptId };
    const ev: IncidentEvent = { incidentId: `inc-fixture-kill-${id}-${t}`, agentId: id, stage: 'proof', ts: t + 50, message: `Probe tried ${tool} as ${id}: denied (REVOKED).`, proof };
    await sleep(500);
    ingest({ type: 'incident', data: { ...ev, stage: 'killed', ts: t, message: 'Identity revoked by a person.' } });
    ingest({ type: 'action', data: probe }); ingest({ type: 'incident', data: ev });
    ingest(fixtureFleet({ ...(state.fleet?.states ?? {}), [id]: 'killed' }, state.fleet?.spendPerMinUsd ?? {}, t) as StreamMessage);
    return ev;
  }
  // 502 carries the unproven incident event (kill_unconfirmed) as its body: show it, do not treat it as a transport error.
  const r = await fetch(`/v1/agents/${encodeURIComponent(id)}/kill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const ev: IncidentEvent | null = await r.json().catch(() => null);
  if (!ev || typeof ev !== 'object' || !('stage' in ev)) throw new Error(`HTTP ${r.status}`);
  ingest({ type: 'incident', data: ev });
  return ev;
}

const FX_EXTRA: Record<string, { lifecycleState: string; evaluation: null }> = {};
/** Mirrors services/control/src/admission.ts so the fixture playground behaves like the real gate. */
export async function reviewAdmission(workload: { name: string; namespace: string; labels: Record<string, string> }): Promise<AdmissionResult> {
  if (state.source === 'recorded') { const r = admit(workload, state.agents); ingest({ type: 'admission', data: { ...r, workload: workload.name, ts: Date.now() } } as StreamMessage); return r; } // the real gate function, in the browser
  if (FIXTURE) {
    await sleep(350);
    const id = workload.labels['rollcall.dev/agent-id'];
    const r: any = id ? (state.agents.find((x) => x.id === id) ?? FX_EXTRA[id]) : undefined;
    const deny = (code: string, reason: string): AdmissionResult => ({ allowed: false, code, reason });
    if (!id) return deny('NO_LABEL', `Workload '${workload.name}' carries no rollcall.dev/agent-id label, so it is not a registered agent. Register it in Roll Call first, then label the workload. (FIXTURE answer)`);
    if (!r) return deny('NOT_REGISTERED', `No agent record '${id}' exists. Register the agent before deploying workload '${workload.name}'. (FIXTURE answer)`);
    if ((r.lifecycleState === 'production' || r.lifecycleState === 'canary') && !r.evaluation?.passed) return deny('NO_PASSING_EVAL', `Agent '${id}' is in ${r.lifecycleState} but has no passing evaluation on record. Attach passing evidence or move it back to shadow. (FIXTURE answer)`);
    return { allowed: true, code: 'OK', reason: `Agent '${id}' is registered, owned by ${r.owner?.name}, lifecycle ${r.lifecycleState}. (FIXTURE answer)` };
  }
  return postJSON('/v1/admission/review', { workload });
}

/** POST /v1/agents applies the same validation as admission; used by the "production without evaluation" preset. */
export async function registerDraft(r0: Partial<AgentRecord> & { id: string }): Promise<AdmissionResult> {
  const rec = r0;
  if (state.source === 'recorded') return checkRecord(rec as AgentRecord);
  if (FIXTURE) { await sleep(350); return { allowed: false, code: 'NO_PASSING_EVAL', reason: `Agent '${rec.id}' is in ${rec.lifecycleState} but has no passing evaluation on record. Attach passing evidence or move it back to shadow. (FIXTURE answer)` }; }
  try {
    const r = await fetch('/v1/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) });
    const j = await r.json().catch(() => null);
    if (r.ok) return { allowed: true, code: 'OK', reason: `Registered ${rec.id}.` };
    return { allowed: false, code: j?.code ?? `HTTP_${r.status}`, reason: j?.reason ?? j?.error ?? `The registry refused the record (HTTP ${r.status}).` };
  } catch (e) { throw new Error((e as Error).message); }
}

export async function verifyReceipts(): Promise<{ gateway: string; ok: boolean; count?: number; reason?: string }[]> {
  if (state.source === 'recorded') throw new Error(NEEDS_LIVE.replace('this needs', 'chain verification needs'));
  if (FIXTURE) { await sleep(450); const v = verifyFixtureChain(); return [{ gateway: 'gw-1 (FIXTURE chain, in-browser)', ok: v.ok, count: v.count }]; }
  const j = await getJSON('/v1/receipts/verify');
  if (!j) throw new Error('Could not reach /v1/receipts/verify');
  const list = Array.isArray(j) ? j : Object.entries(j.gateways ?? j).map(([gateway, v]) => ({ gateway, ...(v as object) }));
  return list.map((x: any) => ({ gateway: x.gateway ?? x.gatewayId ?? 'gateway', ok: !!x.ok, count: x.count, reason: x.reason }));
}
