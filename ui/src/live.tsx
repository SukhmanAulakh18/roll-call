import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Bot, Check, Link2, PauseCircle, ShieldCheck, Siren, Wrench, X } from 'lucide-react';
import type { ActionEvent } from '../../contracts/types';
import { getState, useStore } from './store';
import { setUi } from './ui-state';
import { Tip, groupIncidents, secs, useNow } from './ui';

// Patterns adapted from Magic UI (MIT, github.com/magicuidesign/magicui): AnimatedBeam, BorderBeam, MagicCard spotlight, AnimatedList.
// Rewritten on `motion` and our CSS tokens (see live.css). Ambient motion is slow; only incidents move fast.

/** MagicCard-style spotlight: publishes the pointer position as CSS variables. */
export const spotlight = (e: React.PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`); e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

// ---------------- live pipeline ----------------
const CHECKS = [
  { k: 'Identity', tip: 'Is this really the registered agent, with an identity that is active and not revoked?', codes: ['UNAUTHENTICATED', 'REVOKED', 'IDENTITY_MISMATCH', 'UNREGISTERED', 'NOT_ACTIVE'] },
  { k: 'Scope', tip: 'Is the tool or model one this agent was approved to use?', codes: ['OUT_OF_SCOPE', 'MODEL_NOT_ALLOWED'] },
  { k: 'Budget', tip: 'Is the agent inside its spend limits, or is it looping and burning money?', codes: ['BUDGET_EXCEEDED', 'THROTTLED'] },
  { k: 'Policy', tip: 'Do the policy rules allow it, for example a high-risk tool needs a fresh policy bundle?', codes: ['STALE_POLICY_HIGH_RISK', 'SHADOW_HIGH_RISK'] },
] as const;
const failIndex = (a: ActionEvent) => a.verdict === 'allow' ? -1 : (() => { const i = CHECKS.findIndex((c) => (c.codes as readonly string[]).includes(a.code)); return i < 0 ? 3 : i; })();
const VERDICT = { allow: 'Allowed', deny: 'Denied', throttle: 'Slowed' } as const;

export function LivePipeline() {
  const reduce = useReducedMotion();
  const agents = useStore((s) => s.agents);
  const last = useStore((s) => s.actions[s.actions.length - 1]);
  const seen = useRef(last?.receiptId);
  const gate = useRef(0);
  const [call, setCall] = useState<(ActionEvent & { n: number }) | null>(null);
  const [stage, setStage] = useState(4);
  const n = useRef(0);
  useEffect(() => {
    if (!last || last.receiptId === seen.current) return;
    seen.current = last.receiptId;
    if (!last.governed || Date.now() - gate.current < 650) return; // show a readable sample of calls, never a blur
    gate.current = Date.now();
    setCall({ ...last, n: ++n.current });
  }, [last]);
  useEffect(() => {
    if (!call) return;
    if (reduce) { setStage(4); return; }
    setStage(0);
    const t = [1, 2, 3, 4].map((s) => window.setTimeout(() => setStage(s), 260 + s * 170));
    return () => t.forEach(clearTimeout);
  }, [call, reduce]);
  const bad = call ? failIndex(call) : -1;
  const who = call ? agents.find((a) => a.id === call.agentId)?.name ?? call.agentId : null;
  const done = stage >= 4;
  const tone = !call ? 'idle' : call.verdict;
  return (
    <section className="pipe" aria-labelledby="pipe-h" data-tour="pipe">
      <div className="pipe-head">
        <h2 id="pipe-h">How it works, live: every call passes the gateway</h2>
        <p className="pipe-sub">{call ? <>Latest call: <strong>{who}</strong> asked for <code className="measured">{call.tool}</code></> : 'Waiting for the first call. Run a drill to watch one.'}</p>
      </div>
      <div className="pipe-row">
        <div className="pnode"><span className="pnode-i" aria-hidden="true"><Bot size={22} /></span><span className="pnode-k">Agent</span><span className="pnode-s">{who ?? 'any agent'}</span></div>
        <Beam n={call?.n} reduce={!!reduce} tone={tone} />
        <div className={`gw gw--${tone} ${done ? 'is-done' : ''}`}>
          <p className="gw-k">Roll Call gateway</p>
          <ul className="gw-checks" aria-label="Four checks on every call">
            {CHECKS.map((c, i) => {
              const st = !call ? 'idle' : i < stage ? (i === bad ? 'fail' : bad >= 0 && i > bad ? 'idle' : call.verdict === 'throttle' && i === bad ? 'slow' : 'pass') : 'idle';
              const state = call && bad >= 0 && i === bad && i < stage ? (call.verdict === 'throttle' ? 'slow' : 'fail') : st;
              return (
                <li key={c.k}><Tip label={c.tip}><button type="button" className={`gchk gchk--${state}`} aria-label={`${c.k}. ${c.tip}`}>
                  <span className="gchk-i" aria-hidden="true">{state === 'pass' ? <Check size={14} strokeWidth={3} /> : state === 'fail' ? <X size={14} strokeWidth={3} /> : state === 'slow' ? <PauseCircle size={14} /> : null}</span>{c.k}</button></Tip></li>
              );
            })}
          </ul>
          <div className="gw-v" aria-live="polite">
            <AnimatePresence mode="wait">
              {call && done ? (
                <motion.span key={call.n} className={`vpill v-${call.verdict}`} initial={reduce ? false : { scale: 0.4 }} animate={{ scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }}>
                  {call.verdict === 'allow' ? <ShieldCheck size={16} aria-hidden /> : call.verdict === 'deny' ? <X size={16} aria-hidden /> : <PauseCircle size={16} aria-hidden />}{VERDICT[call.verdict]}{call.verdict !== 'allow' && <span className="measured">{call.code}</span>}
                </motion.span>
              ) : <span className="vpill vpill--idle">{call ? 'Checking' : 'No call yet'}</span>}
            </AnimatePresence>
          </div>
        </div>
        <Beam n={call && done && call.verdict !== 'deny' ? call.n : undefined} reduce={!!reduce} tone={call?.verdict === 'throttle' ? 'throttle' : 'allow'} blocked={!!call && done && call.verdict === 'deny'} />
        <div className={`pnode ${call && done && call.verdict === 'deny' ? 'is-shut' : ''}`}><span className="pnode-i" aria-hidden="true"><Wrench size={22} /></span><span className="pnode-k">Tool</span><span className="pnode-s measured">{call?.tool ?? 'any tool'}</span></div>
      </div>
      <ReceiptChain />
    </section>
  );
}

/** AnimatedBeam, reduced to a track with a travelling pulse. Re-keyed per call so each real call fires one pulse. */
function Beam({ n, reduce, tone, blocked }: { n?: number; reduce: boolean; tone: string; blocked?: boolean }) {
  return (
    <div className={`beam beam--${tone} ${blocked ? 'is-blocked' : ''}`} aria-hidden="true">
      {blocked && <X size={18} className="beam-x" />}
      {!reduce && n != null && <motion.span key={n} className="beam-p" initial={{ left: '0%', opacity: 0 }} animate={{ left: '100%', opacity: [0, 1, 1, 0] }} transition={{ duration: tone === 'throttle' ? 1.1 : 0.55, ease: 'easeInOut' }} />}
    </div>
  );
}

/** AnimatedList of the newest receipts: each carries the hash of the one before, so the links show the chain. */
export function ReceiptChain({ max = 4, mini = false }: { max?: number; mini?: boolean }) {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<ActionEvent[]>([]);
  useEffect(() => { // sampled slowly so the chain stays readable; every receipt is still in the table below
    const tick = () => { const all = getState().actions, out: ActionEvent[] = []; for (let i = all.length - 1; i >= 0 && out.length < max; i--) if (all[i].governed) out.push(all[i]); out.reverse(); setRows((p) => p[p.length - 1]?.receiptId === out[out.length - 1]?.receiptId ? p : out); };
    tick(); const id = window.setInterval(tick, 1400); return () => clearInterval(id);
  }, [max]);
  if (!rows.length) return mini ? null : <p className="chain-empty">Receipts appear here as calls are decided. Each one links to the hash of the one before it.</p>;
  return (
    <ol className={`chain ${mini ? 'chain--mini' : ''}`} aria-label="Newest receipts, linked by hash">
      <AnimatePresence initial={false}>
        {rows.map((a, i) => (
          <motion.li key={a.receiptId} className="chain-i" initial={reduce ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
            {i > 0 && <Link2 size={14} className="chain-link" aria-hidden="true" />}
            <button type="button" className={`chain-b v-${a.verdict}`} onClick={() => setUi({ receipt: a })}>
              <span className="measured">{a.receiptId}</span>{' '}{!mini && <span className="chain-v">{VERDICT[a.verdict]}</span>}
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

// ---------------- incident banner with live timeline ----------------
const STEPS = [['detected', 'Detect'], ['throttled', 'Throttle'], ['paged', 'Page'], ['owner_ack', 'Owner ack'], ['killed', 'Kill'], ['proof', 'Proof']] as const;
export function DrillBanner() {
  const reduce = useReducedMotion();
  const incidents = useStore((s) => s.incidents);
  const agents = useStore((s) => s.agents);
  const run = useStore((s) => s.drillRun);
  const newest = useStore((s) => s.actions[s.actions.length - 1]?.ts ?? 0);
  const t0 = run && run.phase !== 'done' && run.phase !== 'error' ? Math.max(0, ...Object.values(run.starts)) : 0;
  const g = groupIncidents(incidents).find((x) => x.first >= t0 - 1000);
  const running = !!run && run.phase !== 'done' && run.phase !== 'error';
  const live = !!g && g.last.stage !== 'resolved' && !(newest > 0 && newest - g.last.ts > 120000) && !(g.byStage.proof && !running);
  const show = running || live;
  const now = useNow(show ? 250 : 5000);
  const name = g ? agents.find((a) => a.id === g.agentId)?.name ?? g.agentId : '';
  const cur = g ? STEPS.findIndex(([k]) => !g.byStage[k]) : 0;
  return (
    <AnimatePresence>
      {show && (
        <motion.section key="b" className="ibar" aria-label="Incident in progress" initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
          <div className="ibar-in">
            <div className="ibar-t"><Siren size={20} aria-hidden /><div><p className="ibar-h">{g ? <>Incident: <strong>{name}</strong></> : <>Drill starting: <strong>{run?.name.replace(/-/g, ' ')}</strong></>}</p><p className="ibar-s" role="status">{g ? g.last.message : run?.phase === 'ungoverned' ? 'First pass without controls, to show the damage.' : 'Warming the fleet up, then injecting the fault.'}</p></div></div>
            <ol className="ibar-steps" aria-label="Incident timeline">
              {STEPS.map(([k, l], i) => { const e = g?.byStage[k]; const st = e ? 'done' : i === cur && g ? 'cur' : 'todo'; return (
                <li key={k} className={`istep is-${st}`}><span className="istep-i" aria-hidden="true">{e ? <Check size={13} strokeWidth={3} /> : i + 1}</span><span>{l}</span><span className="measured istep-t">{e && g ? secs(e.ts - g.first) : st === 'cur' && g ? secs(Math.max(0, now - g.first)) : ''}</span></li>
              ); })}
            </ol>
            <a className="btn btn--sm" href="#/drill">Open the drill view <ArrowRight size={14} aria-hidden /></a>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
