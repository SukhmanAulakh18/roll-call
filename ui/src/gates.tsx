import { useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';
import type { AgentRecord, GateCheck, LifecycleState, PromotionResult } from '../../contracts/types';
import { promoteAgent } from './store';

/** One row per gate: icon and word (not colour alone), the gate's name, and what it measured, in plain English. */
export function GateList({ checks }: { checks: GateCheck[] }) {
  return (
    <ul className="gates">
      {checks.map((c) => (
        <li key={c.name} className={c.passed ? 'is-ok' : 'is-bad'}>
          <span className="g-i">{c.passed ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}<span className="visually-hidden">{c.passed ? 'Passed' : 'Blocked'}</span></span>
          <strong className="g-n">{c.name}</strong>
          <span className="g-d">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

const TRACK: LifecycleState[] = ['draft', 'shadow', 'canary', 'production'];
const NEXT: Partial<Record<LifecycleState, LifecycleState>> = { draft: 'shadow', shadow: 'canary', canary: 'production' };

/** Lifecycle track plus the Promote button. The server decides; the panel only shows its answer, gate by gate. */
export function Lifecycle({ agent }: { agent: AgentRecord }) {
  const [res, setRes] = useState<PromotionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = NEXT[agent.lifecycleState];
  const go = async (dryRun: boolean) => {
    if (!next) return;
    setBusy(true); setErr(null);
    try { setRes(await promoteAgent(agent.id, next, dryRun)); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const at = TRACK.indexOf(agent.lifecycleState);
  return (
    <div className="lifecycle">
      <ol className="track" aria-label="Lifecycle">
        {TRACK.map((s, i) => <li key={s} className={i < at ? 'is-past' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>{s}</li>)}
        {agent.lifecycleState === 'retired' && <li className="is-now" aria-current="step">retired</li>}
      </ol>
      <p className="muted">A state only advances when its gates pass on evidence. Production needs a passing evaluation, drill regression, zero attack escapes, a clean canary and an error budget that is not used up.</p>
      {agent.lifecycleState === 'retired'
        ? <p className="muted">Retired: decommissioned, the record is kept, the agent cannot act.</p>
        : next
          ? <div className="lc-actions">
              <button className="btn btn--primary" onClick={() => void go(false)} disabled={busy}><ShieldCheck size={16} aria-hidden />{busy ? 'Checking the gates' : `Promote to ${next}`}</button>
              <button className="btn" onClick={() => void go(true)} disabled={busy}>Check gates only</button>
            </div>
          : <p className="muted">In production. A new version goes out as a canary: it is promoted or rolled back by the same gates (see Drill, Bad release).</p>}
      {err && <p className="note-bad" role="alert">Could not ask the control plane: {err}</p>}
      {res && (
        <div className="lc-res" role="status">
          <p className={res.allowed ? 'note-ok' : 'note-bad'}><strong>{res.reason}</strong></p>
          {res.dryRun && <p className="muted">Check only: nothing was changed.</p>}
          <GateList checks={res.checks} />
        </div>
      )}
    </div>
  );
}
