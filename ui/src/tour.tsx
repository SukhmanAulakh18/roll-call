import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, X } from 'lucide-react';
import { getState, resetDrills, runDrill, useStore } from './store';
import { setUi, useUi } from './ui-state';

interface Step { id: string; route: string; title: string; text: string; target?: string; secs: number; enter?: () => void; ready?: () => boolean }
const hasProof = () => getState().incidents.some((e) => e.stage === 'proof' && getState().drillRun && e.ts >= (getState().drillRun!.starts.governed ?? Infinity) - 1000);
const STEPS: Step[] = [
  { id: 'q', route: '#/', target: 'tiles', secs: 7, title: 'Four questions', text: 'What agents exist? What does it cost? Can I stop one, fast? Can I prove it? The control room answers each one with a number you can check.' },
  { id: 'n', route: '#/', target: 'map', secs: 7, title: 'Every number has a source', text: 'Press Verify on any number to see its field, its last run and the command that reproduces it. The map shows what each agent can touch, live.' },
  { id: 'd', route: '#/drill', target: 'race', secs: 12, title: 'Run the runaway drill', text: 'The same fault, with and without controls. Watch the ungoverned spend climb, then the governed run slow, page and stop.', enter: () => { void resetDrills().then(() => runDrill('runaway-loop', true)); }, ready: () => getState().drillRun?.phase === 'governed' || getState().drillRun?.phase === 'done' },
  { id: 'p', route: '#/drill', target: 'proof', secs: 7, title: 'Proof it is stopped', text: 'An independent probe replays a call as the stopped agent. A denial with a receipt id is the proof, not our word for it.', ready: hasProof },
  { id: 'a', route: '#/admission', target: 'try-deploy', secs: 7, title: 'Nothing unregistered runs', text: 'A workload with no registered agent label is refused at the gate, in plain English.', enter: () => setTimeout(() => dispatchEvent(new CustomEvent('rc:try-deploy')), 900) },
];

export function Tour() {
  const step = useUi((u) => u.tour);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const entered = useRef(-1);
  const drillRun = useStore((s) => s.drillRun);
  const incidents = useStore((s) => s.incidents);
  void drillRun; void incidents;
  const total = STEPS.reduce((a, s) => a + s.secs, 0);

  useEffect(() => {
    if (step == null) { document.querySelectorAll('.tour-hl').forEach((e) => e.classList.remove('tour-hl')); entered.current = -1; return; }
    if (entered.current === step) return;
    entered.current = step; setT(0);
    const s = STEPS[step];
    if (location.hash !== s.route && !(s.route === '#/' && location.hash === '')) location.hash = s.route;
    const h = setTimeout(() => s.enter?.(), 200);
    return () => clearTimeout(h);
  }, [step]);

  useEffect(() => {
    document.querySelectorAll('.tour-hl').forEach((e) => e.classList.remove('tour-hl'));
    if (step == null) return;
    const h = setTimeout(() => document.querySelector(`[data-tour="${STEPS[step].target}"]`)?.classList.add('tour-hl'), 350);
    return () => clearTimeout(h);
  }, [step]);

  useEffect(() => {
    if (step == null || paused) return;
    const s = STEPS[step];
    const h = setInterval(() => {
      if (s.ready && !s.ready()) return;
      setT((x) => x + 0.1);
    }, 100);
    return () => clearInterval(h);
  }, [step, paused]);

  const go = (n: number) => { if (n < 0) return; if (n >= STEPS.length) { setUi({ tour: null }); return; } setT(0); setUi({ tour: n }); };
  useEffect(() => { if (step != null && t >= STEPS[step].secs) go(step + 1); });  
  useEffect(() => {
    if (step == null) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[cmdk-root]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(step + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(step - 1); }
      else if (e.key === 'Escape') setUi({ tour: null });
      else if (e.key === 'p') setPaused((x) => !x);
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });  

  if (step == null) return null;
  const s = STEPS[step];
  const done = STEPS.slice(0, step).reduce((a, x) => a + x.secs, 0) + Math.min(t, s.secs);
  const waiting = s.ready && !s.ready();
  return (
    <aside className="tour" role="dialog" aria-label="Presenter tour" aria-live="polite">
      <div className="tour-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((done / total) * 100)} aria-label="Tour progress"><span style={{ transform: `scaleX(${done / total})` }} /></div>
      <div className="tour-b">
        <h2>{s.title}</h2>
        <p>{s.text}</p>
        <p className="tour-k measured">Step {step + 1} of {STEPS.length}{waiting ? ', waiting for the drill' : ''}</p>
        <div className="tour-a">
          <button className="btn btn--sm" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous step"><ArrowLeft size={14} aria-hidden />Back</button>
          <button className="btn btn--sm btn--primary" onClick={() => go(step + 1)} aria-label="Next step">{step === STEPS.length - 1 ? 'Finish' : 'Next'}<ArrowRight size={14} aria-hidden /></button>
          <button className="btn btn--sm btn--icon" onClick={() => setPaused(!paused)} aria-label={paused ? 'Resume auto advance' : 'Pause auto advance'}>{paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}</button>
          <button className="btn btn--sm btn--icon" onClick={() => setUi({ tour: null })} aria-label="End the tour"><X size={14} aria-hidden /></button>
          <span className="muted tour-keys">Left and right arrow keys move, Esc ends</span>
        </div>
      </div>
    </aside>
  );
}
