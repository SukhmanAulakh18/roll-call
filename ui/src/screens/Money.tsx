import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Slider from '@radix-ui/react-slider';
import { getState, useStore } from '../store';
import { Assumption, CountUp, FixtureChip, Measured, NotMeasured, VerifyButton, clock, isNum, useLocal, usd } from '../ui';
import { Panel } from '../components';
import { EChart, baseOption, usePalette } from '../charts';

type By = 'agent' | 'team' | 'tool';

function SpendTab() {
  const t = useStore((s) => s.totals);
  const agents = useStore((s) => s.agents);
  const hist = useStore((s) => s.fleetHist);
  const p = usePalette();
  const [by, setBy] = useLocal<By>('spendBy', 'agent');
  const rows = useMemo(() => {
    const m: Record<string, number> = {};
    if (by === 'agent') for (const [id, c] of Object.entries(t.cost)) m[agents.find((a) => a.id === id)?.name ?? id] = c;
    else if (by === 'team') for (const [id, c] of Object.entries(t.cost)) { const k = agents.find((a) => a.id === id)?.owner.team ?? 'unknown'; m[k] = (m[k] ?? 0) + c; }
    else Object.assign(m, t.costTool);
    return Object.entries(m).sort((a, b) => a[1] - b[1]);
  }, [t, agents, by]);
  const total = Object.values(t.cost).reduce((a, b) => a + b, 0);
  const bar = useMemo(() => ({
    ...baseOption(p),
    xAxis: { type: 'value', axisLabel: { color: p.muted, formatter: (v: number) => usd(v) }, splitLine: { lineStyle: { color: p.rule } } },
    yAxis: { type: 'category', data: rows.map((r) => r[0]), axisLine: { lineStyle: { color: p.rule2 } }, axisLabel: { color: p.ink2, width: 160, overflow: 'truncate' }, axisTick: { show: false } },
    series: [{ type: 'bar', data: rows.map((r) => r[1]), itemStyle: { color: p.cool, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18, label: { show: true, position: 'right', color: p.ink, fontFamily: p.mono, formatter: (x: { value: number }) => usd(x.value, 3) } }],
    tooltip: { ...(baseOption(p).tooltip as object), valueFormatter: (v: number) => usd(v, 4) },
  }), [rows, p]);
  const line = useMemo(() => ({
    ...baseOption(p),
    xAxis: { type: 'category', data: hist.map((h) => clock(h.t)), axisLabel: { color: p.muted, interval: Math.max(0, Math.floor(hist.length / 6) - 1) }, axisLine: { lineStyle: { color: p.rule2 } }, boundaryGap: false },
    yAxis: { type: 'value', axisLabel: { color: p.muted, formatter: (v: number) => usd(v, 3) }, splitLine: { lineStyle: { color: p.rule } } },
    series: [{ type: 'line', data: hist.map((h) => h.total), showSymbol: false, smooth: 0.2, lineStyle: { color: p.cool, width: 2 }, areaStyle: { color: p.cool, opacity: 0.12 } }],
    tooltip: { ...(baseOption(p).tooltip as object), trigger: 'axis', axisPointer: { type: 'line' }, valueFormatter: (v: number) => `${usd(v, 4)} per min` },
  }), [hist, p]);
  return (
    <div className="stack">
      <p className="lead">{t.first ? <>Measured spend so far: <strong className="measured"><CountUp value={total} format={(n) => usd(n, 3)} /></strong> from {clock(t.first)} to {clock(t.last!)}.</> : 'Waiting for the stream.'} <Measured /> <VerifyButton spec={{ title: 'Spend by agent, team and tool', what: 'Sum of costUsd on every governed action the stream delivered since this page connected.', field: 'Live stream: action.costUsd (not stored in impact.json)', shown: usd(total), kind: 'measured', command: 'make stack' }} /></p>
      <div className="grid-2">
        <Panel title="Who spent it" id="by-h" aside={<div className="seg" role="group" aria-label="Group spend by">{(['agent', 'team', 'tool'] as const).map((k) => <button key={k} aria-pressed={by === k} onClick={() => setBy(k)}>{k === 'agent' ? 'Agent' : k === 'team' ? 'Team' : 'Tool'}</button>)}</div>}>
          {rows.length ? <EChart option={bar} height={Math.max(220, rows.length * 30 + 40)} label={`Spend by ${by}, highest first`} /> : <p className="empty">Waiting for the stream.</p>}
        </Panel>
        <Panel title="Fleet spend per minute" id="ln-h" aside={<Measured />}>
          {hist.length > 2 ? <EChart option={line} height={280} label="Fleet spend per minute over time" /> : <p className="empty">The trend fills in as fleet updates arrive.</p>}
          <p className="muted">By model: <NotMeasured cmd="make stack" /> Action events carry no model id, so spend is shown per tool.</p>
        </Panel>
      </div>
    </div>
  );
}

function WhatIf() {
  const t = useStore((s) => s.totals);
  const impact = useStore((s) => s.impact);
  const p = usePalette();
  const [edits, setEdits] = useLocal<Record<string, string>>('prices', {});
  const defaults: Record<string, number> = impact?.assumptions?.pricesUsdPerCall ?? {};
  const tools = [...new Set([...Object.keys(defaults), ...Object.keys(t.callsTool)])].sort();
  const price = (k: string) => (edits[k] != null && edits[k] !== '' ? Number(edits[k]) : defaults[k]);
  const whatIf = tools.reduce((s, k) => s + (isNum(price(k)) ? (t.callsTool[k] ?? 0) * price(k) : t.costTool[k] ?? 0), 0);
  const total = Object.values(t.cost).reduce((a, b) => a + b, 0);
  const opt = useMemo(() => {
    const shown = tools.filter((k) => (t.callsTool[k] ?? 0) > 0);
    return {
      ...baseOption(p),
      legend: { top: 0, right: 0, textStyle: { color: p.ink2 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: shown, axisLabel: { color: p.ink2, rotate: 30, fontFamily: p.mono, fontSize: 11 }, axisLine: { lineStyle: { color: p.rule2 } } },
      yAxis: { type: 'value', axisLabel: { color: p.muted, formatter: (v: number) => usd(v) }, splitLine: { lineStyle: { color: p.rule } } },
      series: [
        { name: 'Measured', type: 'bar', data: shown.map((k) => t.costTool[k] ?? 0), itemStyle: { color: p.cool, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20 },
        { name: 'What-if (ASSUMPTION prices)', type: 'bar', data: shown.map((k) => (isNum(price(k)) ? (t.callsTool[k] ?? 0) * price(k) : 0)), itemStyle: { color: p.accent, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20 },
      ],
      tooltip: { ...(baseOption(p).tooltip as object), valueFormatter: (v: number) => usd(v, 4) },
    };
  }, [t, edits, p, tools]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <p className="lead">Change a price per call and see what the same measured traffic would have cost. The call counts are real; the prices are yours to set.</p>
      <div className="grid-2 grid-2--wide">
        <Panel title="Price table" id="pt-h" aside={<Assumption>ASSUMPTION: prices are editable</Assumption>}>
          {tools.length ? (
            <div className="tablewrap"><table><thead><tr><th>Tool</th><th className="num">Calls <Measured /></th><th className="num">Cost <Measured /></th><th>Price per call <Assumption /></th><th className="num">What-if</th></tr></thead>
              <tbody>{tools.map((k) => (
                <tr key={k}><td className="measured">{k}</td><td className="num measured">{t.callsTool[k] ?? 0}</td><td className="num measured">{usd(t.costTool[k] ?? 0, 3)}</td>
                  <td><label>$<span className="visually-hidden"> price per call for {k}</span><input className="field field--s measured" inputMode="decimal" value={edits[k] ?? ''} placeholder={isNum(defaults[k]) ? String(defaults[k]) : 'enter'} onChange={(e) => setEdits({ ...edits, [k]: e.target.value.replace(/[^0-9.]/g, '') })} /></label></td>
                  <td className="num measured">{isNum(price(k)) ? usd((t.callsTool[k] ?? 0) * price(k), 3) : <span className="muted">no price</span>}</td></tr>))}</tbody></table></div>
          ) : <p><NotMeasured cmd="make stack" /></p>}
          <div className="row-actions"><button className="btn" onClick={() => setEdits({})}>Reset prices</button><VerifyButton spec={{ title: 'Routing what-if', what: 'Measured call counts multiplied by the prices in the table. Counts are measured; the prices are assumptions you can edit.', field: 'assumptions.pricesUsdPerCall (defaults); edits stay in this browser', shown: usd(whatIf, 3), kind: 'ASSUMPTION', command: 'make drill' }} /></div>
        </Panel>
        <Panel title="Measured against what-if" id="wi-h">
          <p className="reading reading--m"><CountUp value={whatIf} format={(n) => usd(n, 3)} /> <span className="reading-unit">what-if vs <span className="measured">{usd(total, 3)}</span> measured</span></p>
          <p className="muted">{whatIf - total >= 0 ? 'More' : 'Less'} by <span className="measured">{usd(Math.abs(whatIf - total), 3)}</span> <Assumption /></p>
          {tools.some((k) => (t.callsTool[k] ?? 0) > 0) ? <EChart option={opt} height={300} label="Measured cost per tool against the what-if cost" /> : <p className="empty">No calls yet.</p>}
        </Panel>
      </div>
    </div>
  );
}

function ValueLedger() {
  const t = useStore((s) => s.totals);
  const agents = useStore((s) => s.agents);
  const impact = useStore((s) => s.impact);
  const p = usePalette();
  const dflt = impact?.assumptions ?? {};
  const [hours, setHours] = useLocal<Record<string, number>>('hoursSaved', {});
  const [rateV, setRate] = useLocal<number | null>('hourlyRate2', null);
  const rate = rateV ?? (isNum(dflt.loadedHourlyRateUsd) ? dflt.loadedHourlyRateUsd : undefined);
  const hrs = (id: string): number | undefined => hours[id] ?? (isNum(dflt.hoursSavedPerTask) ? dflt.hoursSavedPerTask : isNum(dflt.hoursSavedPerTask?.[id]) ? dflt.hoursSavedPerTask[id] : undefined);
  const rows = agents.map((a) => {
    const tasks = t.tasks[a.id] ?? 0, h = hrs(a.id), cost = t.cost[a.id] ?? 0;
    const value = h != null && rate != null ? tasks * h * rate : undefined;
    return { a, tasks, h, cost, value, net: value != null ? value - cost : undefined };
  });
  const sum = (f: (r: (typeof rows)[number]) => number | undefined) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  const complete = rows.length > 0 && rows.every((r) => r.value != null);
  const net = sum((r) => r.net);
  const chart = useMemo(() => {
    const r = rows.filter((x) => x.net != null).sort((a, b) => a.net! - b.net!);
    return { ...baseOption(p),
      xAxis: { type: 'value', axisLabel: { color: p.muted, formatter: (v: number) => usd(v) }, splitLine: { lineStyle: { color: p.rule } } },
      yAxis: { type: 'category', data: r.map((x) => x.a.name), axisLabel: { color: p.ink2, width: 150, overflow: 'truncate' }, axisLine: { lineStyle: { color: p.rule2 } }, axisTick: { show: false } },
      series: [{ type: 'bar', data: r.map((x) => ({ value: x.net, itemStyle: { color: x.net! >= 0 ? p.cool : p.bad } })), barMaxWidth: 16 }],
      tooltip: { ...(baseOption(p).tooltip as object), valueFormatter: (v: number) => usd(v, 3) } };
  }, [rows, p]);
  return (
    <div className="stack">
      <p className="lead">Is each agent worth what it costs? Tasks and cost are measured from the stream. Hours saved and the hourly rate are assumptions you set with the sliders.</p>
      <div className="grid-2 grid-2--wide">
        <Panel title="Value ledger" id="vl-h" aside={<span className="muted">A task is one allowed gateway call to a tool, not a model or agent call. This session only.</span>}>
          <div className="ratebox"><label htmlFor="rate">Loaded hourly rate</label><Assumption />
            <Slider.Root className="slider" id="rate" min={0} max={250} step={5} value={[rate ?? 0]} onValueChange={([v]) => setRate(v)}><Slider.Track className="slider-track"><Slider.Range className="slider-range" /></Slider.Track><Slider.Thumb className="slider-thumb" aria-label="Loaded hourly rate in dollars" /></Slider.Root>
            <span className="measured slider-v">{rate != null ? `$${rate}/h` : 'not set'}</span></div>
          <div className="tablewrap"><table><thead><tr><th>Agent</th><th className="num">Tasks <Measured /></th><th>Hours saved per task <Assumption /></th><th className="num">Value</th><th className="num">Cost <Measured /></th><th className="num">Net</th></tr></thead>
            <tbody>{rows.map(({ a, tasks, h, cost, value, net }) => (
              <tr key={a.id}><td><a href={`#/agent/${a.id}`}>{a.name}</a></td><td className="num measured">{tasks}</td>
                <td><div className="slider-cell"><Slider.Root className="slider slider--s" min={0} max={1} step={0.01} value={[h ?? 0]} onValueChange={([v]) => setHours({ ...hours, [a.id]: v })}><Slider.Track className="slider-track"><Slider.Range className="slider-range" /></Slider.Track><Slider.Thumb className="slider-thumb" aria-label={`Hours saved per task for ${a.name}`} /></Slider.Root><span className="measured slider-v">{h != null ? `${h.toFixed(2)} h` : 'not set'}</span></div></td>
                <td className="num measured">{value != null ? usd(value) : <span className="muted">needs inputs</span>}</td><td className="num measured">{usd(cost, 3)}</td>
                <td className="num measured strong">{net != null ? `${net < 0 ? '−' : ''}${usd(Math.abs(net))}` : '—'}</td></tr>))}</tbody>
            <tfoot><tr><td>Fleet total</td><td className="num measured">{sum((r) => r.tasks)}</td><td /><td className="num measured">{complete ? usd(sum((r) => r.value)) : '—'}</td><td className="num measured">{usd(sum((r) => r.cost), 3)}</td><td className="num measured strong">{complete ? usd(net) : '—'}</td></tr></tfoot></table></div>
          {!agents.length && <p className="empty">No agents loaded.</p>}
        </Panel>
        <Panel title="Net value" id="nv-h" aside={<VerifyButton spec={{ title: 'Net value', what: 'Tasks done × hours saved per task × hourly rate, minus measured spend. Tasks and spend are measured; hours and rate are assumptions.', field: 'assumptions.hoursSavedPerTask, assumptions.loadedHourlyRateUsd (defaults); stream action events for tasks and cost', shown: complete ? usd(net) : 'needs inputs', kind: 'ASSUMPTION', command: 'make drill' }} />}>
          <p className="reading reading--m">{complete ? <CountUp value={net} format={(n) => `${n < 0 ? '−' : ''}${usd(Math.abs(n))}`} /> : <span className="reading-na">needs inputs</span>}</p>
          <p className="muted">{complete ? <>Moves as you drag. Built from an <Assumption /> for hours and rate.</> : 'Set the rate and hours saved to see it. Nothing is assumed for you.'}</p>
          {rows.some((r) => r.net != null) ? <EChart option={chart} height={Math.max(240, rows.length * 28 + 30)} label="Net value per agent" /> : null}
        </Panel>
      </div>
    </div>
  );
}

export function Money({ tab }: { tab: string }) {
  const [v, setV] = useState(tab || 'spend');
  const source = useStore((s) => s.source);
  void getState;
  return (
    <div className="money">
      <header className="page-h"><div><h1>Spend and value</h1><p className="lead">What each agent costs, what a different price list would cost, and what the work is worth.</p></div>{source === 'fixture' && <FixtureChip />}</header>
      <Tabs.Root value={v} onValueChange={(x) => { setV(x); history.replaceState(null, '', `#/money/${x}`); }} className="tabs tabs--page">
        <Tabs.List className="tabs-l" aria-label="Spend and value"><Tabs.Trigger value="spend">Spend</Tabs.Trigger><Tabs.Trigger value="whatif">Routing what-if</Tabs.Trigger><Tabs.Trigger value="value">Value ledger</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="spend" className="tabs-c"><SpendTab /></Tabs.Content>
        <Tabs.Content value="whatif" className="tabs-c"><WhatIf /></Tabs.Content>
        <Tabs.Content value="value" className="tabs-c"><ValueLedger /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
export default Money;
