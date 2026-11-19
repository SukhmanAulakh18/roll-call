import { useState } from 'react';
import { verifyReceipts, useStore } from '../store';
import { Measured, NotMeasured, StateIcon, VerifyButton, isNum } from '../ui';

const PCTS = ['p50', 'p95', 'p99'];
export function Engineering() {
  const impact = useStore((s) => s.impact);
  const b = impact?.bench, det = impact?.detector;
  const [rec, setRec] = useState<Awaited<ReturnType<typeof verifyReceipts>> | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const verify = async () => { setBusy(true); setErr(''); try { setRec(await verifyReceipts()); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const cell = (o: any, k: string) => (isNum(o?.[k]) ? `${o[k]} ms` : '—');
  return (
    <div className="space-y-8">
      <h1 className="h-display text-5xl">Engineering view</h1>

      <section className="panel" aria-labelledby="lat">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="lat" className="h-display text-3xl">Gateway latency</h2>
          <VerifyButton spec={{ title: 'Gateway latency', what: 'How long the gateway takes to decide allow, deny or throttle, compared with calling the tool with no controls at all.', field: 'bench.governed, bench.direct, bench.overheadP99Ms, bench.throughputRps', shown: isNum(b?.overheadP99Ms) ? `+${b.overheadP99Ms} ms at p99` : 'not measured yet', kind: 'measured', command: b?.command ?? 'make bench' }} /></div>
        {b ? (
          <>
            <table className="mt-4 w-full max-w-xl"><thead><tr><th className="th"><span className="sr-only">Path</span></th>{PCTS.map((p) => <th key={p} className="th text-right">{p}</th>)}</tr></thead>
              <tbody><tr><td className="td">With Roll Call <Measured /></td>{PCTS.map((p) => <td key={p} className="td text-right tabular-nums">{cell(b.governed, p)}</td>)}</tr>
                <tr><td className="td">Ungoverned baseline</td>{PCTS.map((p) => <td key={p} className="td text-right tabular-nums">{cell(b.direct, p)}</td>)}</tr></tbody></table>
            <dl className="mt-5 flex flex-wrap gap-12"><div><dt className="text-mute">Overhead at p99</dt><dd className="h-display text-4xl">{isNum(b.overheadP99Ms) ? `${b.overheadP99Ms} ms` : '—'}</dd></div><div><dt className="text-mute">Throughput</dt><dd className="h-display text-4xl">{isNum(b.throughputRps) ? `${b.throughputRps} req/s` : '—'}</dd></div></dl>
          </>
        ) : <p className="mt-4 text-lg"><NotMeasured cmd="make bench" /></p>}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="panel" aria-labelledby="det"><h2 id="det" className="h-display text-3xl">Detector accuracy</h2>
          {det ? <dl className="mt-4 grid grid-cols-2 gap-4"><div><dt className="text-mute">Precision</dt><dd className="h-display text-4xl">{det.precision}</dd></div><div><dt className="text-mute">Recall</dt><dd className="h-display text-4xl">{det.recall}</dd></div>
            <div className="col-span-2 text-mute">Over {det.cases} cases: {det.tp} caught, {det.fp} false alarms, {det.fn} missed, {det.tn} correctly left alone.</div></dl>
            : <p className="mt-4"><NotMeasured cmd="make drill" /></p>}
          <div className="mt-3"><VerifyButton spec={{ title: 'Detector accuracy', what: 'Precision and recall of the incident detector over scripted fault and non-fault cases.', field: 'detector.precision, detector.recall, detector.tp/fp/fn/tn', shown: det ? `${det.precision} / ${det.recall}` : 'not measured yet', kind: 'measured', command: 'make drill' }} /></div>
        </section>
        <section className="panel" aria-labelledby="rc"><h2 id="rc" className="h-display text-3xl">Receipts</h2>
          <p className="mt-1 text-mute">Every gateway decision is written to a hash chain. Recompute it to prove nothing was edited.</p>
          <button className="btn btn-accent mt-4" onClick={verify} disabled={busy}>{busy ? 'Checking…' : 'Verify receipt chains'}</button>
          <div aria-live="polite" className="mt-4">
            {err && <p className="text-accent">{err}</p>}
            {rec?.map((r) => <p key={r.gateway} className="flex items-center gap-2"><StateIcon state={r.ok ? 'healthy' : 'alert'} />{r.gateway}: {r.ok ? `chain intact${r.count != null ? `, ${r.count} receipts` : ''}` : `BROKEN ${r.reason ?? ''}`}</p>)}
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="arch"><h2 id="arch" className="h-display text-3xl">How a call is decided</h2>
        <ol className="mt-4 grid gap-3 text-[0.95rem] md:grid-cols-4">
          {[['1 Who is calling', 'Short-lived signed identity. Revoked identities stop here.'], ['2 May it touch this', 'Tool and data scope from the registry record.'], ['3 Can it afford this', 'Budget and throttle limits from the policy bundle. A stale bundle fails closed for high-risk tools.'], ['4 Record it', 'Allow, deny or slow, with a hash-chained receipt and an event to the control plane.']].map(([h, t]) => <li key={h} className="rounded-md border border-line p-4"><strong>{h}</strong><br /><span className="text-mute">{t}</span></li>)}
        </ol>
        <p className="mt-4 text-mute">The control plane watches the event stream, compares each agent with its own baseline, and throttles, pages, then revokes. A probe then proves the agent is blocked.</p>
        {impact?.chaos && <details className="mt-4"><summary className="cursor-pointer">Game-day results (chaos)</summary><pre className="mt-2 max-h-64 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs">{JSON.stringify(impact.chaos, null, 2)}</pre></details>}
      </section>
    </div>
  );
}
