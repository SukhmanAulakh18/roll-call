import { useMemo, useState } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { Check, CircleDashed, Flame, PackageCheck, PackageX, Play, RotateCcw, Rewind, Repeat2, ShieldQuestion } from 'lucide-react';
import type { ActionEvent, DrillResult, IncidentStage } from '../../../contracts/types';
import { FIXTURE, NEEDS_LIVE, resetDrills, runDrill, useStore, type DrillRun } from '../store';
import { FixtureChip, Measured, StateMark, groupIncidents, ownerShort, secs, useNow, usd, type AgentState } from '../ui';
import { KillUnconfirmed, Panel, ProofCard } from '../components';
import { RollRing } from '../ring';
import { ReleaseView } from './ReleaseDrill';

const DRILLS = [
  { name: 'runaway-loop', ab: true, label: 'Runaway loop', icon: Flame, note: 'An agent retries the same call in a tight loop. Run it with and without controls and race the spend.', agent: 'invoice-recon', involved: ['invoice-recon'], release: false },
  { name: 'ping-pong', ab: false, label: 'Agent ping-pong', icon: Repeat2, note: 'Two agents call each other forever. The loop lights up on the map.', agent: 'limits-checker', involved: ['limits-checker', 'credit-memo'], release: false },
  { name: 'scope-drift', ab: false, label: 'Scope drift', icon: ShieldQuestion, note: 'An agent reaches for a tool it was never given. A dashed drift edge pulses.', agent: 'support-summarizer', involved: ['support-summarizer'], release: false },
  { name: 'bad-release', ab: false, label: 'Bad release', icon: PackageX, note: 'A new version of invoice-recon ships with a fault. It runs as a canary, fails analysis and is rolled back with no human.', agent: 'invoice-recon', involved: ['invoice-recon'], release: true },
  { name: 'good-release', ab: false, label: 'Good release', icon: PackageCheck, note: 'The control case: a healthy new version must be promoted, not rolled back.', agent: 'invoice-recon', involved: ['invoice-recon'], release: true },
] as const;
const WARMUP_GUESS = 5000; // sim/drills.ts WARMUP_MS: the real drill warms the fleet up for 5 s before injecting the fault
const STEPS: { stage: IncidentStage; label: string; plain: string }[] = [
  { stage: 'detected', label: 'Detect', plain: 'Off its own baseline.' },
  { stage: 'throttled', label: 'Throttle', plain: 'Calls slowed, spend flattens.' },
  { stage: 'paged', label: 'Page', plain: 'Owner paged (simulated).' },
  { stage: 'owner_ack', label: 'Owner ack', plain: 'Owner replies (simulated).' },
  { stage: 'killed', label: 'Kill', plain: 'Agent identity revoked.' },
  { stage: 'proof', label: 'Proof', plain: 'A probe is refused.' },
];

interface Pt { t: number; v: number }
function series(actions: ActionEvent[], governed: boolean, t0: number | undefined, who: readonly string[], end?: number): Pt[] {
  if (t0 == null) return [];
  let cum = 0;
  const pts: Pt[] = [{ t: 0, v: 0 }];
  for (const a of actions) {
    if (a.governed !== governed || a.ts < t0 || !who.includes(a.agentId)) continue;
    if (end != null && a.ts > end) break;
    cum += a.costUsd; pts.push({ t: (a.ts - t0) / 1000, v: cum });
  }
  return pts;
}

function RaceChart({ title, tone, pts, max, maxT, ph, marks = [], state, note }: { title: string; tone: 'bad' | 'cool'; pts: Pt[]; max: number; maxT: number; ph: number | null; marks?: { t: number; text: string }[]; state?: string; note?: string }) {
  const W = 640, H = 190, L = 52, B = 26, T = 14, R = 14;
  const x = (t: number) => L + (t / (maxT || 1)) * (W - L - R), y = (v: number) => H - B - (v / (max || 1)) * (H - B - T);
  const shown = ph == null ? pts : pts.filter((p) => p.t <= ph);
  const d = shown.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = shown[shown.length - 1];
  return (
    <figure className={`race race--${tone}`}>
      <figcaption><h2>{title}</h2>{state && <span className="muted">{state}</span>}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: cumulative spend ${last ? usd(last.v) : 'none yet'} after ${last ? last.t.toFixed(1) : '0'} seconds`}>
        {[0, 0.5, 1].map((f) => (<g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="grid" /><text x={L - 8} y={y(max * f) + 4} textAnchor="end" className="axis">{usd(max * f)}</text></g>))}
        {[0, 0.5, 1].map((f) => <text key={f} x={x(maxT * f)} y={H - 8} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="axis">{(maxT * f).toFixed(0)} s</text>)}
        {marks.filter((m) => ph == null || m.t <= ph).map((m, mi) => { const right = x(m.t) > W - R - 80; return (<g key={m.text}><line x1={x(m.t)} x2={x(m.t)} y1={T} y2={H - B} className="mark" /><text x={right ? x(m.t) - 5 : x(m.t) + 5} textAnchor={right ? 'end' : 'start'} y={T + 12 + mi * 18} className="mark-t">{m.text}</text></g>); })}
        {shown.length > 1 && <><path d={`${d}L${x(last.t).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`} className="area" /><path d={d} className="line" /></>}
        {last && <><circle cx={x(last.t)} cy={y(last.v)} r="5" className="dot" /><text x={Math.min(x(last.t) - 8, W - R - 4)} y={y(last.v) < T + 26 ? y(last.v) + 22 : y(last.v) - 10} textAnchor="end" className="endlabel">{usd(last.v)}</text></>}
      </svg>
      {note && <p className="race-note">{note}</p>}
    </figure>
  );
}

export function Drill() {
  const run = useStore((s) => s.drillRun);
  const actions = useStore((s) => s.actions);
  const incidents = useStore((s) => s.incidents);
  const agents = useStore((s) => s.agents);
  const state = useStore((s) => s.fleet?.states);
  const reduce = useReducedMotion();
  const [pick, setPick] = useState<(typeof DRILLS)[number]['name']>('runaway-loop');
  const recorded = useStore((s) => s.source === 'recorded');
  const dr = useStore((s) => s.impact?.drill);
  const d0 = DRILLS.find((x) => x.name === pick)!;
  const d = useMemo(() => (recorded ? { ...d0, ab: false } : d0) as typeof d0, [recorded, d0]);
  const unavailable = recorded && d.name !== 'runaway-loop';
  const active = run && run.name === d.name ? run : null;
  const running = !!active && active.phase !== 'done' && active.phase !== 'error';
  const [ph, setPh] = useState<number | null>(null);
  const now = useNow(100);

  const ungovRes = active?.results.find((r) => r.mode === 'ungoverned');
  const govRes = active?.results.find((r) => r.mode === 'governed');
  const t0u = ungovRes?.startedAt ?? (active?.starts.ungoverned != null ? active.starts.ungoverned + (FIXTURE ? 0 : WARMUP_GUESS) : undefined);
  const t0g = govRes?.startedAt ?? (active?.starts.governed != null ? active.starts.governed + (FIXTURE ? 0 : WARMUP_GUESS) : undefined);
  const A = useMemo(() => series(actions, false, t0u, d.involved, ungovRes ? ungovRes.startedAt + ungovRes.durationMs : undefined), [actions, t0u, ungovRes, d]);
  const B = useMemo(() => series(actions, true, t0g, d.involved, govRes ? govRes.startedAt + govRes.durationMs : undefined), [actions, t0g, govRes, d]);
  const max = Math.max(0.05, ...A.map((p) => p.v), ...B.map((p) => p.v));
  const maxT = Math.max(4, Math.ceil(Math.max(...A.map((p) => p.t), ...B.map((p) => p.t), (govRes?.durationMs ?? 0) / 1000)));

  const g = useMemo(() => { const gs = groupIncidents(incidents.filter((e) => e.agentId === d.agent || d.involved.includes(e.agentId as never))); return t0g != null ? gs.find((x) => x.first >= t0g - 2000) ?? null : null; }, [incidents, d, t0g]);
  const agent = agents.find((a) => a.id === d.agent);
  const agState = (state?.[d.agent] ?? 'unknown') as AgentState;
  const elapsed = t0g != null && active?.phase === 'governed' && !g?.byStage.proof && !g?.byStage.kill_unconfirmed ? Math.max(0, (now - t0g) / 1000) : undefined;
  const marks = useMemo(() => [g?.byStage.throttled, g?.byStage.killed].flatMap((e, i) => (e && t0g ? [{ t: (e.ts - t0g) / 1000, text: i ? 'killed' : 'throttled' }] : [])), [g, t0g]);
  const proof = g?.byStage.proof?.proof;

  const replay = () => {
    setPh(0);
    const c = animate(0, maxT, { duration: reduce ? 0.01 : Math.min(7, maxT * 1.2), ease: 'linear', onUpdate: (v) => setPh(v), onComplete: () => setPh(null) });
    return c;
  };
  const start = () => { setPh(null); void runDrill(d.name, d.ab); };
  const canReplay = !!govRes && (!d.ab || !!ungovRes);
  const stageMs = (st: IncidentStage) => govRes?.stages?.[st] ?? (g?.byStage[st] && t0g != null ? g.byStage[st]!.ts - t0g : undefined);
  const zoomed = ph != null ? (stageMs('detected') ?? Infinity) / 1000 <= ph : !!g?.byStage.detected && d.involved.length === 1;
  const showProof = ph == null || (stageMs('proof') ?? Infinity) / 1000 <= ph;
  const protectedUsd = ungovRes && govRes ? ungovRes.spendUsd - govRes.spendUsd : undefined;

  return (
    <div className="drill">
      <header className="page-h">
        <div><h1>Drill theatre</h1><p className="lead">Inject a fault into the simulated fleet and watch the controls respond. Every number is read from the stream or the drill result.</p></div>
        {FIXTURE && <FixtureChip />}
      </header>

      <div className="drill-bar" role="radiogroup" aria-label="Choose a drill">
        {DRILLS.map((x) => (
          <button key={x.name} role="radio" aria-checked={pick === x.name} className={`pick ${pick === x.name ? 'is-on' : ''}`} onClick={() => { setPick(x.name); setPh(null); }} disabled={running}>
            <x.icon size={18} aria-hidden /><span className="pick-t">{x.label}</span><span className="pick-n">{x.note}</span>
          </button>
        ))}
        <div className="drill-go">
          <button className="btn btn--primary btn--lg" onClick={start} disabled={running || unavailable} data-tour="run-drill"><Play size={16} aria-hidden />{running ? `Running ${active?.phase === 'ungoverned' ? 'without controls' : 'with controls'}` : `Run ${d.label.toLowerCase()}`}</button>
          <button className="btn" onClick={() => { void resetDrills(); setPh(null); }} disabled={running}><RotateCcw size={14} aria-hidden />Reset fleet</button>
        </div>
      </div>
      {active?.phase === 'error' && <p className="note-bad" role="alert">The drill did not finish: {active.error}</p>}
      {recorded && <p className="rec-note" role="note"><strong>Replayed from the recorded run.</strong> {unavailable ? NEEDS_LIVE : <>Press run to play the recorded governed runaway drill: the stages, spend, calls and receipt ids below are read from the recording. {dr?.spendProtectedUsd && <>The ungoverned side is not replayed here; over the recorded {dr.runs} runs the agent spent a mean of <span className="measured">{usd(dr.spendProtectedUsd.ungovernedMean)}</span> without controls and <span className="measured">{usd(dr.spendProtectedUsd.governedMean)}</span> with them.</>}</>}</p>}
      {!active && <p className="muted">Pick a drill and run it. The real drill warms the fleet for a few seconds, injects the fault, then holds a fixed window.</p>}

      {d.release ? <ReleaseView name={d.name as 'bad-release' | 'good-release'} run={run} /> : <>
      <div className={`race-grid ${d.ab ? '' : 'race-grid--one'}`} data-tour="race">
        {d.ab && <RaceChart title="Ungoverned" tone="bad" pts={A} max={max} maxT={maxT} ph={ph} state={ungovRes ? `${secs(ungovRes.durationMs)} window, ${ungovRes.calls} calls` : active?.phase === 'ungoverned' ? 'running now' : 'not run yet'} note="Same fault, no controls: the agent keeps calling until the window ends." />}
        <RaceChart title={d.ab ? 'Governed' : 'With controls'} tone="cool" pts={B} max={max} maxT={maxT} ph={ph} marks={marks} state={govRes ? `${secs(govRes.durationMs)} window, ${govRes.calls} calls` : active?.phase === 'governed' ? 'running now' : 'not run yet'} note={d.name === 'scope-drift' ? 'Spend stays flat because every out-of-scope call is denied at the gateway.' : 'Same fault, controls on: slowed, paged, then stopped.'} />
      </div>
      <div className="race-sum">
        {protectedUsd != null ? <p><Measured /> Without controls the agent spent <strong className="measured">{usd(ungovRes!.spendUsd)}</strong>; with controls <strong className="measured">{usd(govRes!.spendUsd)}</strong>. That is <strong className="measured">{usd(protectedUsd)}</strong> not spent in this one window.</p> : govRes && !d.ab ? <p><Measured /> The agent spent <strong className="measured">{usd(govRes.spendUsd)}</strong> over <span className="measured">{govRes.calls}</span> calls in the window.</p> : <p className="muted">Run the drill to see what the controls saved.</p>}
      </div>

      <div className="theatre">
        <Panel title={<>The roll, zoomed to {agent?.name ?? d.agent}</>} aside={<StateMark state={agState} />} id="tm-h" className="theatre-ring">
          <div className="theatre-ringbox" data-tour="map"><RollRing compact selected={null} onSelect={(id) => { location.hash = `#/agent/${encodeURIComponent(id)}`; }} focus={zoomed ? d.agent : null} /></div>
        </Panel>
        <div className="theatre-proof" data-tour="proof">
          {showProof && g?.byStage.kill_unconfirmed ? <KillUnconfirmed ev={g.byStage.kill_unconfirmed} /> : showProof && proof ? <ProofCard agentId={g!.agentId} proof={proof} /> : (
            <section className="proof proof--wait"><CircleDashed size={28} aria-hidden /><div><h3>The receipt prints here</h3><p>When the agent is stopped, a probe replays a call as that agent. A denial with a receipt id is the proof.</p></div></section>
          )}
          <div className="theatre-do">
            <button className="btn" onClick={replay} disabled={!canReplay || ph != null}><Rewind size={14} aria-hidden />Replay this</button>
            {ph != null && <span className="measured muted">replaying, {ph.toFixed(1)} s</span>}
          </div>
          <OwnerLine agentId={d.agent} />
        </div>
      </div>
      <Panel title="What happened, and how fast" className="stepper-panel" id="sp-h" aside={<span className="elapsed" aria-live="off">{elapsed != null ? <><span className="muted">Elapsed</span> <span className="measured elapsed-n">{elapsed.toFixed(1)} s</span></> : govRes?.timeToContainMs != null ? <><span className="muted">Contained in</span> <span className="measured elapsed-n">{secs(govRes.timeToContainMs)}</span></> : <span className="muted">Waiting for a governed run</span>}</span>}>
        <Stepper g={g} res={govRes} t0={t0g} running={active?.phase === 'governed'} ph={ph} />
      </Panel>
      </>}
    </div>
  );
}

function OwnerLine({ agentId }: { agentId: string }) {
  const a = useStore((s) => s.agents.find((x) => x.id === agentId));
  if (!a) return null;
  return <p className="muted">Pages go to <strong>{ownerShort(a.owner.name)}</strong> at <span className="measured">{a.owner.escalation}</span>. No real page is sent.</p>;
}

function Stepper({ g, res, t0, running, ph }: { g: ReturnType<typeof groupIncidents>[number] | null; res?: DrillResult; t0?: number; running: boolean; ph: number | null }) {
  const firstWaiting = STEPS.findIndex((s) => !g?.byStage[s.stage] && res?.stages?.[s.stage] == null);
  const msOf = (st: IncidentStage) => res?.stages?.[st] ?? (g?.byStage[st] && t0 != null ? g.byStage[st]!.ts - t0 : undefined);
  const doneN = STEPS.filter((x) => { const m = msOf(x.stage); return m != null && (ph == null || m / 1000 <= ph); }).length;
  return (
    <ol className="stepper" style={{ ['--fill' as string]: Math.max(0, doneN - 1) / (STEPS.length - 1) }}>
      {STEPS.map((s, i) => {
        const e = g?.byStage[s.stage];
        const ms0 = res?.stages?.[s.stage] ?? (e && t0 != null ? e.ts - t0 : undefined);
        const done = (e != null || ms0 != null) && (ph == null || (ms0 ?? 0) / 1000 <= ph);
        const ms = done ? ms0 : undefined;
        const cur = ph == null && running && i === firstWaiting;
        return (
          <motion.li key={s.stage} className={`step ${done ? 'is-done' : ''} ${cur ? 'is-cur' : ''}`} animate={done ? { opacity: 1 } : { opacity: 0.78 }}>
            <span className="step-i" aria-hidden="true">{done ? <Check size={14} /> : <span className="step-n">{i + 1}</span>}</span>
            <span className="step-t">{s.label}</span>
            <span className="step-time measured">{ms != null ? `+${(ms / 1000).toFixed(1)} s` : cur ? 'now' : 'waiting'}</span>
            <span className="step-m">{s.plain}</span>{done && e?.message && <details className="step-more"><summary>Details</summary><p>{e.message}</p></details>}
            {done && <span className="visually-hidden"> done</span>}
          </motion.li>
        );
      })}
    </ol>
  );
}

export type { DrillRun };
