import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowRight, BadgeCheck, Fingerprint, OctagonX, Play, ScanLine, Video } from 'lucide-react';
import { REPLAY_ONLY, useStore } from '../store';
import { setUi } from '../ui-state';
import { Assumption, FixtureChip, NotMeasured, VerifyButton, isNum, secs, usd, type VerifySpec } from '../ui';

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

const QUESTIONS = ['What agents exist?', 'What can they touch?', 'What do they cost?', 'Can we stop one, and prove it?'];
const STEPS = [
  { icon: Fingerprint, h: 'Register', p: 'Every agent gets an owner, a purpose and a record before it runs.', to: ['#/registry', 'See the registry'] },
  { icon: ScanLine, h: 'Guard', p: 'Every call passes a gateway: identity, scope, budget and policy.', to: ['#/control', 'Watch calls live'] },
  { icon: OctagonX, h: 'Stop with proof', p: 'A runaway is caught and stopped. A probe call proves it is really refused.', to: ['#/drill', 'Run the drill'] },
] as const;

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
          <p className="eyebrow">Roll Call in 30 seconds {source === 'fixture' && <FixtureChip />}</p>
          <h1 id="story-h">Your company will soon run thousands of AI agents. Roll Call keeps every one of them on a leash.</h1>
          <div className="story-cta">
            <a className="btn btn--primary btn--lg" href="#/control"><Play size={18} aria-hidden />See it live</a>
            {recorded && <a className="btn btn--lg" href="video.html"><Video size={18} aria-hidden />Watch the 66 s video</a>}
          </div>
          <p className="story-sub">Scroll for the 30 second version.</p>
        </div>
        <Scene />
      </section>

      <Reveal id="problem"><p className="eyebrow">1 · The problem</p><h2>Four questions nobody can answer today.</h2>
        <ol className="qgrid">{QUESTIONS.map((q, i) => <li key={q}><span className="qn measured">{i + 1}</span>{q}</li>)}</ol></Reveal>

      <Reveal id="how"><div data-tour="story-how"><p className="eyebrow">2 · How it works</p><h2>Three steps, no exceptions.</h2></div>
        <ol className="steps3">{STEPS.map((s, i) => (
          <li key={s.h} className="step3"><s.icon size={26} aria-hidden /><span className="measured step3-n">Step {i + 1}</span><h3>{s.h}</h3><p>{s.p}</p><a className="textlink" href={s.to[0]}>{s.to[1]}<ArrowRight size={14} aria-hidden /></a></li>))}</ol></Reveal>

      <Reveal id="results"><p className="eyebrow">3 · The results</p><h2>Measured in the last run, not promised.</h2>
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

      <Reveal id="why"><p className="eyebrow">4 · Why now</p><h2>Regulators want a live inventory of AI.</h2>
        <p className="story-p">Example: OSFI guideline E-23 (Canadian financial institutions) applies from May 1, 2027. <span className="chip">Engineering interpretation, not compliance advice</span></p></Reveal>

      <Reveal id="who"><p className="eyebrow">5 · Who it is for</p><h2>Three people lose sleep over this.</h2>
        <ul className="who">
          <li><h3>Risk and compliance</h3><p>A live inventory with owners, and proof when something stops.</p><a className="textlink" href="#/registry">Open the registry<ArrowRight size={14} aria-hidden /></a></li>
          <li><h3>Platform and SRE</h3><p>Guardrails and a kill switch that work in seconds, not meetings.</p><a className="textlink" href="#/drill">Run the drill<ArrowRight size={14} aria-hidden /></a></li>
          <li><h3>Finance</h3><p>Cost per agent, with the value assumed by its owner.</p><a className="textlink" href="#/money">See spend<ArrowRight size={14} aria-hidden /></a></li>
        </ul></Reveal>

      <Reveal id="cta" className="story-band"><h2>See it for yourself.</h2>
        <div className="story-cta">
          <a className="btn btn--primary btn--lg" href="#/drill"><Play size={18} aria-hidden />Run a drill yourself</a>
          <a className="btn btn--lg" href="#/control">Open the control room<ArrowRight size={18} aria-hidden /></a>
          <button type="button" className="btn btn--lg" onClick={() => setUi({ tour: 0 })}>Take the guided tour</button>
        </div></Reveal>
    </div>
  );
}
