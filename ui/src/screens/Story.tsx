import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowRight, BadgeCheck, Briefcase, Fingerprint, OctagonX, ScanLine, Video } from 'lucide-react';
import { REPLAY_ONLY, useStore } from '../store';
import { setUi } from '../ui-state';
import { ModeChip, SimChip, KindChip, useIncident, pickNum } from '../modes';
import { Assumption, NotMeasured, VerifyButton, isNum, secs, usd, type VerifySpec } from '../ui';

const LOOP = 6; // seconds
/** Seconds into the 6 s loop, 30 fps. Frozen on the final frame for reduced motion. */
function useLoop(reduce: boolean) {
  const [t, setT] = useState(reduce ? 5 : 0);
  useEffect(() => {
    if (reduce) { setT(5); return; }
    let raf = 0, last = 0; const t0 = performance.now();
    const f = (n: number) => { if (n - last > 33) { last = n; setT(((n - t0) / 1000) % LOOP); } raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf);
  }, [reduce]);
  return t;
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** The 6 s scene. Agents, spend and stage timings come from the recorded run (agents.json, impact.json); the 12 s measured drill window is replayed in 6 s. */
function Scene() {
  const reduce = !!useReducedMotion();
  const t = useLoop(reduce);
  const agents = useStore((s) => s.agents);
  const d = useStore((s) => s.impact?.drill);
  const ids = agents.map((a) => a.id);
  const bad = d?.agentId as string | undefined;
  const st = (d?.stagesP95Ms ?? {}) as Record<string, number>;
  const end = isNum(st.proof) ? st.proof : 0;
  const at = (k: string, dflt: number) => 1.4 + (isNum(st[k]) && end ? (st[k] / end) * 2.6 : dflt);
  const tDet = at('detected', 2.2), tKill = at('killed', 3.9), tProof = at('proof', 4.1) + 0.15, tLoop = 1.4;
  const gov = d?.spendProtectedUsd?.governedMean, ungov = d?.spendProtectedUsd?.ungovernedMean;
  const have = isNum(gov) && isNum(ungov);
  const run = clamp((t - tLoop) / (tKill - tLoop));       // 0..1 while the loop runs unchecked
  const stopped = t >= tKill, slowed = t >= tDet && !stopped, caught = t >= tDet, proof = t >= tProof;
  const spend = !have ? 0 : stopped ? gov : gov * Math.pow(run, 1.6);
  const ghost = !have ? 0 : ungov * clamp((t - tLoop) / (LOOP - tLoop - 0.2));
  const phase = t < tLoop ? 'Every agent answers the roll' : !caught ? 'One agent starts looping. Spend climbs' : slowed ? 'Roll Call catches it and slows it' : !proof ? 'Stopped' : 'Stopped, and proven';
  const cells = (ids.length ? ids : Array.from({ length: 12 }, (_, i) => `a${i}`)).slice(0, 12);
  const badIdx = Math.max(0, cells.indexOf(bad ?? ''));
  return (
    <figure className="scene" aria-label="Animated scene, six seconds, looping: agents run calmly, one starts looping, Roll Call catches, slows and stops it, then proof lands.">
      <div className="scene-grid" aria-hidden="true">
        {cells.map((id, i) => {
          const isBad = i === badIdx;
          const cls = !isBad ? '' : stopped ? 'is-stop' : caught ? 'is-slow' : t >= tLoop ? 'is-loop' : '';
          return <span key={id} className={`dot ${cls}`} style={{ animationDelay: `${(i % 6) * 0.23}s` }}><i /></span>;
        })}
      </div>
      <div className="scene-meter" aria-hidden="true">
        <div className="meter-row"><span>With Roll Call</span><span className="measured">{have ? usd(spend, 2) : 'not measured yet'}</span></div>
        <div className="meter"><span className={`meter-fill ${stopped ? 'is-stop' : ''}`} style={{ width: have ? `${(spend / ungov) * 100}%` : '0%' }} /><span className="meter-ghost" style={{ width: have ? `${(ghost / ungov) * 100}%` : '0%' }} /></div>
        <div className="meter-row meter-row--g"><span>Without it, same fault</span><span className="measured">{have ? usd(ghost, 2) : 'not measured yet'}</span></div>
      </div>
      <ol className="scene-steps" aria-hidden="true">
        {([['Detected', caught], ['Slowed', caught], ['Stopped', stopped], ['Proof', proof]] as const).map(([l, on]) => <li key={l} className={on ? 'on' : ''}>{l}</li>)}
      </ol>
      <span className={`stamp ${proof ? 'on' : ''}`} aria-hidden="true"><BadgeCheck size={18} />Proof</span>
      <figcaption><span className="scene-phase" role="status">{phase}</span><span className="muted"> From the recorded drill{isNum(d?.runs) ? ` (${d.runs} runs)` : ''}; its {isNum(d?.windowMs) ? `${d.windowMs / 1000} s` : 'window'} is played in 6 s.</span></figcaption>
    </figure>
  );
}

/** Fade-and-rise when scrolled into view. Without IntersectionObserver or with reduced motion it is simply visible. */
function Reveal({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current; if (!el || on) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(el); return () => io.disconnect();
  }, [on]);
  return <section ref={ref} id={id} className={`story-sec reveal ${on ? 'in' : ''} ${className}`}>{children}</section>;
}

const STEPS = [
  { icon: Fingerprint, h: 'Register', p: 'Every AI agent is listed with a named owner and a purpose before it runs.', to: ['#/registry', 'See the list of agents'] },
  { icon: ScanLine, h: 'Check', p: 'Every action an agent takes goes through a checkpoint first. It checks what the agent may touch and how much it may spend.', to: ['#/control', 'See the control room'] },
  { icon: OctagonX, h: 'Stop, then prove it', p: 'If an agent misbehaves, Roll Call stops it. Then it tests that the agent really cannot act again.', to: ['#/drill', 'Run a drill yourself'] },
] as const;


/** The one incident, readable in five seconds. External Refund Processing Agent run if measured, else the runaway-loop drill, labelled as that. */
function IncidentCard({ loading }: { loading: boolean }) {
  const inc = useIncident();
  const x = useStore((s) => s.impact?.external), st = (useStore((s) => s.impact?.drill?.stagesP95Ms) ?? {}) as Record<string, number>;
  const ext = inc?.kind === 'external';
  const detMs = ext ? pickNum(x?.timeline, ['faultStartToDetectedMs']) ?? pickNum(x, ['detectedMs', 'timeToDetectMs']) : st.detected;
  const label = ext ? inc.label : 'Runaway-loop drill';
  const steps: { h: string; big: ReactNode; sub: string }[] = [
    { h: ext ? 'Repeated refund requests detected' : 'Runaway loop detected', big: isNum(detMs) ? `after ${secs(detMs)}` : isNum(inc?.flagged) ? `${inc?.flagged} requests` : 'time not recorded', sub: ext ? 'the same refund asked for again and again' : 'one agent started repeating the same call' },
    { h: 'Agent stopped', big: isNum(inc?.stopMs) ? `in ${secs(inc!.stopMs!)}` : 'time not recorded', sub: isNum(inc?.allowedBeforeStop) ? `${Math.round(inc!.allowedBeforeStop!)} requests went through first` : 'from the start of the fault' },
    { h: 'Further requests denied', big: isNum(inc?.deniedAfter) ? `${Math.round(inc!.deniedAfter!)} blocked` : 'count not recorded', sub: 'a test request after the stop was refused, with a signed receipt' },
  ];
  return (
    <section className="incident" aria-labelledby="inc-h" data-tour="incident">
      <div className="incident-top"><h2 id="inc-h"><span className="incident-agent">{label}</span></h2><span className="incident-chips"><KindChip kind="measured" /></span></div>
      {inc ? <ol className="incident-steps">{steps.map((t, i) => <li key={t.h}><span className="incident-n" aria-hidden="true">{i + 1}</span><span className="incident-h">{t.h}</span><span className="incident-big measured">{t.big}</span><span className="incident-sub">{t.sub}</span></li>)}</ol>
        : <p className="incident-empty">{loading ? 'Loading the test run' : <>Not measured yet. Run <code className="measured">make external-demo</code>.</>}</p>}
      {inc && !ext && <p className="incident-note">This is the runaway-loop drill{inc.agent ? ` on ${inc.agent}` : ''}, not the Refund Processing Agent demo. That one is not measured yet: run <code className="measured">make external-demo</code>.</p>}
    </section>
  );
}

export function Story() {
  const impact = useStore((s) => s.impact);
  const impactErr = useStore((s) => s.impactErr);
  const fleet = useStore((s) => s.fleet);
  const source = useStore((s) => s.source);
  const recorded = REPLAY_ONLY || source === 'recorded';
  const d = impact?.drill, rel = impact?.release;
  const kept = d?.spendProtectedUsd?.protectedTotal, p95 = d?.timeToContainMs?.p95;
  const unreg = fleet?.unregisteredRunning ?? impact?.fleet?.unregisteredRunning;
  const loading = !impact && !impactErr;
  const NM = <NotMeasured cmd="make drill" />;
  const spec = (title: string, what: string, field: string, shown: string, command: string, extra?: string): VerifySpec => ({ title, what, field, shown, kind: 'measured', command, extra });
  const Result = ({ n, l, v, note }: { n: ReactNode; l: string; v: VerifySpec; note?: ReactNode }) => (
    <li className="result"><span className="result-n measured">{loading ? <span className="skeleton" aria-label="Loading">&nbsp;</span> : n}</span><span className="result-l">{l}</span>{note && <span className="result-note">{note}</span>}<VerifyButton spec={v} /></li>
  );
  return (
    <div className="story">
      <section className="story-hero" data-tour="story-hero" aria-labelledby="story-h">
        <div className="story-hero-t">
          <p className="mode-row"><ModeChip /><SimChip /></p>
          <h1 id="story-h">AI agents can act on their own. Your business should stay in control.</h1>
          <p className="story-lede">Roll Call detects unsafe behaviour, enforces limits, and stops a misbehaving AI agent, then proves it can't act again.</p>
          <div className="story-cta">
            <a className="btn btn--primary btn--lg" href={recorded ? 'video.html' : 'media/roll-call-demo.mp4'}><Video size={18} aria-hidden />Watch the 60-second demo</a>
            <a className="btn btn--lg" href="#/control">Explore the technical proof<ArrowRight size={18} aria-hidden /></a>
          </div>
        </div>
        <IncidentCard loading={loading} />
      </section>

      <Reveal id="how" className="story-first"><div data-tour="story-how"><h2>What happens when an AI agent starts doing something it shouldn\u2019t?</h2><p className="story-p">Three steps, with no exceptions.</p></div>
        <ol className="steps3">{STEPS.map((s, i) => (
          <li key={s.h} className="step3"><s.icon size={26} aria-hidden /><span className="measured step3-n">Step {i + 1}</span><h3>{s.h}</h3><p>{s.p}</p><a className="textlink" href={s.to[0]}>{s.to[1]}<ArrowRight size={14} aria-hidden /></a></li>))}</ol></Reveal>

      <Reveal id="results"><p className="eyebrow">Evidence <KindChip kind="measured" /></p><h2>Measured in a test run, not promised.</h2>
        <ul className="results">
          <Result l={`spend protected${isNum(d?.runs) ? ` across ${d.runs} runaway drills` : ''}`} n={isNum(kept) ? usd(kept) : NM}
            v={spec('Spend protected', 'Sum over drill runs of ungoverned minus governed spend in the same fault window.', 'drill.spendProtectedUsd.protectedTotal', isNum(kept) ? usd(kept) : 'not measured yet', 'node scripts/drill.ts --runs 20')} />
          <Result l="time to contain a runaway, p95" n={isNum(p95) ? secs(p95) : NM} note={isNum(d?.simulatedOwnerAckMs) ? <>includes a simulated owner acknowledgement of {secs(d.simulatedOwnerAckMs)} <Assumption /></> : undefined}
            v={spec('Time to contain, p95', 'From the fault starting to the independent probe being refused. The pager and the owner acknowledgement are simulated.', 'drill.timeToContainMs.p95', isNum(p95) ? secs(p95) : 'not measured yet', 'node scripts/drill.ts --runs 20', 'The owner acknowledgement time is typed in, not measured.')} />
          <Result l="agents running without a record" n={isNum(unreg) ? String(unreg) : NM}
            v={spec('Unregistered agents', 'Agents seen running that have no registry record. Must be zero.', 'fleet.unregisteredRunning', isNum(unreg) ? String(unreg) : 'not measured yet', 'make stack')} />
          <Result l={isNum(rel?.badRuns) ? `bad releases rolled back automatically, of ${rel.badRuns}` : 'bad releases rolled back automatically'} n={isNum(rel?.autoRollbacks) ? String(rel.autoRollbacks) : NM}
            v={spec('Automatic rollbacks', 'Bad canary releases that were rolled back without a person, in the release drill.', 'release.autoRollbacks', isNum(rel?.autoRollbacks) ? String(rel.autoRollbacks) : 'not measured yet', 'node scripts/drill.ts --only release --release-runs 8')} />
        </ul>
        {impactErr && <p className="muted">The last run could not be loaded, so nothing is shown as measured.</p>}
      </Reveal>

      <Reveal id="scene"><p className="eyebrow">One incident, replayed</p><h2>Watch it happen in six seconds.</h2><Scene /></Reveal>

      <Reveal id="biz" className="story-band"><p className="eyebrow"><Briefcase size={14} aria-hidden /> For the people who pay for it</p><h2>What would this save your company?</h2>
        <p className="story-p">Who buys it, who uses it, and a calculator you can change. The measured test results stay separate from the projection.</p>
        <div className="story-cta"><a className="btn btn--primary btn--lg" href="#/business">See the business case<ArrowRight size={18} aria-hidden /></a></div></Reveal>

      <Reveal id="cta" className="story-band"><h2>See it for yourself.</h2><p className="story-p">Regulators are asking companies for a live inventory of their AI. Example: OSFI guideline E-23 applies from May 1, 2027 <span className="chip">Engineering interpretation, not compliance advice</span></p>
        <div className="story-cta">
          <a className="btn btn--primary btn--lg" href="#/drill">Run a drill yourself</a>
          <a className="btn btn--lg" href="#/control">Open the control room<ArrowRight size={18} aria-hidden /></a>
          <button type="button" className="btn btn--lg" onClick={() => setUi({ tour: 0 })}>Take the guided tour</button>
        </div></Reveal>
    </div>
  );
}
