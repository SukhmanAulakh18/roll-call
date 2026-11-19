import { useMemo } from 'react';
import type { ActionEvent, DrillResult, IncidentStage } from '../../../contracts/types';
import { resetDrills, runDrill, useStore, type DrillRun } from '../store';
import { Line, NotMeasured, StateIcon, groupIncidents, secs, usd, type Pt } from '../ui';

const DRILLS = [
  { name: 'runaway-loop', ab: true, label: 'Runaway loop', note: 'A/B: same fault with and without controls' },
  { name: 'ping-pong', ab: false, label: 'Agent ping-pong', note: 'Two agents calling each other forever' },
  { name: 'scope-drift', ab: false, label: 'Scope drift', note: 'An agent reaching for a tool it was never given' },
];
const STEPS: { stage: IncidentStage; label: string; plain: string }[] = [
  { stage: 'detected', label: 'Detect', plain: 'The gateway notices something is off.' },
  { stage: 'throttled', label: 'Throttle', plain: 'Calls are slowed so spend stops climbing.' },
  { stage: 'paged', label: 'Page', plain: 'The owner gets a page.' },
  { stage: 'killed', label: 'Contain', plain: 'The agent is stopped.' },
  { stage: 'proof', label: 'Proof', plain: 'A probe tries to act and is refused.' },
];

function series(actions: ActionEvent[], governed: boolean, start: number | undefined, agent?: string): { pts: Pt[]; agent?: string } {
  if (start == null) return { pts: [] };
  const rows = actions.filter((a) => a.governed === governed && a.ts >= start - 50);
  if (!agent) { const sp: Record<string, number> = {}; rows.forEach((a) => (sp[a.agentId] = (sp[a.agentId] ?? 0) + a.costUsd)); agent = Object.entries(sp).sort((a, b) => b[1] - a[1])[0]?.[0]; }
  let cum = 0;
  const pts: Pt[] = [{ t: 0, v: 0 }];
  rows.filter((a) => a.agentId === agent).forEach((a) => { cum += a.costUsd; pts.push({ t: Math.max(0, (a.ts - start) / 1000), v: cum }); });
  return { pts, agent };
}

function Timeline({ run }: { run: DrillRun | null }) {
  const incidents = useStore((s) => s.incidents);
  const agents = useStore((s) => s.agents);
  const g = groupIncidents(incidents)[0];
  const res = run?.results.find((r) => r.mode === 'governed');
  const t0 = run?.starts.governed ?? g?.first;
  const name = agents.find((a) => a.id === g?.agentId)?.name ?? g?.agentId;
  return (
    <section className="panel" aria-labelledby="tl">
      <h2 id="tl" className="h-display text-3xl">What happened, and how fast</h2>
      <p className="mt-1 text-mute">{g ? <>Incident on <a href={`#/agent/${g.agentId}`}>{name}</a>. Times are seconds since {run?.starts.governed ? 'the fault was injected' : 'the first signal'}.</> : 'No incident yet. Run a drill to start one.'}</p>
      <ol className="mt-5 space-y-1">
        {STEPS.map((s) => {
          const e = g?.byStage[s.stage];
          const ms = res?.stages?.[s.stage] ?? (e && t0 != null ? e.ts - t0 : undefined);
          const done = e != null || ms != null;
          return (
            <li key={s.stage} className={`grid grid-cols-[2rem_7rem_1fr_6rem] items-start gap-3 border-b border-line py-3 ${done ? '' : 'text-mute'}`}>
              <span className={done ? 'text-ink' : ''}><StateIcon state={done ? 'healthy' : 'unknown'} /></span>
              <span className="font-semibold">{s.label}</span>
              <span>{e?.message ?? s.plain}{e?.proof && <span className="mt-1 block font-mono text-sm">receipt {e.proof.receiptId} · {e.proof.code}</span>}</span>
              <span className="text-right text-xl tabular-nums">{ms != null ? `+${(ms / 1000).toFixed(1)} s` : 'waiting'}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AB({ run }: { run: DrillRun | null }) {
  const actions = useStore((s) => s.actions);
  const incidents = useStore((s) => s.incidents);
  const d = useMemo(() => {
    const un = run?.results.find((r) => r.mode === 'ungoverned'), go = run?.results.find((r) => r.mode === 'governed');
    const a = series(actions, false, run?.starts.ungoverned, un?.agentId), b = series(actions, true, run?.starts.governed, go?.agentId);
    const max = Math.max(0.01, ...a.pts.map((p) => p.v), ...b.pts.map((p) => p.v));
    const maxT = Math.max(2, ...a.pts.map((p) => p.t), ...b.pts.map((p) => p.t));
    const inc = groupIncidents(incidents.filter((i) => i.agentId === b.agent))[0];
    const st = run?.starts.governed;
    const marks = [inc?.byStage.throttled, inc?.byStage.killed].flatMap((e, i) => (e && st ? [{ t: (e.ts - st) / 1000, text: i ? 'stopped' : 'slowed' }] : []));
    return { a, b, max, maxT, marks, un, go };
  }, [actions, incidents, run]);
  const ab = run?.ab;
  if (!run || !ab) return <section className="panel"><h2 className="h-display text-3xl">Spend with and without controls</h2><p className="mt-2 text-mute">Run the Runaway loop (A/B) to draw both lines from the same fault.</p></section>;
  const prot = d.un && d.go ? d.un.spendUsd - d.go.spendUsd : undefined;
  return (
    <section className="panel" aria-labelledby="ab">
      <h2 id="ab" className="h-display text-3xl">Spend with and without controls</h2>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <figure><figcaption className="mb-1 font-semibold">A · No controls: keeps climbing</figcaption><Line pts={d.a.pts} max={d.max} maxT={d.maxT} dashed label={`Ungoverned cumulative spend, ends at ${usd(d.a.pts.at(-1)?.v ?? 0)}`} /></figure>
        <figure><figcaption className="mb-1 font-semibold">B · Roll Call: bends flat after the slowdown</figcaption><Line pts={d.b.pts} max={d.max} maxT={d.maxT} marks={d.marks} label={`Governed cumulative spend, ends at ${usd(d.b.pts.at(-1)?.v ?? 0)}`} /></figure>
      </div>
      <p className="mt-4 text-lg">{prot != null ? <>The same fault cost <strong>{usd(d.un!.spendUsd)}</strong> without controls and <strong>{usd(d.go!.spendUsd)}</strong> with them: <strong>{usd(prot)}</strong> protected. <span className="chip">measured</span></> : run.phase === 'error' ? null : <span className="text-mute">{run.phase === 'done' ? 'Waiting for results.' : `Running the ${run.phase} half…`}</span>}</p>
    </section>
  );
}

export function Drill() {
  const run = useStore((s) => s.drillRun);
  const impact = useStore((s) => s.impact);
  const busy = run != null && run.phase !== 'done' && run.phase !== 'error';
  const lastGov: DrillResult | undefined = run?.results.find((r) => r.mode === 'governed');
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><h1 className="h-display text-5xl">Drill panel</h1><p className="mt-1 max-w-xl text-mute">Break a simulated agent on purpose and watch the real controls respond. Only the incident moves fast.</p></div>
        <p className="text-mute">{impact?.drill ? <>Last full run: {impact.drill.runs} drills, p95 contain {impact.drill.timeToContainMs?.p95 != null ? secs(impact.drill.timeToContainMs.p95) : 'n/a'}</> : <NotMeasured cmd="make drill" />}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {DRILLS.map((d) => (
          <button key={d.name} className="btn btn-accent h-full flex-col !items-start !justify-start !py-5 text-left" disabled={busy} onClick={() => void runDrill(d.name, d.ab)}>
            <span className="text-2xl font-semibold">Run drill: {d.label}</span><span className="text-[0.9rem] font-normal">{d.note}</span>
          </button>
        ))}
        <button className="btn h-full justify-center !text-xl" disabled={busy} onClick={() => void resetDrills()}>Reset</button>
      </div>
      <div aria-live="polite">
        {busy && <p className="text-lg"><StateIcon state="throttled" /> Running {run.ab ? `the ${run.phase} half` : 'the drill'}…</p>}
        {run?.phase === 'error' && <p className="rounded-md border-2 border-accent p-4 text-accent">The drill did not finish: {run.error}</p>}
        {run?.phase === 'done' && lastGov?.timeToContainMs != null && <p className="text-lg">Contained and proven in <strong>{secs(lastGov.timeToContainMs)}</strong> from the fault. <span className="chip">measured</span></p>}
      </div>
      <Timeline run={run} />
      <AB run={run} />
    </div>
  );
}
