import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as Tabs from '@radix-ui/react-tabs';
import { motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { Octagon, Pause, Play, Siren, X } from 'lucide-react';
import type { ActionEvent } from '../../../contracts/types';
import { getState, runDrill, useStore, verifyReceipts } from '../store';
import { setUi, useUi } from '../ui-state';
import { Lifecycle } from '../gates';
import { Assumption, CountUp, Initials, NotMeasured, Sparkline, StateMark, Tip, VerdictChip, VerifyButton, clock, groupIncidents, isNum, ownerShort, secs, useLocal, usd, type AgentState } from '../ui';
import { Panel } from '../components';
import { Suspense, lazy } from 'react';
const FleetMap = lazy(() => import('./FleetMap').then((m) => ({ default: m.FleetMap })));
import { computeStats } from '../graph';
import { RollRing } from '../ring';

// ---------------- hero numbers ----------------
interface TileProps { q: string; children: React.ReactNode; note?: React.ReactNode; viz?: React.ReactNode; verify: Parameters<typeof VerifyButton>[0]['spec']; extra?: React.ReactNode }
const Tile = ({ q, children, note, viz, verify, extra }: TileProps) => (
  <article className="tile">
    <h2 className="tile-q">{q}</h2>
    <p className="reading">{children}</p>
    {note && <p className="tile-note">{note}</p>}
    <div className="tile-foot"><div className="tile-viz">{viz}</div><div className="tile-actions">{extra}<VerifyButton spec={verify} /></div></div>
  </article>
);

function StateStrip() {
  const agents = useStore((s) => s.agents);
  const states = useStore((s) => s.fleet?.states);
  const order: AgentState[] = ['healthy', 'alert', 'throttled', 'killed'];
  const counts = order.map((k) => [k, agents.filter((a) => (states?.[a.id] ?? 'unknown') === k).length] as const);
  return (
    <div className="strip" role="img" aria-label={counts.map(([k, n]) => `${n} ${k}`).join(', ')}>
      {agents.map((a) => <span key={a.id} className={`cell s-${states?.[a.id] ?? 'unknown'}`} title={`${a.name}: ${states?.[a.id] ?? 'unknown'}`} />)}
      <span className="strip-l measured">{counts.filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join('  ')}</span>
    </div>
  );
}

/** Governed decisions per 5 s bucket over the last two minutes, from the stream. */
function decisionTrace(actions: ActionEvent[]): number[] {
  const last = actions[actions.length - 1]?.ts; if (!last) return [];
  const out = new Array<number>(24).fill(0);
  for (let i = actions.length - 1; i >= 0; i--) { const k = Math.floor((last - actions[i].ts) / 5000); if (k >= 24) break; if (actions[i].governed) out[23 - k]++; }
  return out;
}

function RangeBar({ p50, p95, max }: { p50: number; p95: number; max: number }) {
  const f = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="range" role="img" aria-label={`p50 ${secs(p50)}, p95 ${secs(p95)}, slowest ${secs(max)}`}>
      <span className="range-fill" style={{ width: f(p95) }} /><span className="range-tick" style={{ left: f(p50) }} /><span className="range-tick range-tick--hi" style={{ left: f(max) }} />
      <span className="range-l measured">p50 {secs(p50)}</span><span className="range-l range-l--r measured">slowest {secs(max)}</span>
    </div>
  );
}

export function Instruments() {
  const lens = useUi((u) => u.lens);
  const impact = useStore((s) => s.impact);
  const fleet = useStore((s) => s.fleet);
  const fleetHist = useStore((s) => s.fleetHist);
  const actions = useStore((s) => s.actions);
  const source = useStore((s) => s.source);
  const [chain, setChain] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = impact?.drill, b = impact?.bench, det = impact?.detector;
  const spendNow = fleet ? Object.values(fleet.spendPerMinUsd).reduce((a, c) => a + c, 0) : undefined;
  const governed = useMemo(() => actions.filter((a) => a.governed), [actions]);
  const blocked = governed.filter((a) => a.verdict !== 'allow').length;
  const alerts = fleet ? Object.values(fleet.states).filter((s) => s !== 'healthy').length : undefined;
  const run = async () => {
    setBusy(true);
    try { const r = await verifyReceipts(); const ok = r.every((x) => x.ok); const n = r.reduce((a, x) => a + (x.count ?? 0), 0); setChain({ ok, text: ok ? `intact, ${n} receipts` : `broken: ${r.find((x) => !x.ok)?.reason ?? 'see receipts'}` }); }
    catch (e) { setChain({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  const exist = (
    <Tile q="What agents exist?" verify={{ title: 'Agents under control', what: 'Registered agents and how many the control plane sees running. Unregistered running must be zero.', field: 'fleet.registered, fleet.running, fleet.unregisteredRunning (live: fleet stream message)', shown: fleet ? `${fleet.running} of ${fleet.registered}` : 'not measured yet', kind: 'measured', command: 'make stack' }}
      viz={<StateStrip />} note={fleet ? <><span className="measured">{fleet.unregisteredRunning}</span> running without a record</> : <NotMeasured cmd="make stack" />}>
      {fleet ? <><CountUp value={fleet.running} format={(n) => Math.round(n).toString()} /><span className="reading-unit"> of {fleet.registered}</span></> : <span className="reading-na">no data</span>}
    </Tile>
  );
  const cost = (
    <Tile q="What does it cost?" verify={{ title: 'Spend right now', what: 'Sum over agents of the measured spend per minute in the latest fleet message. Protected spend is from the drill runs in impact.json.', field: 'fleet.spendPerMinUsd (live); drill.spendProtectedUsd.protectedTotal', shown: isNum(spendNow) ? `${usd(spendNow, 3)} per minute` : 'not measured yet', kind: 'measured', command: 'make stack' }}
      viz={<Sparkline values={fleetHist.map((h) => h.total)} w={150} h={28} label="Fleet spend per minute, recent trend" />}
      note={isNum(d?.spendProtectedUsd?.protectedTotal) ? <><span className="measured">{usd(d.spendProtectedUsd.protectedTotal)}</span> kept out of runaway drills ({d.runs} runs)</> : <NotMeasured cmd="make drill" />}>
      {isNum(spendNow) ? <><CountUp value={spendNow} format={(n) => usd(n, 3)} /><span className="reading-unit"> per min</span></> : <span className="reading-na">no data</span>}
    </Tile>
  );
  const contain = (
    <Tile q="Can I stop one, fast?" verify={{ title: 'Time to contain, p95', what: `From the fault starting to the independent probe being refused, p95 over ${d?.runs ?? 'the'} recorded drill runs. It includes a SIMULATED owner acknowledgement of ${isNum(d?.simulatedOwnerAckMs) ? d.simulatedOwnerAckMs : 'about 1000'} ms (no real person is paged). The automatic part, time to hard throttle and page, is shown separately in the note.`, field: 'drill.timeToContainMs.p95', shown: isNum(d?.timeToContainMs?.p95) ? secs(d.timeToContainMs.p95) : 'not measured yet', kind: 'measured', command: d?.command ?? 'make drill' }}
      viz={isNum(d?.timeToContainMs?.p95) ? <RangeBar p50={d.timeToContainMs.p50} p95={d.timeToContainMs.p95} max={d.timeToContainMs.max} /> : null}
      note={isNum(d?.timeToContainMs?.p95) ? <>over <span className="measured">{Array.isArray(d.timeToContainMs.samples) ? d.timeToContainMs.samples.length : isNum(d.timeToContainMs.samples) ? d.timeToContainMs.samples : d.runs}</span> drills, until the probe is refused. Includes a simulated owner ack of <span className="measured">{isNum(d.simulatedOwnerAckMs) ? secs(d.simulatedOwnerAckMs) : 'about 1 s'}</span>{isNum(d.stagesP95Ms?.paged) && <>; time to hard throttle and page <span className="measured">{secs(d.stagesP95Ms.paged)}</span></>}</> : <NotMeasured cmd="make drill" />}>
      {isNum(d?.timeToContainMs?.p95) ? <CountUp value={d.timeToContainMs.p95 / 1000} format={(n) => `${n.toFixed(1)} s`} /> : <span className="reading-na">no data</span>}
    </Tile>
  );
  const prove = (
    <Tile q="Can I prove it?" verify={{ title: 'Receipts this session', what: 'Governed gateway decisions delivered on the stream since this page connected. Verify recomputes every hash chain on the gateways.', field: 'Live stream: action events (governed: true). Chain: GET /v1/receipts/verify', shown: `${governed.length} decisions`, kind: 'measured', command: 'make verify' }}
      extra={<button className="btn btn--sm btn--primary" onClick={run} disabled={busy}>{busy ? 'Checking' : 'Verify chain'}</button>}
      viz={<div className="viz-stack"><Sparkline values={decisionTrace(actions)} w={150} h={28} label="Governed decisions per five seconds, last two minutes" />{chain ? <span className={`chainstate ${chain.ok ? 'is-ok' : 'is-bad'}`} role="status">Chain {chain.text}</span> : <span className="muted nowrap">Chain not verified yet</span>}</div>}
      note={<><span className="measured">{blocked}</span> denied or slowed so far</>}>
      <CountUp value={governed.length} format={(n) => Math.round(n).toLocaleString('en-US')} /><span className="reading-unit"> decisions</span>
    </Tile>
  );
  const ops = (
    <Tile q="Who needs a person now?" verify={{ title: 'Agents not healthy', what: 'Agents whose state in the latest fleet message is alert, throttled or killed.', field: 'fleet.states (live)', shown: isNum(alerts) ? `${alerts}` : 'not measured yet', kind: 'measured', command: 'make stack' }} viz={<StateStrip />} note={fleet ? 'Open an agent on the map to stop it' : <NotMeasured cmd="make stack" />}>
      {isNum(alerts) ? <><CountUp value={alerts} format={(n) => Math.round(n).toString()} /><span className="reading-unit"> of {fleet?.registered}</span></> : <span className="reading-na">no data</span>}
    </Tile>
  );
  const eng1 = (
    <Tile q="What does control cost in latency?" verify={{ title: 'Overhead at p99', what: 'Difference of two end-to-end p99s: with controls minus the ungoverned baseline. Measured over loopback, plain HTTP, no TLS, in one process on one machine. Not production latency. The in-process decision-path p99 is a separate, smaller number.', field: 'bench.overheadP99Ms', shown: isNum(b?.overheadP99Ms) ? (b.overheadP99Ms > 0 ? `${b.overheadP99Ms.toFixed(2)} ms` : `within run-to-run noise (${b.overheadP99Ms.toFixed(2)} ms measured)`) : 'not measured yet', kind: 'measured', command: b?.command ?? 'make bench' }} note={isNum(b?.throughputRps) ? <><span className="measured">{Math.round(b.throughputRps)}</span> requests per second (loopback, no TLS, not production latency)</> : <NotMeasured cmd="make bench" />}>
      {isNum(b?.overheadP99Ms) && b.overheadP99Ms <= 0 ? <><span>within noise</span><span className="reading-unit"> ({b.overheadP99Ms.toFixed(2)} ms measured, end-to-end p99 difference)</span></> : isNum(b?.overheadP99Ms) ? <><CountUp value={b.overheadP99Ms} format={(n) => n.toFixed(1)} /><span className="reading-unit"> ms, end-to-end p99 difference</span></> : <span className="reading-na">no data</span>}
    </Tile>
  );
  const eng2 = (
    <Tile q="Does the detector cry wolf?" verify={{ title: 'Detector precision and recall', what: `For HARD containment only (hard throttle or kill), over scripted fault and non-fault cases, ${det?.runsPerCase ?? 'n'} runs per case. Soft alerts on negative cases: ${det?.softOnNegatives ? `${det.softOnNegatives.runsWithAlert} of ${det.softOnNegatives.runs} runs` : 'not measured yet'}.`, field: 'detector.precision, detector.recall', shown: det ? `${det.precision} / ${det.recall}` : 'not measured yet', kind: 'measured', command: 'make drill' }} note={det ? <><span className="measured">{det.fp}</span> false alarms, <span className="measured">{det.fn}</span> missed, in <span className="measured">{det.tp + det.fp + det.fn + det.tn}</span> runs ({det.runsPerCase} per case), hard containment only{det.softOnNegatives && <>; soft alerts in <span className="measured">{det.softOnNegatives.runsWithAlert}</span> of <span className="measured">{det.softOnNegatives.runs}</span> healthy runs</>}</> : <NotMeasured cmd="make drill" />}>
      {det ? <><CountUp value={det.precision} format={(n) => n.toFixed(2)} /><span className="reading-unit"> precision</span></> : <span className="reading-na">no data</span>}
    </Tile>
  );
  const set = lens === 'ops' ? [exist, ops, contain, prove] : lens === 'eng' ? [exist, eng1, eng2, prove] : [exist, cost, contain, prove];
  return (
    <div data-tour="tiles"><section className="tiles" aria-label="The four questions">
      {set.map((t, i) => <div key={i} className="tiles-cell">{t}</div>)}
    </section>{source === 'fixture' && <p className="tiles-note">These numbers are fixture placeholders, not a real run.</p>}</div>
  );
}

// ---------------- live decisions ticker (virtualized) ----------------
export function Ticker({ className = '' }: { className?: string }) {
  const actions = useStore((s) => s.actions);
  const agents = useStore((s) => s.agents);
  const [verdict, setVerdict] = useState<'all' | ActionEvent['verdict']>('all');
  const [agent, setAgent] = useState('');
  const [text, setText] = useState('');
  const [paused, setPaused] = useState(false);
  const frozen = useRef<ActionEvent[] | null>(null);
  if (paused && !frozen.current) frozen.current = actions;
  if (!paused) frozen.current = null;
  const src = frozen.current ?? actions;
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    const out: ActionEvent[] = [];
    for (let i = src.length - 1; i >= 0 && out.length < 1500; i--) {
      const a = src[i];
      if (verdict !== 'all' && a.verdict !== verdict) continue;
      if (agent && a.agentId !== agent) continue;
      if (t && !`${a.agentId} ${a.tool} ${a.code} ${a.receiptId}`.toLowerCase().includes(t)) continue;
      out.push(a);
    }
    return out;
  }, [src, verdict, agent, text]);
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 36, overscan: 8 });
  const hasDeny = src.some((a) => a.verdict !== 'allow');
  return (
    <section className={`ticker ${className}`} aria-label="Live gateway decisions">
      <header className="ticker-h">
        <h2>Gateway decisions</h2>
        <button className="btn btn--sm" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}{paused ? 'Resume' : 'Pause'}</button>
      </header>
      <div className="ticker-f">
        <div className="seg" role="group" aria-label="Filter by verdict">
          {(['all', 'allow', 'deny', 'throttle'] as const).map((k) => <button key={k} aria-pressed={verdict === k} onClick={() => setVerdict(k)} disabled={k !== 'all' && k !== 'allow' && !hasDeny}>{k === 'all' ? 'All' : k === 'allow' ? 'Allowed' : k === 'deny' ? 'Denied' : 'Slowed'}</button>)}
        </div>
        <label className="select-wrap"><span className="visually-hidden">Filter by agent</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="search search--s"><span className="visually-hidden">Filter by tool, code or receipt</span><input type="search" placeholder="Tool, code, receipt" value={text} onChange={(e) => setText(e.target.value)} /></label>
      </div>
      <div ref={parent} className="ticker-body" tabIndex={0} role="list" aria-label={`${rows.length} decisions, newest first`}>
        {rows.length === 0 ? <p className="empty">{actions.length ? 'No decision matches these filters.' : 'Waiting for the stream. Decisions appear here the moment the gateway makes them.'}</p> : (
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const a = rows[vi.index];
              const name = agents.find((x) => x.id === a.agentId)?.name ?? a.agentId;
              return (
                <button key={a.receiptId + vi.index} role="listitem" type="button" className={`trow v-${a.verdict}`} style={{ transform: `translateY(${vi.start}px)`, height: vi.size }} onClick={() => setUi({ receipt: a })} aria-label={`${clock(a.ts)} ${name} ${a.tool} ${a.verdict}. Open receipt ${a.receiptId}`}>
                  <span className="measured t-time">{clock(a.ts)}</span>
                  <span className="t-agent">{name}</span>
                  <span className="measured t-tool">{a.tool}</span>
                  <VerdictChip v={a.verdict} code={a.code} />
                  <span className="measured t-cost">{a.governed ? usd(a.costUsd, 4) : 'direct'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------- agent side panel ----------------
export function AgentPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useStore((s) => s.agents.find((x) => x.id === id));
  const state = (useStore((s) => s.fleet?.states?.[id]) ?? 'unknown') as AgentState;
  const rate = useStore((s) => s.fleet?.spendPerMinUsd?.[id]);
  const hist = useStore((s) => s.spendHist[id]) ?? [];
  const actions = useStore((s) => s.actions);
  const incidents = useStore((s) => s.incidents);
  const impact = useStore((s) => s.impact);
  const tab = useUi((u) => u.agentTab);
  const reduce = useReducedMotion();
  if (!a) return <aside className="side"><button className="btn btn--icon side-x" onClick={onClose} aria-label="Close agent panel"><X size={16} aria-hidden /></button><p className="empty">No agent called <code className="measured">{id}</code> is loaded.</p></aside>;
  const mine = actions.filter((x) => x.agentId === id);
  const recent = mine.slice(-30).reverse();
  const stats = computeStats(actions, [a], Date.now());
  const toolRate = (t: string) => stats.rate.get(`${a.id}>${t}`) ?? 0;
  const drift = [...stats.drift.entries()].filter(([k]) => k.startsWith(a.id + '>'));
  const inc = groupIncidents(incidents.filter((e) => e.agentId === id))[0];
  const assumed = impact?.assumptions?.valuePerDayUsd?.[id];
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="kv"><dt>{k}</dt><dd>{children}</dd></div>;
  return (
    <motion.aside className="side" aria-label={`${a.name} details`} initial={reduce ? false : { x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
      <header className="side-h">
        <div>
          <h2>{a.name}</h2>
          <p className="measured muted">{a.id}</p>
        </div>
        <button className="btn btn--icon" onClick={onClose} aria-label="Close agent panel"><X size={16} aria-hidden /></button>
      </header>
      <div className="side-state"><StateMark state={state} /><span className="chip">{a.lifecycleState}</span><span className="chip">{a.riskRating} risk</span></div>
      <p className="side-purpose">{a.purpose}</p>
      <button className="btn btn--danger btn--block" onClick={() => setUi({ killId: a.id })} disabled={state === 'killed'}><Octagon size={16} aria-hidden />{state === 'killed' ? 'Already stopped' : 'Stop this agent'}</button>
      <Tabs.Root value={tab} onValueChange={(v) => setUi({ agentTab: v as typeof tab })} className="tabs">
        <Tabs.List className="tabs-l" aria-label="Agent detail">
          <Tabs.Trigger value="now">Now</Tabs.Trigger><Tabs.Trigger value="touch">What it can touch</Tabs.Trigger><Tabs.Trigger value="record">Record</Tabs.Trigger><Tabs.Trigger value="lifecycle">Lifecycle</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="now" className="tabs-c">
          <dl>
            <Row k="Spend rate">{typeof rate === 'number' ? <span className="measured">{usd(rate, 3)} per minute</span> : <NotMeasured cmd="make stack" />}<div className="mt-s"><Sparkline values={hist} w={260} h={34} label="Spend per minute trend" /></div></Row>
            <Row k="Owner"><span className="owner"><Initials name={a.owner.name} /> {ownerShort(a.owner.name)}, {a.owner.team}</span><br /><span className="measured muted">{a.owner.escalation}</span></Row>
            {inc && <Row k="Latest incident"><span>{inc.last.message}</span> <span className="measured muted">{clock(inc.last.ts)}</span></Row>}
            <Row k="Value per day">{isNum(assumed) ? <><span className="measured">{usd(assumed)}</span> <Assumption /></> : <span className="muted">No assumption set. Use the value ledger.</span>}</Row>
          </dl>
          <h3 className="sub">Recent decisions</h3>
          {recent.length ? <ul className="mini-list">{recent.slice(0, 8).map((x) => <li key={x.receiptId}><button className="linklike" onClick={() => setUi({ receipt: x })}><span className="measured">{clock(x.ts)}</span> <span className="measured">{x.tool}</span> <VerdictChip v={x.verdict} code={x.code} /></button></li>)}</ul> : <p className="muted">None seen in this session.</p>}
        </Tabs.Content>
        <Tabs.Content value="touch" className="tabs-c">
          <h3 className="sub">Tools, live calls per second</h3>
          <ul className="mini-list">{a.scopes.tools.map((t) => <li key={t} className="kv-row"><span className="measured">{t}</span><span className="measured">{toolRate(t).toFixed(1)}/s</span></li>)}</ul>
          <h3 className="sub">Data</h3>
          <p className="taglist">{a.scopes.data.map((t) => <span className="tag" key={t}>{t.replace(/^synthetic-/, '')}</span>)}</p>
          <h3 className="sub">Out of scope, last minute</h3>
          {drift.length ? <ul className="mini-list">{drift.map(([k, v]) => <li key={k} className="kv-row drift"><span className="measured">{k.split('>')[1]}</span><span className="measured">{v.count} calls{v.denied ? ', denied' : ''}</span></li>)}</ul> : <p className="muted">None. Everything it called is in its scope.</p>}
        </Tabs.Content>
        <Tabs.Content value="record" className="tabs-c">
          <dl>
            <Row k="Approved uses">{a.approvedUses.length ? a.approvedUses.join('. ') : <span className="muted">None recorded</span>}</Row>
            <Row k="Limitations">{a.limitations.length ? a.limitations.join('. ') : <span className="muted">None recorded</span>}</Row>
            <Row k="Evaluation">{a.evaluation ? <span>{a.evaluation.passed ? 'Passed' : 'Failed'} on <span className="measured">{a.evaluation.date}</span></span> : <span className="muted">No evaluation on record</span>}</Row>
            <Row k="Budgets"><span className="measured">{usd(a.budgets.perHourUsd)}/h, {usd(a.budgets.perDayUsd)}/day, {usd(a.budgets.perTaskUsd)}/task</span></Row>
            <Row k="Models"><span className="measured">{a.models.join(', ')}</span></Row>
            <Row k="Residency"><span className="measured">{a.residency}</span></Row>
            <Row k="Reviewed by">{a.reviewer}, approved by {a.approver}</Row>
          </dl>
        </Tabs.Content>
        <Tabs.Content value="lifecycle" className="tabs-c"><Lifecycle key={a.id} agent={a} /></Tabs.Content>
      </Tabs.Root>
    </motion.aside>
  );
}

// ---------------- incident banner ----------------
function IncidentBanner() {
  const incidents = useStore((s) => s.incidents);
  const agents = useStore((s) => s.agents);
  const newest = useStore((s) => s.actions[s.actions.length - 1]?.ts ?? 0);
  const g = groupIncidents(incidents)[0];
  if (!g || g.last.stage === 'resolved' || (newest > 0 && newest - g.last.ts > 120000)) return null;
  const name = agents.find((a) => a.id === g.agentId)?.name ?? g.agentId;
  return (
    <div className="banner" role="status">
      <Siren size={16} aria-hidden /><strong>{name}</strong><span>{g.last.message}</span>
      <a className="btn btn--sm" href="#/drill">Open the drill view</a>
    </div>
  );
}


// ---------------- business band ----------------
function BusinessBand() {
  const impact = useStore((s) => s.impact);
  const fleet = useStore((s) => s.fleet);
  const d = impact?.drill;
  const kept = d?.spendProtectedUsd?.protectedTotal;
  const p95 = d?.timeToContainMs?.p95;
  const NM = <span className="biz-na">not measured yet</span>;
  return (
    <section className="biz" data-tour="biz" aria-labelledby="biz-h">
      <h1 id="biz-h" className="biz-h">Banks are going from a few AI pilots to thousands of agents.</h1>
      <div className="biz-grid">
        <div className="biz-problem">
          <p className="biz-k">The problem: four questions nobody can answer fast</p>
          <ol className="biz-q"><li>What agents exist?</li><li>What does it cost?</li><li>Can I stop one, fast?</li><li>Can I prove it?</li></ol>
        </div>
        <div className="biz-answer">
          <p className="biz-k">Roll Call answers all four, live</p>
          <ul className="biz-out">
            <li><span className="biz-n measured">{isNum(kept) ? usd(kept) : NM}</span><span className="biz-l">spend protected{isNum(d?.runs) ? <> over {d.runs} runaway drills</> : null}</span></li>
            <li><span className="biz-n measured">{isNum(p95) ? secs(p95) : NM}</span><span className="biz-l">time to contain, p95, with a simulated owner ack{isNum(d?.simulatedOwnerAckMs) ? <> of {secs(d.simulatedOwnerAckMs)}</> : null} (no real person is paged)</span></li>
            <li><span className="biz-n measured">{fleet ? `${fleet.registered} registered, ${fleet.unregisteredRunning} unregistered` : NM}</span><span className="biz-l">agents under control</span></li>
          </ul>
        </div>
      </div>
      <p className="biz-why"><strong>Why now:</strong> OSFI E-23 (model risk management) takes effect May 1, 2027 and expects a live, owned inventory. This is an engineering interpretation, not compliance advice.</p>
    </section>
  );
}

// ---------------- screen ----------------
export function Fleet({ selected }: { selected: string | null }) {
  const [view, setView] = useLocal<'roll' | 'topology'>('view', 'roll');
  const select = (id: string | null) => { location.hash = id ? `#/agent/${encodeURIComponent(id)}` : '#/'; };
  const goDrill = () => { const r = getState().drillRun; location.hash = '#/drill'; if (!r || r.phase === 'done' || r.phase === 'error') void runDrill('runaway-loop', true); };
  const source = useStore((s) => s.source);
  return (
    <div className="fleet">
      <BusinessBand />
      <section className={`hero ${selected ? 'has-side' : ''}`}>
        <div className="hero-l">
          {selected ? <AgentPanel id={selected} onClose={() => select(null)} /> : (
            <>
              <h2 className="hero-h">Every agent answers the roll.</h2>
              <p className="hero-p">Roll Call watches a bank's AI agents (software workers) and can stop one that goes wrong, with proof.</p>
              <div className="hero-a">
                <button className="btn btn--primary btn--lg" onClick={goDrill}><Play size={16} aria-hidden />Run a drill</button>
                <a className="btn btn--lg" href="#/replay">Watch a recorded run</a>
              </div>
              {source === 'fixture' && <p className="hero-n">Fixture mode: the roll below is invented placeholder data.</p>}
            </>
          )}
        </div>
        <Panel className="ring-panel" title={view === 'roll' ? 'The roll' : 'Topology'} id="map-h" aside={
          <div className="seg" role="group" aria-label="Fleet view">
            <button aria-pressed={view === 'roll'} onClick={() => setView('roll')}>Roll</button>
            <button aria-pressed={view === 'topology'} onClick={() => setView('topology')}>Topology</button>
          </div>}>
          <div className="ring-frame" data-tour="map">
            {view === 'roll' ? <RollRing selected={selected} onSelect={select} /> : <div className="map-frame map-frame--home"><Suspense fallback={<p className="empty" role="status">Loading the topology</p>}><FleetMap selected={selected} onSelect={select} /></Suspense></div>}
          </div>
          {view === 'roll' && <p className="ring-hint">Arrow keys move around the ring. Enter opens an agent record.</p>}
        </Panel>
      </section>
      <Instruments />
      <IncidentBanner />
      <Ticker className="ticker--wide" />
    </div>
  );
}

export const toastPaged = (who: string, escalation: string) => toast(`Paged owner ${who} (simulated)`, { description: escalation });
export { getState, Tip };
