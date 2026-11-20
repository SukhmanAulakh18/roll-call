import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useStore } from '../store';
import { KindChip, SimChip } from '../modes';
import { Assumption, NotMeasured, VerifyButton, isNum, usd, type VerifySpec } from '../ui';

const PROFILE: [string, string][] = [
  ['Buyer', 'Head of AI Platform Engineering'],
  ['Users', 'AI operations and security teams'],
  ['Problem', 'AI agents can call tools, run up costs and take actions nobody approved.'],
  ['Solution', 'One set of limits that every agent action must pass, plus an emergency stop.'],
  ['Value', 'Fewer unauthorized actions, faster response, stronger audit evidence.'],
];
const WHY: [string, string][] = [
  ['It acts before the damage, not after.', 'Rules and alerts tell you something went wrong. Roll Call sits in the path of every agent action, so a request that breaks a limit is refused as it happens.'],
  ['Independent proof that it stopped.', 'After a stop, a separate test request is sent. We show it was refused. A silent dashboard is not proof.'],
  ['Audit evidence you can check.', 'Every decision is written to a signed receipt, chained to the one before it. Anyone can re-check the chain, and a deleted receipt shows.'],
  ['One list of agents, each with an owner.', 'Home-made rules end up scattered across teams. Here every agent has a record, a named owner and a risk rating in one place.'],
];
const num = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const spec = (title: string, what: string, field: string, shown: string): VerifySpec => ({ title, what, field, shown, kind: 'measured', command: 'node scripts/drill.ts --runs 20' });

function Field({ id, label, value, set, hint, step }: { id: string; label: string; value: string; set: (v: string) => void; hint: string; step?: string }) {
  return (
    <div className="bz-f"><label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="decimal" min="0" step={step ?? 'any'} value={value} onChange={(e) => set(e.target.value)} aria-describedby={`${id}-h`} />
      <p id={`${id}-h`} className="bz-hint">{hint}</p></div>
  );
}

export default function Business() {
  const d = useStore((s) => s.impact?.drill);
  const u = d?.callsMean?.ungoverned, g = d?.callsMean?.governed, uc = d?.spendProtectedUsd?.ungovernedMean;
  const cost = isNum(u) && isNum(uc) && u > 0 ? uc / u : undefined;
  const share = isNum(u) && isNum(g) && u > 0 ? Math.round((1 - g / u) * 100) : undefined;
  const [req, setReq] = useState('100000'), [inc, setInc] = useState('2'), [exc, setExc] = useState('50000');
  const [costIn, setCostIn] = useState<string | null>(null), [shareIn, setShareIn] = useState<string | null>(null);
  const c = costIn !== null ? num(costIn, 0) : cost ?? 0, sh = (shareIn !== null ? num(shareIn, 0) : share ?? 90) / 100;
  const spend = num(req, 0) * 30 * c, prevented = num(inc, 0) * num(exc, 0) * Math.min(sh, 1) * c;
  return (
    <div className="biz-page">
      <header className="page-h"><div><p className="eyebrow">Business case</p><h1>What would Roll Call be worth to a company like yours?</h1>
        <p className="lead">Who it is for, a calculator you can change, and why a few home-made rules are not enough.</p></div><div className="lens-chips"><SimChip /></div></header>

      <section className="panel bz-sec" aria-labelledby="bz-p"><h2 id="bz-p">Initial customer profile</h2>
        <div className="tablewrap"><table className="bz-t"><caption className="visually-hidden">Initial customer profile</caption><tbody>{PROFILE.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody></table></div></section>

      <section className="panel bz-sec" aria-labelledby="bz-m"><div className="bz-hd"><h2 id="bz-m">What we measured</h2><KindChip kind="measured" /></div>
        <p className="muted">From the recorded test run of a simulated fleet. Not a customer result.</p>
        <ul className="bz-meas">
          <li><span className="bz-k">Cost of one agent request</span><span className="bz-v measured">{cost !== undefined ? usd(cost, 5) : <NotMeasured cmd="make drill" />}</span><VerifyButton spec={spec('Mean cost per request', 'Ungoverned drill spend divided by ungoverned calls, averaged over the drill runs. Prices are illustrative.', 'drill.spendProtectedUsd.ungovernedMean / drill.callsMean.ungoverned', cost !== undefined ? usd(cost, 5) : 'not measured yet')} /></li>
          <li><span className="bz-k">Faulty requests blocked</span><span className="bz-v measured">{share !== undefined ? `${share}%` : <NotMeasured cmd="make drill" />}</span><VerifyButton spec={spec('Share of faulty requests blocked', 'One minus governed calls over ungoverned calls in the same 12 second fault window.', 'drill.callsMean.governed / drill.callsMean.ungoverned', share !== undefined ? `${share}%` : 'not measured yet')} /></li>
        </ul></section>

      <section className="panel bz-sec" aria-labelledby="bz-c"><div className="bz-hd"><h2 id="bz-c">Savings calculator</h2><KindChip kind="modeled" /></div>
        <p className="muted">An illustrative company. Change any number. Typed-in numbers are <Assumption>ASSUMPTION</Assumption>s, not measurements.</p>
        <div className="bz-grid">
          <Field id="bz-req" label="Agent tool requests per day" value={req} set={setReq} step="1000" hint="Default 100,000." />
          <Field id="bz-cost" label="Cost per request, USD" value={costIn ?? (cost !== undefined ? String(Number(cost.toFixed(5))) : '')} set={setCostIn} hint={cost !== undefined && costIn === null ? 'Starts at the measured mean.' : 'Typed in by you.'} />
          <Field id="bz-inc" label="Runaway incidents per month" value={inc} set={setInc} step="1" hint="How often an agent loops or misfires." />
          <Field id="bz-exc" label="Excess requests per incident" value={exc} set={setExc} step="1000" hint="Requests an unchecked agent makes before a person notices." />
          <Field id="bz-sh" label="Share of excess requests blocked, %" value={shareIn ?? (share !== undefined ? String(share) : '90')} set={setShareIn} hint={share !== undefined && shareIn === null ? 'Starts at the measured share.' : 'Typed in by you.'} />
        </div>
        <div className="bz-out" role="status" aria-live="polite"><div className="bz-hd"><h3>Projection</h3><KindChip kind="modeled" /></div>
          <dl className="bz-res">
            <div><dt>Monthly agent spend</dt><dd className="measured">{usd(spend)}</dd></div>
            <div><dt>Cost prevented per month</dt><dd className="measured bz-big">{usd(prevented)}</dd></div>
            <div><dt>Cost prevented per year</dt><dd className="measured">{usd(prevented * 12)}</dd></div>
          </dl>
          <p className="muted">Prevented cost = incidents per month × excess requests × share blocked × cost per request. Money is only part of the value: unauthorized actions that never happen are not priced here.</p></div>
      </section>

      <section className="panel bz-sec" aria-labelledby="bz-w"><h2 id="bz-w">Why not just write some rules and alerts ourselves?</h2>
        <ol className="bz-why">{WHY.map(([h, p]) => <li key={h}><h3>{h}</h3><p>{p}</p></li>)}</ol>
        <p><a className="textlink" href="#/control">Explore the technical proof<ArrowRight size={14} aria-hidden /></a></p></section>
    </div>
  );
}
