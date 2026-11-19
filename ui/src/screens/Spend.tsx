import { useStore } from '../store';
import { Assumption, Measured, NotMeasured, VerifyButton, clock, isNum, useLocal, usd } from '../ui';

function Bars({ title, rows, id }: { title: string; rows: [string, number][]; id: string }) {
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;
  return (
    <section className="panel" aria-labelledby={id}>
      <h2 id={id} className="h-display text-2xl">{title}</h2>
      {sorted.length ? <ul className="mt-3 space-y-2">{sorted.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[9rem_1fr_5rem] items-center gap-3 text-[0.92rem]"><span className="truncate" title={k}>{k}</span><span className="h-3 rounded-sm bg-raised" aria-hidden="true"><span className="block h-3 rounded-sm bg-ink" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></span><span className="text-right tabular-nums">{usd(v)}</span></li>))}</ul>
        : <p className="mt-3 text-mute">Waiting for the stream.</p>}
    </section>
  );
}

export function Spend() {
  const t = useStore((s) => s.totals);
  const agents = useStore((s) => s.agents);
  const impact = useStore((s) => s.impact);
  const [edits, setEdits] = useLocal<Record<string, string>>('prices', {});
  const defaults: Record<string, number> = impact?.assumptions?.pricesUsdPerCall ?? {};
  const team: Record<string, number> = {};
  Object.entries(t.cost).forEach(([id, c]) => { const k = agents.find((a) => a.id === id)?.owner?.team ?? 'unknown'; team[k] = (team[k] ?? 0) + c; });
  const total = Object.values(t.cost).reduce((a, b) => a + b, 0);
  const tools = [...new Set([...Object.keys(defaults), ...Object.keys(t.callsTool)])].sort();
  const price = (k: string) => (edits[k] != null && edits[k] !== '' ? Number(edits[k]) : defaults[k]);
  const whatIf = tools.reduce((s, k) => s + (isNum(price(k)) ? (t.callsTool[k] ?? 0) * price(k) : t.costTool[k] ?? 0), 0);
  return (
    <div className="space-y-8">
      <div><h1 className="h-display text-5xl">Spend and routing</h1>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-lg">{t.first ? <>Measured spend so far: <strong>{usd(total)}</strong> from {clock(t.first)} to {clock(t.last!)}</> : 'Waiting for the stream.'} <Measured />
          <VerifyButton spec={{ title: 'Spend by agent, team and tool', what: 'Sum of costUsd on every governed action the stream delivered since this page connected.', field: 'Live stream: action.costUsd (not stored in impact.json)', shown: usd(total), kind: 'measured', command: 'make stack' }} /></p></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Bars id="b1" title="By agent" rows={Object.entries(t.cost)} />
        <Bars id="b2" title="By team" rows={Object.entries(team)} />
        <Bars id="b3" title="By tool" rows={Object.entries(t.costTool)} />
      </div>
      <p className="text-mute">By model: <span className="italic">not measured yet</span>. Action events do not carry a model id, so cost is shown per tool. Run <code className="font-mono text-ink">make stack</code> after the gateway starts reporting models.</p>

      <section className="panel" aria-labelledby="wi">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="wi" className="h-display text-3xl">Routing what-if</h2><Assumption>ASSUMPTION: prices are editable</Assumption></div>
        <p className="mt-1 max-w-2xl text-mute">Change a price per call and see what the same measured traffic would have cost. The call counts are real; the prices are yours to set.</p>
        {tools.length ? (
          <div className="overflow-x-auto"><table className="mt-4 w-full"><thead><tr><th className="th">Tool</th><th className="th text-right">Calls (measured)</th><th className="th text-right">Cost (measured)</th><th className="th">Price per call <Assumption /></th><th className="th text-right">What-if cost</th></tr></thead>
            <tbody>{tools.map((k) => (
              <tr key={k}><td className="td font-mono text-sm">{k}</td><td className="td text-right tabular-nums">{t.callsTool[k] ?? 0}</td><td className="td text-right tabular-nums">{usd(t.costTool[k] ?? 0, 3)}</td>
                <td className="td"><label>$<span className="sr-only"> price per call for {k}</span><input className="field ml-1 w-28" inputMode="decimal" value={edits[k] ?? ''} placeholder={isNum(defaults[k]) ? String(defaults[k]) : 'enter'} onChange={(e) => setEdits({ ...edits, [k]: e.target.value.replace(/[^0-9.]/g, '') })} /></label></td>
                <td className="td text-right tabular-nums">{isNum(price(k)) ? usd((t.callsTool[k] ?? 0) * price(k), 3) : <span className="text-mute">no price</span>}</td></tr>))}</tbody></table></div>
        ) : <p className="mt-4"><NotMeasured cmd="make stack" /></p>}
        <p className="mt-4 flex flex-wrap items-center gap-4 text-lg">What-if total <strong>{usd(whatIf, 3)}</strong> vs measured <strong>{usd(total, 3)}</strong> ({whatIf - total >= 0 ? '+' : '−'}{usd(Math.abs(whatIf - total), 3)})
          <button className="btn" onClick={() => setEdits({})}>Reset prices</button>
          <VerifyButton spec={{ title: 'Routing what-if', what: 'Measured call counts multiplied by the prices in the table. Counts are measured; the prices are assumptions you can edit.', field: 'assumptions.pricesUsdPerCall (defaults); edits stay in this browser', shown: usd(whatIf, 3), kind: 'ASSUMPTION', command: 'make drill' }} /></p>
      </section>
    </div>
  );
}
