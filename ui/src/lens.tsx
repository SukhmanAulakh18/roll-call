import { useState, type ReactNode } from 'react';
import { ArrowRight, CircleCheck, RotateCcw } from 'lucide-react';
import { REPLAY_ONLY, resetDrills, useStore } from './store';
import { useUi } from './ui-state';
import { Assumption, NotMeasured, StateMark, VerifyButton, clock, groupIncidents, isNum, ownerShort, secs, usd, type AgentState, type IncidentGroup, type VerifySpec } from './ui';
import { codeWords } from './vocab';
import { KindChip, SimChip, useIncident, pickStr } from './modes';
import { ReceiptChain } from './live';

const NM = (cmd: string) => <NotMeasured cmd={cmd} />;
const STAGE_WORD: Record<string, string> = { detected: 'Detected', throttled: 'Slowed down', paged: 'Owner alerted', owner_ack: 'Owner acknowledged', killed: 'Agent stopped', proof: 'Proof: request denied', kill_unconfirmed: 'Stop not confirmed', resolved: 'Resolved' };
const spec = (title: string, what: string, field: string, shown: string, command: string): VerifySpec => ({ title, what, field, shown, kind: 'measured', command });

/** Latest incident from the stream, if one is on screen. */
function useLatest(): IncidentGroup | undefined {
  const inc = useStore((s) => s.incidents);
  return groupIncidents(inc.filter((e) => !['canary_started', 'rolled_back', 'promoted'].includes(e.stage)))[0];
}
const Kpi = ({ q, n, note, v }: { q: string; n: ReactNode; note: ReactNode; v: VerifySpec }) => (
  <li className="lk"><h3 className="lk-q">{q}</h3><p className="lk-n measured">{n}</p><p className="lk-note">{note}</p><VerifyButton spec={v} /></li>
);
const Head = ({ lens, title, children }: { lens: string; title: string; children?: ReactNode }) => (
  <header className="lens-h"><div><p className="eyebrow">{lens} view</p><h1 id="lens-h">{title}</h1></div><div className="lens-chips"><SimChip /><KindChip kind="measured" />{children}</div></header>
);

function Timeline({ g, typical }: { g?: IncidentGroup; typical: Record<string, number> }) {
  const order = ['detected', 'throttled', 'paged', 'killed', 'proof'] as const;
  const rows = order.map((k) => ({ k, at: g?.byStage[k]?.ts, ms: typical[k] })).filter((r) => r.at || isNum(r.ms));
  if (!rows.length) return <p className="muted">No incident timeline yet. {NM('make drill')}</p>;
  return (
    <ol className="lens-tl" aria-label={g ? 'Incident timeline' : 'Typical incident timeline, from the test run'}>
      {rows.map((r) => <li key={r.k}><span className="tl-w">{STAGE_WORD[r.k]}</span><span className="tl-t measured">{r.at ? clock(r.at) : `+${secs(r.ms)}`}</span></li>)}
    </ol>
  );
}

function Exec() {
  const impact = useStore((s) => s.impact), g = useLatest(), inc = useIncident();
  const d = impact?.drill, st = (d?.stagesP95Ms ?? {}) as Record<string, number>;
  const u = d?.callsMean?.ungoverned, gv = d?.callsMean?.governed, uc = d?.spendProtectedUsd?.ungovernedMean, gc = d?.spendProtectedUsd?.governedMean, p95 = d?.timeToContainMs?.p95;
  const stopped = isNum(p95);
  return (
    <section className="lens panel" aria-labelledby="lens-h" data-tour="lens">
      <Head lens="Executive" title="Is the business protected?" />
      <ul className="lk-row">
        <Kpi q="What is the risk?" n={isNum(u) && isNum(uc) ? `${Math.round(u)} calls, ${usd(uc, 2)}` : NM('make drill')} note="What one faulty agent would have done in the test window with no controls." v={spec('Risk without controls', 'Calls and spend from the same fault with the agent left ungoverned.', 'drill.callsMean.ungoverned, drill.spendProtectedUsd.ungovernedMean', isNum(u) ? `${Math.round(u)} calls` : 'not measured yet', 'node scripts/drill.ts --runs 20')} />
        <Kpi q="What was the impact?" n={isNum(gv) && isNum(gc) ? `${Math.round(gv)} calls, ${usd(gc, 2)}` : NM('make drill')} note="What it actually did with Roll Call watching." v={spec('Impact with controls', 'Calls and spend from the governed run of the same fault.', 'drill.callsMean.governed, drill.spendProtectedUsd.governedMean', isNum(gv) ? `${Math.round(gv)} calls` : 'not measured yet', 'node scripts/drill.ts --runs 20')} />
        <Kpi q="Is the business protected?" n={stopped ? `Stopped in ${secs(p95)}` : NM('make drill')} note={isNum(d?.timeToContainMs?.uncontained) ? `${d.timeToContainMs.uncontained} of ${d.runs} faults left uncontained.` : undefined} v={spec('Time to stop, p95', 'From the fault starting to the independent probe being refused. The owner acknowledgement is simulated.', 'drill.timeToContainMs.p95', stopped ? secs(p95) : 'not measured yet', 'node scripts/drill.ts --runs 20')} />
      </ul>
      <div className="lens-cols">
        <div><h2 className="lens-h2">What happened</h2><Timeline g={g} typical={st} />{!g && <p className="muted lens-src">Typical timings from the recorded test run{inc ? ` (${inc.label})` : ''}, measured from the start of the fault.</p>}</div>
        <div className="lens-result" role="status"><h2 className="lens-h2">Result</h2>
          <p className="lens-big">{stopped ? <><CircleCheck size={22} aria-hidden /> The faulty agent was stopped within {secs(p95)}, and every further request was denied. The business was protected.</> : 'No result to show yet. Run a drill to produce one.'}</p></div>
      </div>
    </section>
  );
}

function Ops() {
  const agents = useStore((s) => s.agents), fleet = useStore((s) => s.fleet), g = useLatest(), source = useStore((s) => s.source), impact = useStore((s) => s.impact);
  const [ask, setAsk] = useState(false), [msg, setMsg] = useState('');
  const states = (fleet?.states ?? impact?.fleet?.states ?? {}) as Record<string, AgentState>;
  const rank = (id: string) => ({ killed: 0, alert: 1, throttled: 2, healthy: 3 } as Record<string, number>)[states[id]] ?? 4;
  const list = [...agents].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, 6);
  const who = g ? agents.find((a) => a.id === g.agentId) : undefined;
  const live = !REPLAY_ONLY && source === 'live';
  const restore = async () => { setAsk(false); if (!live) { setMsg('Replay only: nothing was changed. In live mode this calls POST /v1/reset, which clears the incident and restores the demo fleet.'); return; } await resetDrills(); setMsg('Restored. The incident was cleared and the fleet reset (POST /v1/reset).'); };
  const acts = g ? (['detected', 'throttled', 'paged', 'owner_ack', 'killed', 'proof'] as const).filter((k) => g.byStage[k]) : [];
  return (
    <section className="lens panel" aria-labelledby="lens-h" data-tour="lens">
      <Head lens="Operations" title="Who is affected, and can we restore safely?" />
      <div className="lens-cols">
        <div><h2 className="lens-h2">Agent status</h2>
          {list.length ? <ul className="lens-agents">{list.map((a) => <li key={a.id}><a href={`#/agent/${encodeURIComponent(a.id)}`}><span>{a.name}</span><StateMark state={states[a.id] ?? 'unknown'} /></a></li>)}</ul> : <p className="muted">No agents loaded yet.</p>}
          <a className="textlink" href="#/registry">All agents and owners<ArrowRight size={14} aria-hidden /></a></div>
        <div><h2 className="lens-h2">The incident</h2>
          {g ? <dl className="lens-dl">
            <div><dt>Agent affected</dt><dd>{who?.name ?? g.agentId}</dd></div>
            <div><dt>What happened</dt><dd>{g.byStage.detected?.message ?? g.last.message}</dd></div>
            <div><dt>Owner</dt><dd>{who ? `${ownerShort(who.owner.name)}, ${who.owner.team}` : 'not on record'}</dd></div>
            <div><dt>Who was alerted</dt><dd>{g.byStage.paged ? <>{g.byStage.paged.message} <Assumption>SIMULATED PAGE</Assumption></> : 'No alert recorded yet'}</dd></div>
            <div><dt>Actions taken</dt><dd>{acts.map((k) => STAGE_WORD[k]).join(', then ')}</dd></div>
          </dl> : <p className="muted">No incident on screen. Every agent is working inside its limits, or a drill has not run yet. Start one from the Drill page and this panel fills in.</p>}
          <div className="lens-restore">
            {!ask ? <button className="btn btn--lg" onClick={() => setAsk(true)}><RotateCcw size={18} aria-hidden />Restore agent</button>
              : <div className="restore-q" role="group" aria-label="Confirm restore"><p><strong>Restore the fleet?</strong> {live ? 'This clears the incident and re-enables stopped agents.' : 'This is a recording, so nothing will change.'}</p><button className="btn btn--primary btn--lg" onClick={restore}>{live ? 'Yes, restore' : 'Explain what would happen'}</button><button className="btn btn--lg" onClick={() => setAsk(false)}>Cancel</button></div>}
            {msg && <p className="lens-msg" role="status">{msg}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

const pass = (t: any): boolean | undefined => { for (const k of ['passed', 'ok', 'pass', 'contained']) if (typeof t?.[k] === 'boolean') return t[k]; if (t?.verdict) return t.verdict === 'deny'; };
function Containment() {
  const c = useStore((s) => s.impact?.containment);
  if (!c) return <p className="muted">Containment tests: not measured yet. Run <code className="measured">make containment</code>.</p>;
  const arr: any[] = Array.isArray(c) ? c : ['tests', 'checks', 'results', 'cases'].map((k) => c[k]).find(Array.isArray) ?? Object.entries(c).filter(([, v]) => typeof v !== 'object').map(([k, v]) => ({ name: k, value: v }));
  return <ul className="lens-tests">{arr.slice(0, 8).map((t, i) => { const p = pass(t); return <li key={i}><span className={`tst ${p === false ? 'tst-bad' : 'tst-ok'}`}>{p === undefined ? String(t.value ?? '') : p ? 'PASS' : 'FAIL'}</span><span>{pickStr(t, ['name', 'test', 'title', 'id', 'description']) ?? `Test ${i + 1}`}</span></li>; })}</ul>;
}
function Eng() {
  const actions = useStore((s) => s.actions), g = useLatest(), det = useStore((s) => s.impact?.detector);
  const log = actions.filter((a) => a.governed && a.verdict !== 'allow').slice(-8).reverse();
  const sig = g?.byStage.detected?.signals;
  const proof = g?.byStage.proof?.proof;
  return (
    <section className="lens panel" aria-labelledby="lens-h" data-tour="lens">
      <Head lens="Engineering" title="How was it caught, and what is the proof?" />
      <div className="lens-cols">
        <div><h2 className="lens-h2">How it was detected</h2>
          {sig ? <p>Rate ratio <span className="measured">{sig.rateRatio?.toFixed?.(1) ?? 'n/a'}x</span>, repeated identical calls <span className="measured">{sig.repeatCount ?? 'n/a'}</span>{sig.cycle ? <>, call cycle <span className="measured">{sig.cycle.join(' > ')}</span></> : null}.</p> : <p className="muted">No incident on screen. {det ? 'Detector results are on the Engineering page.' : NM('make drill')}</p>}
          <h2 className="lens-h2">Proof it cannot act again</h2>
          {proof ? <p>Probe call to <span className="measured">{proof.attemptedTool}</span> was <strong>{proof.verdict === 'deny' ? 'denied' : proof.verdict}</strong> ({proof.code}), receipt <span className="measured">{proof.receiptId}</span>.</p> : <p className="muted">No probe yet.</p>}
          <ReceiptChain max={3} />
        </div>
        <div><h2 className="lens-h2">Rule decisions, newest first</h2>
          {log.length ? <ol className="lens-log">{log.map((a) => <li key={a.receiptId}><span className="measured">{clock(a.ts)}</span><span>{a.agentId}</span><span className="measured">{a.verdict.toUpperCase()} {a.code}</span><span className="muted">{codeWords(a.code)}</span></li>)}</ol> : <p className="muted">No denied or slowed decisions on the stream yet. Run a drill.</p>}
          <h2 className="lens-h2">Containment tests</h2><Containment />
        </div>
      </div>
    </section>
  );
}

export function LensFirst() {
  const lens = useUi((u) => u.lens);
  return lens === 'ops' ? <Ops /> : lens === 'eng' ? <Eng /> : <Exec />;
}
