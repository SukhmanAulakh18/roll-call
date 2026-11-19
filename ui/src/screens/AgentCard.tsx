import { useState } from 'react';
import type { ActionEvent, IncidentEvent } from '../../../contracts/types';
import { killAgent, useStore } from '../store';
import { Assumption, Measured, NotMeasured, StateIcon, StateMark, VerifyButton, clock, isNum, useLocal, usd, type AgentState } from '../ui';

export const VerdictMark = ({ v }: { v: ActionEvent['verdict'] }) => (
  <span className="inline-flex items-center gap-1.5"><StateIcon state={v === 'allow' ? 'healthy' : v === 'deny' ? 'killed' : 'throttled'} size={18} />{v === 'allow' ? 'Allowed' : v === 'deny' ? 'Denied' : 'Slowed'}</span>
);

export function AgentCard({ id }: { id: string }) {
  const a = useStore((s) => s.agents.find((x) => x.id === id));
  const fleet = useStore((s) => s.fleet);
  const actions = useStore((s) => s.actions);
  const impact = useStore((s) => s.impact);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<IncidentEvent | null>(null);
  const [err, setErr] = useState('');
  const [valueDay, setValueDay] = useLocal<string>(`valueDay.${id}`, '');
  if (!a) return <p className="panel">No agent called <code className="font-mono">{id}</code> is loaded. <a href="#/registry">Back to the registry</a></p>;

  const state = (fleet?.states?.[id] ?? 'unknown') as AgentState;
  const rate = fleet?.spendPerMinUsd?.[id];
  const costDay = isNum(rate) ? rate * 1440 : undefined;
  const assumed = impact?.assumptions?.valuePerDayUsd?.[id];
  const vd = valueDay !== '' ? Number(valueDay) : isNum(assumed) ? assumed : undefined;
  const recent = actions.filter((x) => x.agentId === id).slice(-12).reverse();
  const kill = async () => {
    setBusy(true); setErr('');
    try { setProof(await killAgent(id)); } catch (e) { setErr((e as Error).message); }
    setBusy(false); setArmed(false);
  };
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="grid grid-cols-[10rem_1fr] gap-4 border-b border-line py-3"><dt className="text-mute">{k}</dt><dd>{children}</dd></div>;

  return (
    <div className="space-y-8">
      <p><a href="#/">← Fleet</a></p>
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="max-w-2xl">
          <h1 className="h-display text-6xl">{a.name}</h1>
          <p className="mt-2 text-xl">{a.purpose}</p>
          <p className="mt-3 text-lg"><StateMark state={state} /> <span className="ml-3 font-mono text-sm text-mute">{a.id}</span></p>
        </div>
        <div className="w-full max-w-sm" aria-live="polite">
          {!armed ? (
            <button className="btn btn-accent w-full justify-center !py-5 !text-2xl" disabled={state === 'killed' || busy} onClick={() => setArmed(true)}>{state === 'killed' ? 'Already stopped' : 'Kill this agent'}</button>
          ) : (
            <div className="space-y-3 rounded-lg border-2 border-accent p-4">
              <p className="font-semibold">Stop {a.name} now? Its identity is revoked and a probe checks it can no longer act.</p>
              <div className="flex gap-3"><button className="btn btn-accent !text-lg" disabled={busy} onClick={kill} autoFocus>{busy ? 'Stopping…' : 'Yes, stop it'}</button><button className="btn" onClick={() => setArmed(false)}>Cancel</button></div>
            </div>
          )}
          {err && <p className="mt-3 rounded-md border border-accent p-3 text-accent">Could not stop the agent: {err}</p>}
          {proof?.proof && (
            <p className="mt-3 rounded-md border border-ink p-4" role="status"><StateIcon state="killed" size={20} /> <strong>Stopped and proven.</strong> Probe tried <code className="font-mono">{proof.proof.attemptedTool}</code> as <code className="font-mono">{a.id}</code> → {proof.proof.verdict === 'deny' ? 'denied' : proof.proof.verdict} ({proof.proof.code}), receipt <code className="font-mono">{proof.proof.receiptId}</code>
            </p>
          )}
          {proof && !proof.proof && <p className="mt-3 rounded-md border border-line p-3">Kill sent. The server returned no proof yet: {proof.message}</p>}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="panel" aria-labelledby="who">
          <h2 id="who" className="h-display text-3xl">Who and what</h2>
          <dl className="mt-3">
            <Row k="Owner">{a.owner?.name} · {a.owner?.team}<br /><span className="text-mute">Paged at {a.owner?.escalation}</span></Row>
            <Row k="Risk tier">{a.riskRating}</Row>
            <Row k="Lifecycle">{a.lifecycleState}</Row>
            <Row k="Can touch">{a.scopes?.tools?.length ? a.scopes.tools.map((t) => <span key={t} className="chip mr-1.5 mb-1.5 font-mono">{t}</span>) : 'nothing'}<br />{a.scopes?.data?.map((t) => <span key={t} className="chip mr-1.5 border-dashed font-mono">data {t}</span>)}</Row>
            <Row k="Models">{a.models?.join(', ') || 'none'}</Row>
            <Row k="Data residency">{a.residency}</Row>
            <Row k="Evaluation">{a.evaluation ? <>{a.evaluation.passed ? 'Passed' : 'Failed'} on {a.evaluation.date} · <span className="font-mono text-sm">{a.evaluation.evidenceUrl}</span></> : <span className="text-accent font-semibold">No evaluation on file</span>}</Row>
          </dl>
          <details className="mt-4"><summary className="cursor-pointer text-mute">Technical detail</summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-xs">{JSON.stringify(a, null, 2)}</pre></details>
        </section>

        <section className="panel" aria-labelledby="money">
          <h2 id="money" className="h-display text-3xl">Cost and value</h2>
          <dl className="mt-3">
            <Row k="Cost per day"><span className="text-3xl h-display">{costDay != null ? usd(costDay) : '—'}</span> <Measured />
              <p className="mt-1 text-mute">{costDay != null ? <>Current spend rate {usd(rate!, 3)} per minute × 1,440 minutes. A rate, not a bill.</> : <NotMeasured cmd="make stack" />}</p>
              <VerifyButton spec={{ title: 'Cost per day', what: 'The latest measured spend rate for this agent, scaled to a full day.', field: 'Live stream: fleet.spendPerMinUsd[agentId] × 1440 (not stored in impact.json)', shown: costDay != null ? usd(costDay) : 'not measured yet', kind: 'measured', command: 'make stack', extra: 'Simulated fleet, real gateway measurements.' }} /></Row>
            <Row k="Value per day"><label className="flex items-center gap-2"><span className="sr-only">Value per day in US dollars</span>$<input className="field w-36" inputMode="decimal" value={valueDay} placeholder={isNum(assumed) ? String(assumed) : 'enter'} onChange={(e) => setValueDay(e.target.value.replace(/[^0-9.]/g, ''))} /></label> <Assumption />
              <p className="mt-1 text-mute">{vd != null && costDay != null ? <>Net per day: <strong className="text-ink">{usd(vd - costDay)}</strong></> : 'Type what this agent is worth per day to see net.'}</p>
              <VerifyButton spec={{ title: 'Value per day', what: 'What a person says this agent is worth per day. We have no way to measure it, so it is typed in and stays in this browser.', field: 'assumptions.valuePerDayUsd[agentId] (default, if any); your edit is stored locally', shown: vd != null ? usd(vd) : 'not set', kind: 'ASSUMPTION', command: 'make drill' }} /></Row>
            <Row k="Budgets">{usd(a.budgets.perHourUsd)}/hour · {usd(a.budgets.perDayUsd)}/day · {usd(a.budgets.perTaskUsd)}/task</Row>
          </dl>
        </section>
      </div>

      <section className="panel" aria-labelledby="recent">
        <h2 id="recent" className="h-display text-3xl">Recent actions</h2>
        {recent.length ? (
          <table className="mt-3 w-full"><thead><tr><th className="th">Time</th><th className="th">Tool</th><th className="th">Decision</th><th className="th">Code</th><th className="th">Receipt</th></tr></thead>
            <tbody>{recent.map((r) => <tr key={r.receiptId}><td className="td">{clock(r.ts)}</td><td className="td font-mono text-sm">{r.tool}</td><td className="td"><VerdictMark v={r.verdict} /></td><td className="td font-mono text-sm">{r.code}</td><td className="td font-mono text-sm">{r.receiptId}</td></tr>)}</tbody></table>
        ) : <p className="mt-3 text-mute">No actions from this agent since the stream connected.</p>}
      </section>
    </div>
  );
}
