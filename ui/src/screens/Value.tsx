import { useStore } from '../store';
import { Assumption, Measured, VerifyButton, isNum, useLocal, usd } from '../ui';

export function Value() {
  const t = useStore((s) => s.totals);
  const agents = useStore((s) => s.agents);
  const impact = useStore((s) => s.impact);
  const dflt = impact?.assumptions ?? {};
  const [hours, setHours] = useLocal<Record<string, string>>('hoursPerTask', {});
  const [rate, setRate] = useLocal<string>('hourlyRate', '');
  const rateN = rate !== '' ? Number(rate) : isNum(dflt.loadedHourlyRateUsd) ? dflt.loadedHourlyRateUsd : undefined;
  const hrs = (id: string): number | undefined => (hours[id] != null && hours[id] !== '' ? Number(hours[id]) : isNum(dflt.hoursSavedPerTask) ? dflt.hoursSavedPerTask : isNum(dflt.hoursSavedPerTask?.[id]) ? dflt.hoursSavedPerTask[id] : undefined);
  const rows = agents.map((a) => {
    const tasks = t.tasks[a.id] ?? 0, h = hrs(a.id), cost = t.cost[a.id] ?? 0;
    const value = h != null && rateN != null ? tasks * h * rateN : undefined;
    return { a, tasks, h, cost, value, net: value != null ? value - cost : undefined };
  });
  const sum = (f: (r: (typeof rows)[number]) => number | undefined) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  const complete = rows.length > 0 && rows.every((r) => r.value != null);
  return (
    <div className="space-y-8">
      <div><h1 className="h-display text-5xl">Value ledger</h1>
        <p className="mt-2 max-w-2xl text-lg text-mute">Is each agent worth what it costs? Tasks and cost are measured from the stream. Hours saved and the hourly rate are assumptions you type in.</p></div>
      <div className="panel flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-3">Loaded hourly rate $<input className="field w-28" inputMode="decimal" value={rate} placeholder={isNum(dflt.loadedHourlyRateUsd) ? String(dflt.loadedHourlyRateUsd) : 'enter'} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} /></label><Assumption />
        <p className="text-mute">A task is one allowed gateway call to a tool (not model or agent-to-agent calls). Window: this session only.</p>
      </div>
      <section className="panel overflow-x-auto" aria-label="Value by agent">
        <table className="w-full"><thead><tr><th className="th">Agent</th><th className="th text-right">Tasks done <Measured /></th><th className="th">Hours saved per task <Assumption /></th><th className="th text-right">Value</th><th className="th text-right">Cost <Measured /></th><th className="th text-right">Net</th></tr></thead>
          <tbody>{rows.map(({ a, tasks, h, cost, value, net }) => (
            <tr key={a.id}><td className="td"><a href={`#/agent/${a.id}`}>{a.name}</a></td><td className="td text-right tabular-nums">{tasks}</td>
              <td className="td"><input aria-label={`Hours saved per task for ${a.name}`} className="field w-24" inputMode="decimal" value={hours[a.id] ?? ''} placeholder={h != null ? String(h) : 'enter'} onChange={(e) => setHours({ ...hours, [a.id]: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
              <td className="td text-right tabular-nums">{value != null ? usd(value) : <span className="text-mute">needs inputs</span>}</td><td className="td text-right tabular-nums">{usd(cost, 3)}</td>
              <td className="td text-right tabular-nums font-semibold">{net != null ? `${net < 0 ? '−' : ''}${usd(Math.abs(net))}` : '—'}</td></tr>))}</tbody>
          <tfoot><tr><td className="pt-4 font-semibold">Fleet total</td><td className="pt-4 text-right tabular-nums">{sum((r) => r.tasks)}</td><td /><td className="pt-4 text-right tabular-nums">{complete ? usd(sum((r) => r.value)) : '—'}</td><td className="pt-4 text-right tabular-nums">{usd(sum((r) => r.cost), 3)}</td><td className="pt-4 text-right text-xl font-semibold tabular-nums">{complete ? usd(sum((r) => r.net)) : '—'}</td></tr></tfoot></table>
        {!agents.length && <p className="mt-4 text-mute">No agents loaded.</p>}
        <p className="mt-4"><VerifyButton spec={{ title: 'Net value', what: 'Tasks done × hours saved per task × hourly rate, minus measured spend. Tasks and spend are measured; hours and rate are typed-in assumptions.', field: 'assumptions.hoursSavedPerTask, assumptions.loadedHourlyRateUsd (defaults); stream action events for tasks and cost', shown: complete ? usd(sum((r) => r.net)) : 'needs inputs', kind: 'ASSUMPTION', command: 'make drill' }} /></p>
      </section>
    </div>
  );
}
