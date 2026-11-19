import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BadgeCheck, Check, ShieldOff } from 'lucide-react';
import { FIXTURE, verifyReceipts, useStore } from '../store';
import { Assumption, FixtureChip, Measured, NotMeasured, VerifyButton, isNum, secs, useLocal } from '../ui';
import { Panel } from '../components';
import { EChart, baseOption, usePalette } from '../charts';

/** Design targets from docs/latency-budget.md and docs/availability-model.md. They are targets, never results. */
const detRuns = (d: { tp: number; fp: number; fn: number; tn: number }) => d.tp + d.fp + d.fn + d.tn;
const TARGETS = { decisionP99Ms: 50, containP95Ms: 30_000, dataPlane: 99.95, controlPlane: 99.9 };

function Burn({ label, used, target, measured, unit, cmd, verify }: { label: string; used?: number; target: string; measured: string; unit?: string; cmd: string; verify: Parameters<typeof VerifyButton>[0]['spec'] }) {
  const reduce = useReducedMotion();
  const f = used == null ? null : Math.min(1.2, used);
  return (
    <article className="slo">
      <h3>{label}</h3>
      <p className="reading reading--m">{used == null ? <span className="reading-na">no data</span> : <>{measured}<span className="reading-unit"> {unit}</span></>}</p>
      <div className="burn" role="img" aria-label={used == null ? 'not measured' : `${Math.round(used * 100)} percent of the budget used`}>
        <motion.span className={`burn-fill ${used != null && used > 1 ? 'is-over' : used != null && used > 0.7 ? 'is-hot' : ''}`} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: Math.min(1, f ?? 0) }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      <p className="tile-note">{used == null ? <NotMeasured cmd={cmd} /> : <>Budget used <span className="measured">{used < 0.01 ? '<1' : Math.round(used * 100)}%</span> of a <span className="measured">{target}</span> target</>}</p>
      <div className="tile-actions"><VerifyButton spec={verify} /></div>
    </article>
  );
}

const NODES: { id: string; plane: 'control' | 'data' | 'edge'; x: number; y: number; w: number; label: string; text: string }[] = [
  { id: 'agents', plane: 'edge', x: 14, y: 150, w: 120, label: 'Agent fleet', text: 'Simulated agents. Every action goes through a gateway. They hold short-lived identities and no standing credentials.' },
  { id: 'gw', plane: 'data', x: 230, y: 56, w: 250, label: 'Gateway replicas', text: 'Decides each call: identity, revoked, scope, budget and throttle, policy, masking, forward, receipt. A stale bundle fails closed for high-risk tools.' },
  { id: 'tools', plane: 'data', x: 230, y: 214, w: 250, label: 'Tools and models', text: 'Mock bank tools and recorded model responses. Only allowed calls reach them.' },
  { id: 'receipts', plane: 'data', x: 230, y: 130, w: 250, label: 'Receipt chain', text: 'Every decision is appended to a hash chain per gateway. Verify recomputes the hashes and names the first bad sequence.' },
  { id: 'registry', plane: 'control', x: 600, y: 36, w: 180, label: 'Registry and admission', text: 'The inventory of agents with owners, scopes and evaluations. Admission refuses anything unregistered.' },
  { id: 'issuer', plane: 'control', x: 600, y: 98, w: 180, label: 'Identity issuer', text: 'Issues short-lived signed identities. Refuses revoked or unregistered agents.' },
  { id: 'bundle', plane: 'control', x: 600, y: 160, w: 180, label: 'Policy bundle', text: 'Scopes, budgets, throttles, revocations and prices. Gateways pull it and cache it for static stability.' },
  { id: 'engine', plane: 'control', x: 600, y: 222, w: 180, label: 'Detector and incidents', text: 'Deterministic. Compares each agent with its own baseline; one signal throttles, two signals page and kill.' },
  { id: 'kill', plane: 'control', x: 600, y: 284, w: 180, label: 'Kill and probe', text: 'Revokes the identity, stops the runtime, then an independent probe tries to act as the agent and must be denied.' },
  { id: 'ui', plane: 'edge', x: 830, y: 150, w: 100, label: 'This UI', text: 'Reads the SSE stream and the HTTP API. Every number links to its source.' },
];
const LINKS: [string, string, string][] = [['agents', 'gw', 'act'], ['gw', 'tools', 'allowed only'], ['gw', 'receipts', 'append'], ['gw', 'bundle', 'pull'], ['gw', 'engine', 'events'], ['engine', 'kill', 'escalate'], ['kill', 'issuer', 'revoke'], ['kill', 'gw', 'probe'], ['engine', 'ui', 'stream'], ['registry', 'bundle', 'records']];

function DetectorCases({ det }: { det: any }) {
  const rows = Object.entries(det.cases ?? {}) as [string, { positive: boolean; runs: number; detected: number; hardContained: number; collateral: number }][];
  const neg = det.softOnNegatives;
  return (
    <>
      <div className="tablewrap"><table>
        <caption className="visually-hidden">Detector results per scripted case, {det.runsPerCase} runs each</caption>
        <thead><tr><th scope="col">Case</th><th scope="col">Should contain?</th><th scope="col">Runs</th><th scope="col">Soft or hard alert</th><th scope="col">Hard contained</th><th scope="col">Other agents alerted</th></tr></thead>
        <tbody>{rows.map(([k, c]) => <tr key={k}><th scope="row">{k}</th><td>{c.positive ? 'yes' : 'no'}</td><td className="measured">{c.runs}</td><td className="measured">{c.detected}</td><td className="measured">{c.hardContained}</td><td className="measured">{c.collateral}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Totals</th><td colSpan={5} className="measured">tp {det.tp}, fp {det.fp}, fn {det.fn}, tn {det.tn}</td></tr></tfoot>
      </table></div>
      {neg && <p className="tile-note">Soft alerts on the negative cases: <span className="measured">{neg.runsWithAlert}</span> of <span className="measured">{neg.runs}</span> runs raised a soft alert on some agent. Soft alerts only throttle gently and are not counted as false alarms above.</p>}
    </>
  );
}

function Arch() {
  const [sel, setSel] = useState('gw');
  const n = NODES.find((x) => x.id === sel)!;
  const by = Object.fromEntries(NODES.map((x) => [x.id, x]));
  const mid = (id: string) => ({ x: by[id].x + by[id].w / 2, y: by[id].y + 20 });
  const reduce = useReducedMotion();
  return (
    <div className="arch">
      <svg viewBox="0 0 950 340" role="group" aria-label="Architecture: the control plane on the right, the data plane in the middle">
        <rect x="205" y="20" width="300" height="290" rx="10" className="plane plane--data" /><text x="220" y="44" className="plane-t">Data plane</text>
        <rect x="575" y="8" width="230" height="326" rx="10" className="plane plane--control" /><text x="590" y="26" className="plane-t">Control plane</text>
        {LINKS.map(([a, b, t]) => {
          const p = mid(a), q = mid(b); const on = sel === a || sel === b;
          return <g key={a + b} className={`link ${on ? 'is-on' : ''}`}><line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={!reduce && on ? 'flow' : ''} /><text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 4} textAnchor="middle">{t}</text></g>;
        })}
        {NODES.map((x) => (
          <g key={x.id} className={`anode-svg ${sel === x.id ? 'is-on' : ''}`} tabIndex={0} role="button" aria-pressed={sel === x.id} aria-label={`${x.label}. ${x.text}`} onClick={() => setSel(x.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(x.id); } }}>
            <rect x={x.x} y={x.y} width={x.w} height={40} rx="6" /><text x={x.x + x.w / 2} y={x.y + 25} textAnchor="middle">{x.label}</text>
          </g>
        ))}
      </svg>
      <div className="arch-note" aria-live="polite"><h3>{n.label}</h3><p>{n.text}</p><p className="muted">{n.plane === 'control' ? 'Control plane' : n.plane === 'data' ? 'Data plane' : 'Outside both planes'}</p></div>
    </div>
  );
}

export function Engineering() {
  const impact = useStore((s) => s.impact);
  const source = useStore((s) => s.source);
  const p = usePalette();
  const b = impact?.bench, d = impact?.drill, det = impact?.detector;
  const [rec, setRec] = useState<Awaited<ReturnType<typeof verifyReceipts>> | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const designLat = isNum(b?.targetDecisionP99Ms) ? b.targetDecisionP99Ms : TARGETS.decisionP99Ms;
  const containTarget = isNum(d?.budgetsMs?.containP95) ? d.budgetsMs.containP95 : TARGETS.containP95Ms;
  const [latEdit, setLat] = useLocal<number | null>('latTarget2', null);
  const lat = latEdit ?? designLat;
  const verify = async () => { setBusy(true); setErr(''); try { setRec(await verifyReceipts()); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const opt = useMemo(() => b ? ({
    ...baseOption(p),
    legend: { top: 0, right: 0, textStyle: { color: p.ink2 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: ['p50', 'p95', 'p99'], axisLabel: { color: p.ink2 }, axisLine: { lineStyle: { color: p.rule2 } } },
    yAxis: { type: 'value', name: 'ms', nameTextStyle: { color: p.muted }, axisLabel: { color: p.muted }, splitLine: { lineStyle: { color: p.rule } } },
    series: [
      { name: 'Ungoverned baseline', type: 'bar', data: ['p50', 'p95', 'p99'].map((k) => b.direct?.[k] ?? null), itemStyle: { color: p.rule2, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 36, label: { show: true, position: 'top', color: p.muted, fontFamily: p.mono, formatter: (q: { value: number }) => `${Number(q.value.toPrecision(2))}` } },
      { name: 'With Roll Call', type: 'bar', data: ['p50', 'p95', 'p99'].map((k) => b.governed?.[k] ?? null), itemStyle: { color: p.cool, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 36, label: { show: true, position: 'top', color: p.ink, fontFamily: p.mono, formatter: (q: { value: number }) => `${Number(q.value.toPrecision(2))}` } },
    ],
    tooltip: { ...(baseOption(p).tooltip as object), valueFormatter: (v: number) => `${v} ms` },
  }) : null, [b, p]);
  const lbl = (x: unknown) => (isNum(x) ? `${Number(x.toPrecision(3))}` : '—'); // 3 significant digits: a laptop timer has no more
  return (
    <div className="eng">
      <header className="page-h"><div><h1>Engineering</h1><p className="lead">What control costs in latency, how much of each budget is used, and how a call is decided.</p></div>{source === 'fixture' && <FixtureChip />}</header>

      <Panel title="Latency against the ungoverned path (in-process decision timer; overhead is end to end, loopback, no TLS)" id="lat-h" aside={<VerifyButton spec={{ title: 'Gateway latency', what: 'End-to-end latency with controls compared with calling the tool with no controls at all. The overhead is the difference of two end-to-end p99s, over loopback, plain HTTP, no TLS, in one process: not production latency.', field: 'bench.governed, bench.direct, bench.overheadP99Ms, bench.throughputRps', shown: isNum(b?.overheadP99Ms) ? `+${b.overheadP99Ms} ms at p99` : 'not measured yet', kind: 'measured', command: b?.command ?? 'make bench' }} />}>
        {b && opt ? (
          <div className="grid-2 grid-2--wide">
            <EChart option={opt} height={280} label="Decision latency at p50, p95 and p99, with Roll Call and without" />
            <dl className="bigfacts">
              <div><dt>Overhead: difference of end-to-end p99s (loopback, no TLS)</dt><dd className="reading reading--m">{lbl(b.overheadP99Ms)}<span className="reading-unit"> ms</span></dd></div>
              <div><dt>Throughput</dt><dd className="reading reading--m">{lbl(b.throughputRps)}<span className="reading-unit"> req/s</span></dd></div>
              <div><dt>Source</dt><dd><Measured /> <span className="measured">{b.command}</span></dd></div>
            </dl>
          </div>
        ) : <p className="empty"><NotMeasured cmd="make bench" /></p>}
      </Panel>

      <section aria-labelledby="slo-h" className="slos">
        <div className="slos-h"><h2 id="slo-h">Budgets and burn</h2><p className="muted">Targets come from <span className="measured">impact.json</span> budgets where present, else <span className="measured">docs/latency-budget.md</span> and <span className="measured">docs/availability-model.md</span>. They are design targets, not results.</p></div>
        <div className="slo-grid">
          <Burn label="Decision path p99 (in-process)" used={isNum(b?.governed?.p99) ? b.governed.p99 / lat : undefined} target={`${lat} ms`} measured={lbl(b?.governed?.p99)} unit="ms measured" cmd="make bench" verify={{ title: 'Decision path p99 against target', what: 'In-process p99 of the gateway decision path (a timer around the decision code only, no I/O or TLS) divided by the p99 target.', field: 'bench.governed.p99 / target', shown: isNum(b?.governed?.p99) ? `${b.governed.p99} ms of ${lat} ms` : 'not measured yet', kind: 'measured', command: 'make bench', extra: 'The target is a design target; you can change it below.' }} />
          <Burn label="Time to contain p95" used={isNum(d?.timeToContainMs?.p95) ? d.timeToContainMs.p95 / containTarget : undefined} target={secs(containTarget)} measured={isNum(d?.timeToContainMs?.p95) ? (d.timeToContainMs.p95 / 1000).toFixed(1) : '—'} unit="s measured" cmd="make drill" verify={{ title: 'Containment p95 against target', what: `Measured p95 time from fault to proof, over ${d?.runs ?? 'the recorded'} drills, divided by the 30 s target. It includes a SIMULATED owner acknowledgement of ${isNum(d?.simulatedOwnerAckMs) ? d.simulatedOwnerAckMs : 'about 1000'} ms. Time to hard throttle and page, p95: ${isNum(d?.stagesP95Ms?.paged) ? secs(d.stagesP95Ms.paged) : 'not measured'}.`, field: 'drill.timeToContainMs.p95', shown: isNum(d?.timeToContainMs?.p95) ? secs(d.timeToContainMs.p95) : 'not measured yet', kind: 'measured', command: 'make drill' }} />
          <article className="slo"><h3>Detector errors</h3>
            <p className="reading reading--m">{det ? <>{det.fp}<span className="reading-unit"> false alarms, {det.fn} missed</span></> : <span className="reading-na">no data</span>}</p>
            <p className="tile-note">{det ? <>HARD containment only: precision <span className="measured">{det.precision}</span>, recall <span className="measured">{det.recall}</span>, tp/fp/fn/tn <span className="measured">{det.tp}/{det.fp}/{det.fn}/{det.tn}</span> over <span className="measured">{detRuns(det)}</span> runs ({det.runsPerCase} per case)</> : <NotMeasured cmd="make drill" />}</p>
            <div className="tile-actions"><VerifyButton spec={{ title: 'Detector accuracy', what: 'Precision and recall for HARD containment (hard throttle or kill) over scripted fault and non-fault cases, with the number of runs per case. Soft alerts on healthy runs are counted separately in the table below. No documented budget, so no burn bar.', field: 'detector.precision, detector.recall, detector.tp/fp/fn/tn', shown: det ? `${det.precision} / ${det.recall}` : 'not measured yet', kind: 'measured', command: 'make drill' }} /></div></article>
          <article className="slo"><h3>Availability</h3>
            <p className="reading reading--m"><span className="reading-na">{impact?.chaos ? 'game days recorded' : 'no data'}</span></p>
            <p className="tile-note">Targets: data plane <span className="measured">{TARGETS.dataPlane}%</span> (21.6 min per 30 days), control plane <span className="measured">{TARGETS.controlPlane}%</span> (43.2 min). {impact?.chaos ? 'See the game-day results below.' : <NotMeasured cmd="make chaos" />}</p>
            <div className="tile-actions"><VerifyButton spec={{ title: 'Availability', what: 'Targets and implied downtime budgets are arithmetic from docs/availability-model.md. Measured availability would come from the chaos game days.', field: 'chaos (impact.json)', shown: impact?.chaos ? 'recorded' : 'not measured yet', kind: 'measured', command: 'make chaos' }} /></div></article>
        </div>
        <label className="targetrow">Decision p99 target <Assumption>ASSUMPTION</Assumption> <input className="field field--s measured" inputMode="numeric" value={lat} onChange={(e) => setLat(Number(e.target.value.replace(/[^0-9]/g, '')) || null)} aria-label="Decision path p99 target in milliseconds" /> ms <span className="muted">The design target is {designLat} ms. Change it to see the burn move.</span></label>
        {impact?.chaos && <details className="details"><summary>Game-day results (chaos)</summary><pre className="codeblock measured">{JSON.stringify(impact.chaos, null, 2)}</pre></details>}
      </section>

      {det && <Panel title="Detector cases" id="det-h"><DetectorCases det={det} /></Panel>}

      <div className="grid-2 grid-2--wide">
        <Panel title="How a call is decided" id="arch-h"><Arch /></Panel>
        <Panel title="Receipts" id="rc-h">
          <p className="muted">Every gateway decision is written to a hash chain. Recompute it to prove nothing was edited. {FIXTURE && <FixtureChip />}</p>
          <button className="btn btn--primary" onClick={verify} disabled={busy}><BadgeCheck size={16} aria-hidden />{busy ? 'Recomputing' : 'Verify receipt chains'}</button>
          <div aria-live="polite" className="stack-s">
            {err && <p className="note-bad">{err}</p>}
            {rec?.map((r) => <p key={r.gateway} className={r.ok ? 'note-ok' : 'note-bad'}>{r.ok ? <Check size={14} aria-hidden /> : <ShieldOff size={14} aria-hidden />} {r.gateway}: {r.ok ? `chain intact${r.count != null ? `, ${r.count} receipts` : ''}` : `BROKEN ${r.reason ?? ''}`}</p>)}
          </div>
        </Panel>
      </div>
    </div>
  );
}
