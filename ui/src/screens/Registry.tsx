import { Fragment, useState } from 'react';
import type { AdmissionResult } from '../../../contracts/types';
import { reviewAdmission, useStore } from '../store';
import { StateIcon } from '../ui';

function Admission() {
  const agents = useStore((s) => s.agents);
  const [name, setName] = useState('mystery-worker');
  const [ns, setNs] = useState('fleet');
  const [label, setLabel] = useState('');
  const [res, setRes] = useState<AdmissionResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setRes(null);
    try { setRes(await reviewAdmission({ name, namespace: ns, labels: label ? { 'rollcall.dev/agent-id': label } : {} })); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const first = agents[0]?.id;
  return (
    <section className="panel" aria-labelledby="adm">
      <h2 id="adm" className="h-display text-3xl">Try to run a workload</h2>
      <p className="mt-1 max-w-xl text-mute">Roll Call refuses to start anything that is not registered, owned and approved. Ask it to review a workload and read the reason.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="grid gap-1">Workload name<input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="grid gap-1">Namespace<input className="field" value={ns} onChange={(e) => setNs(e.target.value)} required /></label>
        <label className="grid gap-1">Agent id label <span className="text-[0.8rem] text-mute">rollcall.dev/agent-id</span><input className="field font-mono" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="leave empty to test a missing label" /></label>
        <div className="flex flex-wrap gap-3 md:col-span-3">
          <button className="btn btn-accent" disabled={busy}>{busy ? 'Reviewing…' : 'Review this workload'}</button>
          {first && <button type="button" className="btn" onClick={() => { setName(first); setLabel(first); }}>Fill in a registered agent</button>}
          <button type="button" className="btn" onClick={() => { setName('shadow-bot'); setLabel('shadow-bot'); }}>Fill in an unregistered agent</button>
        </div>
      </form>
      <div aria-live="polite" className="mt-5">
        {res && <p className={`rounded-md border-2 p-4 text-lg ${res.allowed ? 'border-ink' : 'border-accent'}`}><span className={`inline-flex items-center gap-2 font-semibold ${res.allowed ? '' : 'text-accent'}`}><StateIcon state={res.allowed ? 'healthy' : 'killed'} />{res.allowed ? 'Allowed to run' : 'Refused'}</span><br />{res.reason}<br /><span className="font-mono text-sm text-mute">{res.code}</span></p>}
        {err && <p className="rounded-md border border-accent p-4 text-accent">Could not reach the admission check: {err}</p>}
      </div>
    </section>
  );
}

export function Registry() {
  const agents = useStore((s) => s.agents);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-8">
      <h1 className="h-display text-5xl">Registry and admission</h1>
      <section className="panel overflow-x-auto" aria-label="Registered agents">
        {agents.length ? (
          <table className="w-full"><thead><tr><th className="th">Agent</th><th className="th">Owner</th><th className="th">Risk</th><th className="th">Lifecycle</th><th className="th">Evaluation</th><th className="th">Region</th><th className="th"><span className="sr-only">Details</span></th></tr></thead>
            <tbody>{agents.map((a) => (
              <Fragment key={a.id}>
                <tr><td className="td"><a href={`#/agent/${a.id}`} className="font-semibold">{a.name}</a><br /><span className="font-mono text-sm text-mute">{a.id}</span></td><td className="td">{a.owner?.name}<br /><span className="text-mute text-[0.9rem]">{a.owner?.team}</span></td><td className="td">{a.riskRating}</td><td className="td">{a.lifecycleState}</td>
                  <td className="td">{a.evaluation ? <span className="inline-flex items-center gap-1.5"><StateIcon state={a.evaluation.passed ? 'healthy' : 'alert'} size={18} />{a.evaluation.passed ? 'Passed' : 'Failed'}</span> : <span className="inline-flex items-center gap-1.5 text-accent font-semibold"><StateIcon state="alert" size={18} />None</span>}</td>
                  <td className="td">{a.residency}</td>
                  <td className="td"><button className="btn !min-h-[36px] !py-1" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Details'}<span className="sr-only"> for {a.name}</span></button></td></tr>
                {open === a.id && <tr><td colSpan={7} className="border-b border-line bg-bg p-4"><dl className="grid gap-x-8 gap-y-2 text-[0.92rem] md:grid-cols-2">
                  <div><dt className="text-mute">Approved uses</dt><dd>{a.approvedUses?.join('; ')}</dd></div><div><dt className="text-mute">Limitations</dt><dd>{a.limitations?.join('; ')}</dd></div>
                  <div><dt className="text-mute">Reviewer / approver</dt><dd>{a.reviewer} / {a.approver}</dd></div><div><dt className="text-mute">Next monitoring</dt><dd>{a.nextMonitoringDate}</dd></div>
                  <div className="md:col-span-2"><dt className="text-mute">Runtime</dt><dd className="font-mono text-sm">{a.runtimeRef?.kind} {a.runtimeRef?.namespace}/{a.runtimeRef?.name} · v{a.version}</dd></div></dl></td></tr>}
              </Fragment>))}</tbody></table>
        ) : <p className="text-mute">No records loaded. Start the stack with <code className="font-mono text-ink">make stack</code>.</p>}
      </section>
      <Admission />
    </div>
  );
}
