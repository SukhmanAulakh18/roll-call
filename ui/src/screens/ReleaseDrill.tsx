import { useMemo } from 'react';
import { Check } from 'lucide-react';
import type { DrillResult, IncidentStage } from '../../../contracts/types';
import type { DrillRun } from '../store';
import { useStore } from '../store';
import { Measured, groupIncidents, secs } from '../ui';
import { Panel } from '../components';
import { GateList } from '../gates';

type Step = { stage: IncidentStage; label: string; plain: string };
const BAD: Step[] = [
  { stage: 'canary_started', label: 'Canary starts', plain: "The new version takes half of the agent's traffic; the stable version keeps the rest." },
  { stage: 'detected', label: 'Analysis', plain: 'Its error rate and p99 are compared with the stable version.' },
  { stage: 'rolled_back', label: 'Rolled back', plain: 'The canary stops, traffic returns to stable, the record keeps its version.' },
];
const GOOD: Step[] = [BAD[0], { stage: 'promoted', label: 'Promoted', plain: 'The analysis passed and every gate was green, so the new version becomes the production version.' }];

/** The release drills: a new version of an agent runs as a canary and the gates decide. Everything shown comes from the incident stream or the drill result. */
export function ReleaseView({ name, run }: { name: 'bad-release' | 'good-release'; run: DrillRun | null }) {
  const incidents = useStore((s) => s.incidents);
  const bad = name === 'bad-release', steps = bad ? BAD : GOOD;
  const active = run && run.name === name ? run : null;
  const res: DrillResult | undefined = active?.results[0];
  const running = !!active && active.phase !== 'done' && active.phase !== 'error';
  const evs = useMemo(() => {
    const since = active?.starts.governed ?? Infinity;
    const start = incidents.filter((e) => e.stage === 'canary_started' && e.ts >= since).sort((a, b) => b.ts - a.ts)[0];
    return start ? groupIncidents(incidents.filter((e) => e.incidentId === start.incidentId))[0] : null;
  }, [incidents, active?.starts.governed]);
  const t0 = res?.startedAt ?? evs?.byStage.canary_started?.ts;
  const firstWaiting = steps.findIndex((s) => !evs?.byStage[s.stage]);
  const outcome = res?.outcome;
  return (
    <div className="theatre theatre--release">
      <Panel title="What happened, and how fast" className="stepper-panel" id="rs-h" aside={res?.timeToRollbackMs != null ? <span className="elapsed"><span className="muted">Rolled back after</span> <span className="measured elapsed-n">{secs(res.timeToRollbackMs)}</span> <Measured /></span> : undefined}>
        <ol className="stepper">
          {steps.map((s, i) => {
            const e = evs?.byStage[s.stage];
            const done = e != null, cur = running && i === firstWaiting;
            const ms = done && t0 != null ? e.ts - t0 : undefined;
            return (
              <li key={s.stage} className={`step ${done ? 'is-done' : ''} ${cur ? 'is-cur' : ''}`}>
                <span className="step-i" aria-hidden="true">{done ? <Check size={14} /> : <span className="step-n">{i + 1}</span>}</span>
                <span className="step-t">{s.label}</span>
                <span className="step-time measured">{ms != null ? `+${(ms / 1000).toFixed(1)} s` : cur ? 'now' : 'waiting'}</span>
                <span className="step-m">{e?.message ?? s.plain}</span>
                {done && <span className="visually-hidden"> done</span>}
              </li>
            );
          })}
        </ol>
        {!active && <p className="muted">Run the drill. The control plane starts a new version of invoice-recon beside the stable one and judges it on measured calls.</p>}
        {active?.phase === 'error' && <p className="note-bad" role="alert">The drill did not finish: {active.error}</p>}
      </Panel>
      <Panel title="Promotion gates" id="rg-h" aside={outcome ? <span className={`chip ${outcome === 'promoted' ? 'chip--cool' : ''}`}>{outcome === 'rolled_back' ? 'rolled back' : outcome}</span> : undefined}>
        {res?.gates ? <GateList checks={res.gates} /> : <p className="muted">{running ? 'The gates are evaluated on the canary\'s measured calls and shown here when the verdict is in.' : 'Each gate and its verdict will appear here once the drill finishes.'}</p>}
        {bad && outcome === 'rolled_back' && <p className="muted">The record stayed at the stable version, and the canary's identity no longer works.</p>}
        {!bad && outcome === 'undecided' && <p className="note-bad">No verdict before the window closed.</p>}
      </Panel>
    </div>
  );
}
