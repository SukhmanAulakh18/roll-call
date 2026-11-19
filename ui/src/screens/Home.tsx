import { useStore } from '../store';
import { NotMeasured, VerifyButton, groupIncidents, isNum, secs, useLiveIncident, usd, type VerifySpec } from '../ui';
import { FleetMap } from './FleetMap';
import type { Lens } from '../App';

function Hero({ label, big, sub, spec }: { label: string; big: React.ReactNode; sub: React.ReactNode; spec: VerifySpec }) {
  return (
    <section aria-label={label} className="flex flex-1 flex-col gap-2 px-8 py-6 first:pl-0 last:pr-0 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-line">
      <h2 className="text-lg text-mute">{label}</h2>
      <p className="h-display text-[5.5rem] leading-none">{big}</p>
      <p className="min-h-[3rem] text-mute">{sub}</p>
      <div><VerifyButton spec={spec} /></div>
    </section>
  );
}

export function Heroes() {
  const impact = useStore((s) => s.impact);
  const f = impact?.fleet, d = impact?.drill;
  const prot = d?.spendProtectedUsd, p95 = d?.timeToContainMs?.p95;
  const fleetOk = f && isNum(f.registered) && isNum(f.running);
  return (
    <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface px-8 md:flex-row md:divide-x md:divide-y-0 md:[&>section]:border-l-0">
      <Hero label="Agents under control"
        big={fleetOk ? <>{f.running} / {f.registered}</> : <span className="text-3xl">—</span>}
        sub={fleetOk ? <>running · {f.unregisteredRunning} unregistered</> : <NotMeasured cmd="make drill" />}
        spec={{ title: 'Agents under control', what: 'How many registered agents are running right now, and how many agents are running that nobody registered. The second number should always be zero.', field: 'fleet.running / fleet.registered, fleet.unregisteredRunning', shown: fleetOk ? `${f.running} / ${f.registered} running · ${f.unregisteredRunning} unregistered` : 'not measured yet', kind: 'measured', command: 'make drill' }} />
      <Hero label="Spend protected"
        big={isNum(prot?.protectedTotal) ? usd(prot.protectedTotal) : <span className="text-3xl">—</span>}
        sub={isNum(prot?.protectedTotal) ? <>across {d.runs} runaway drills{isNum(prot.protectedMean) && <> · about {usd(prot.protectedMean)} saved each</>}</> : <NotMeasured cmd="make drill" />}
        spec={{ title: 'Spend protected', what: 'Money an agent would have burned in a runaway loop with no controls, minus what it actually burned with Roll Call watching. Same fault, run both ways.', field: 'drill.spendProtectedUsd.protectedTotal (also .ungovernedMean, .governedMean, .protectedMean)', shown: isNum(prot?.protectedTotal) ? usd(prot.protectedTotal) : 'not measured yet', kind: 'measured', command: d?.command ?? 'make drill' }} />
      <Hero label="Time to contain (p95)"
        big={isNum(p95) ? secs(p95) : <span className="text-3xl">—</span>}
        sub={isNum(p95) ? <>from the fault starting to proof the agent can no longer act · 19 in 20 runs were this quick or quicker</> : <NotMeasured cmd="make drill" />}
        spec={{ title: 'Time to contain (p95)', what: 'Seconds from a fault starting to an independent probe proving the agent is blocked. p95 means 19 of 20 drills were at least this fast.', field: 'drill.timeToContainMs.p95 (÷1000)', shown: isNum(p95) ? secs(p95) : 'not measured yet', kind: 'measured', command: d?.command ?? 'make drill' }} />
    </div>
  );
}

export function IncidentBanner() {
  const g = useLiveIncident();
  const name = useStore((s) => s.agents.find((a) => a.id === g?.agentId)?.name);
  if (!g) return null;
  const done = g.last.stage === 'proof' || g.last.stage === 'killed';
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border-2 border-accent bg-surface px-6 py-4">
      <p className="flex items-center gap-3 text-lg">
        <span className="text-accent"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.4v.1" /></svg></span>
        <span><strong>{done ? 'Incident contained' : 'Incident live'}: {name ?? g.agentId}.</strong> {g.last.message}</span>
      </p>
      <a className="btn btn-accent no-underline" href="#/drill">See the timeline</a>
    </div>
  );
}

function OpsBlock() {
  const agents = useStore((s) => s.agents);
  const incidents = useStore((s) => s.incidents);
  const admissions = useStore((s) => s.admissions);
  const groups = groupIncidents(incidents).slice(0, 5);
  const review = agents.filter((a) => !a.evaluation?.passed || a.lifecycleState === 'shadow' || a.lifecycleState === 'draft' || (a.nextMonitoringDate && Date.parse(a.nextMonitoringDate) < Date.now()));
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="panel" aria-labelledby="o1"><h2 id="o1" className="h-display text-2xl">Recent incidents</h2>
        {groups.length ? <ul className="mt-3 space-y-3">{groups.map((g) => <li key={g.id}><a href={`#/agent/${g.agentId}`}>{g.agentId}</a> · {g.last.stage.replace('_', ' ')}<br /><span className="text-mute text-[0.9rem]">{g.last.message}</span></li>)}</ul> : <p className="mt-3 text-mute">No incidents in this session.</p>}
      </section>
      <section className="panel" aria-labelledby="o2"><h2 id="o2" className="h-display text-2xl">Waiting on a person</h2>
        {review.length ? <ul className="mt-3 space-y-3">{review.map((a) => <li key={a.id}><a href={`#/agent/${a.id}`}>{a.name}</a><br /><span className="text-mute text-[0.9rem]">Owner {a.owner?.name} · {a.lifecycleState}{!a.evaluation?.passed && ' · no passing evaluation'}</span></li>)}</ul> : <p className="mt-3 text-mute">Every agent is approved and evaluated.</p>}
      </section>
      <section className="panel" aria-labelledby="o3"><h2 id="o3" className="h-display text-2xl">Admission decisions</h2>
        {admissions.length ? <ul className="mt-3 space-y-3">{admissions.slice(0, 5).map((a, i) => <li key={i}>{a.allowed ? 'Allowed' : 'Refused'}: <span className="font-mono text-sm">{a.workload}</span><br /><span className="text-mute text-[0.9rem]">{a.reason}</span></li>)}</ul> : <p className="mt-3 text-mute">None yet. Try one in <a href="#/registry">Registry</a>.</p>}
      </section>
    </div>
  );
}

function EngBlock() {
  const impact = useStore((s) => s.impact);
  const b = impact?.bench, det = impact?.detector;
  const g = b?.governed;
  return (
    <section className="panel" aria-labelledby="e1"><h2 id="e1" className="h-display text-2xl">Service levels</h2>
      <dl className="mt-4 grid gap-6 md:grid-cols-4">
        <div><dt className="text-mute">Gateway latency p99</dt><dd className="text-2xl">{isNum(g?.p99) ? `${g.p99} ms` : <NotMeasured cmd="make bench" />}</dd></div>
        <div><dt className="text-mute">Overhead vs ungoverned p99</dt><dd className="text-2xl">{isNum(b?.overheadP99Ms) ? `${b.overheadP99Ms} ms` : <NotMeasured cmd="make bench" />}</dd></div>
        <div><dt className="text-mute">Detector precision / recall</dt><dd className="text-2xl">{isNum(det?.precision) ? `${det.precision} / ${det.recall}` : <NotMeasured cmd="make drill" />}</dd></div>
        <div><dt className="text-mute">Detail</dt><dd><a href="#/engineering">Engineering view</a></dd></div>
      </dl>
    </section>
  );
}

function ExecBlock() {
  const t = useStore((s) => s.totals);
  const total = Object.values(t.cost).reduce((a, b) => a + b, 0);
  return (
    <section className="panel flex flex-wrap items-center justify-between gap-6" aria-labelledby="x1">
      <div><h2 id="x1" className="h-display text-2xl">Spend this session</h2><p className="mt-1 text-mute">{t.first ? <>Measured from the live stream: <strong className="text-ink">{usd(total)}</strong> across the fleet.</> : 'Waiting for the stream.'}</p></div>
      <div className="flex gap-3"><a className="btn no-underline" href="#/spend">Where it went</a><a className="btn no-underline" href="#/value">What it earned</a></div>
    </section>
  );
}

export function Home({ lens }: { lens: Lens }) {
  const fleet = useStore((s) => s.fleet);
  return (
    <div className="space-y-8">
      <IncidentBanner />
      <Heroes />
      {lens === 'ops' && <OpsBlock />}
      {lens === 'eng' && <EngBlock />}
      <section aria-labelledby="map"><h2 id="map" className="h-display mb-4 text-3xl">The fleet</h2><FleetMap /></section>
      {lens === 'exec' && <ExecBlock />}
      {lens !== 'ops' && fleet && <p className="sr-only">Fleet states: {Object.entries(fleet.states).map(([k, v]) => `${k} ${v}`).join(', ')}</p>}
    </div>
  );
}
