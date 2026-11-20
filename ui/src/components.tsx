import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { Check, Link2, OctagonX, ShieldOff, X } from 'lucide-react';
import type { IncidentEvent } from '../../contracts/types';
import { getState, killAgent, useStore } from './store';
import { openReceipt, setUi, useUi } from './ui-state';
import { Initials, NotMeasured, StateMark, ownerShort, usd, type AgentState } from './ui';

/** Mirrors contracts/prices.ts HIGH_RISK_TOOLS (the tools a stale bundle fails closed on). */
export const HIGH_RISK_TOOLS = ['payments.transfer', 'ledger.post', 'mail.send'];

// ---------- unproven kill: loud, never styled as success ----------
export const KillUnconfirmed = ({ ev }: { ev: IncidentEvent }) => (
  <section className="proof is-bad" role="alert"><div><h3>Kill not proven</h3><p className="proof-line">{ev.message}</p></div></section>
);

// ---------- animated proof card ----------
export function ProofCard({ agentId, proof, title = 'Stopped, and proven.' }: { agentId: string; proof: NonNullable<IncidentEvent['proof']>; title?: string }) {
  const reduce = useReducedMotion();
  const denied = proof.verdict === 'deny';
  return (
    <motion.section className={`proof receipt ${denied ? 'is-ok' : 'is-bad'}`} role="status" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
      <p className="receipt-k">Receipt <span className="measured">{proof.receiptId}</span></p>
      <h3>{denied ? title : 'The probe was not blocked.'}</h3>
      <p className="proof-line">Probe replayed <code className="measured">{proof.attemptedTool}</code> as <code className="measured">{agentId}</code>. Result: <strong>{proof.verdict === 'deny' ? 'DENIED' : proof.verdict.toUpperCase()} ({proof.code})</strong></p>
      <motion.span className="stamp" aria-hidden="true" initial={reduce ? false : { opacity: 0, scale: 1.9, rotate: -2 }} animate={{ opacity: 1, scale: 1, rotate: -9 }} transition={{ delay: 0.45, type: 'spring', stiffness: 520, damping: 22 }}>
        {denied ? <Check size={18} strokeWidth={3} /> : <ShieldOff size={18} strokeWidth={3} />}{denied ? 'Refused' : 'Open'}
      </motion.span>
      <button className="btn btn--sm" onClick={() => { const a = getState().actions.find((x) => x.receiptId === proof.receiptId); if (a) openReceipt(a); else toast('Receipt is not in this browser session yet.', { description: proof.receiptId }); }}><Link2 size={14} aria-hidden />Open receipt</button>
    </motion.section>
  );
}

// ---------- hold to confirm: hold the pointer, or press Enter twice (assistive tech clicks arm then confirm) ----------
export function HoldButton({ label, armedLabel, onConfirm, ms = 1200, disabled }: { label: string; armedLabel: string; onConfirm: () => void; ms?: number; disabled?: boolean }) {
  const reduce = useReducedMotion();
  const [p, setP] = useState(0);
  const [armed, setArmed] = useState(false);
  const raf = useRef(0), t0 = useRef(0), done = useRef(false), armT = useRef<ReturnType<typeof setTimeout>>();
  const stop = () => { cancelAnimationFrame(raf.current); t0.current = 0; setP(0); };
  const start = () => {
    if (disabled || done.current) return;
    t0.current = performance.now();
    const loop = () => {
      const f = Math.min(1, (performance.now() - t0.current) / ms);
      setP(f);
      if (f >= 1) { done.current = true; onConfirm(); return; }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(armT.current); }, []);
  const press = () => { // keyboard / assistive tech path
    if (disabled || done.current) return;
    if (armed) { done.current = true; onConfirm(); return; }
    setArmed(true); clearTimeout(armT.current); armT.current = setTimeout(() => setArmed(false), 5000);
  };
  return (
    <>
      <button type="button" className={`btn btn--danger hold ${armed ? 'is-armed' : ''}`} disabled={disabled} style={{ ['--hold' as string]: p }}
        onPointerDown={(e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; start(); }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) press(); } }}
        onClick={(e) => { if (e.detail === 0) press(); }}>
        <span className="hold-fill" aria-hidden="true" />
        <OctagonX size={16} aria-hidden /><span>{armed ? armedLabel : label}</span>
      </button>
      <p className="hold-help">{reduce ? 'Press and hold, or press Enter twice.' : 'Press and hold for a moment, or press Enter twice.'}</p>
      <span className="visually-hidden" aria-live="assertive">{armed ? 'Armed. Press Enter again to stop the agent.' : ''}</span>
    </>
  );
}

// ---------- kill flow ----------
export function KillDialog() {
  const id = useUi((u) => u.killId);
  const agent = useStore((s) => s.agents.find((a) => a.id === id));
  const state = (useStore((s) => (id ? s.fleet?.states?.[id] : undefined)) ?? 'unknown') as AgentState;
  const rate = useStore((s) => (id ? s.fleet?.spendPerMinUsd?.[id] : undefined));
  const actions = useStore((s) => s.actions);
  const incidents = useStore((s) => s.incidents);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<IncidentEvent | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (id) { setProof(null); setErr(''); setBusy(false); } }, [id]);
  const close = () => setUi({ killId: null });
  if (!id) return null;
  const mine = actions.filter((a) => a.agentId === id).slice(-60);
  const calledBy = [...new Set(actions.filter((a) => a.targetAgentId === id).map((a) => a.agentId))];
  const calls = [...new Set(actions.filter((a) => a.agentId === id && a.targetAgentId).map((a) => a.targetAgentId!))];
  const denials = mine.filter((a) => a.verdict !== 'allow').length;
  const lastInc = [...incidents].reverse().find((e) => e.agentId === id);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const ev = await killAgent(id);
      setProof(ev);
      if (ev.stage === 'kill_unconfirmed') toast.error(`KILL NOT PROVEN: ${agent?.name ?? id}`, { description: ev.message, duration: Infinity });
      else toast.success(getState().source === 'recorded' ? `Recorded proof for ${agent?.name ?? id}` : `${agent?.name ?? id} stopped`, { description: ev.proof ? `Probe denied (${ev.proof.code}).` : 'Kill sent.' });
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal modal--danger" aria-describedby="kill-d">
          <div className="sheet-h">
            <Dialog.Title asChild><h2>{proof ? 'Agent stopped' : `Stop ${agent?.name ?? id}?`}</h2></Dialog.Title>
            <Dialog.Close className="btn btn--icon" aria-label="Close"><X size={16} aria-hidden /></Dialog.Close>
          </div>
          <Dialog.Description id="kill-d" className="sheet-lead">{proof ? 'Its identity is revoked. The probe below is the receipt that proves it.' : 'Revokes its identity at the gateway, stops its runtime, then an independent probe tries to act as it. Nothing it was doing is retried.'}</Dialog.Description>
          {!agent && <p className="note-bad">No agent called <code className="measured">{id}</code> is loaded.</p>}
          {agent && !proof && (
            <>
              <section className="blast" aria-label="Blast radius">
                <h3>Blast radius</h3>
                <dl className="facts facts--cols">
                  <div><dt>Tools it can call ({agent.scopes.tools.length})</dt><dd className="taglist">{agent.scopes.tools.map((t) => <span key={t} className={`tag ${HIGH_RISK_TOOLS.includes(t) ? 'tag--risk' : ''}`}>{t}{HIGH_RISK_TOOLS.includes(t) ? <span className="visually-hidden"> (high risk)</span> : null}</span>)}</dd></div>
                  <div><dt>Data it can read ({agent.scopes.data.length})</dt><dd className="taglist">{agent.scopes.data.map((t) => <span key={t} className="tag">{t.replace(/^synthetic-/, '')}</span>)}</dd></div>
                  <div><dt>Depends on it</dt><dd>{calledBy.length ? calledBy.join(', ') : <span className="muted">No agent-to-agent calls into it seen this session.</span>}</dd></div>
                  <div><dt>It depends on</dt><dd>{calls.length ? calls.join(', ') : <span className="muted">No agent-to-agent calls out of it seen this session.</span>}</dd></div>
                </dl>
                <p className="muted">High-risk tools are marked. Other agents keep running.</p>
              </section>
              <section className="evidence" aria-label="Evidence">
                <h3>Evidence</h3>
                <ul>
                  <li><StateMark state={state} /></li>
                  <li>Spend rate <span className="measured">{typeof rate === 'number' ? `${usd(rate, 3)}/min` : 'not reported yet'}</span></li>
                  <li>Last {mine.length} decisions: <span className="measured">{denials} denied or slowed</span></li>
                  {lastInc && <li>Latest incident: {lastInc.message}</li>}
                  <li>Owner <Initials name={agent.owner.name} size={20} /> {ownerShort(agent.owner.name)}, escalation <span className="measured">{agent.owner.escalation}</span></li>
                </ul>
              </section>
              {err && <p className="note-bad" role="alert">Could not stop the agent: {err}</p>}
              <div className="modal-foot">
                <HoldButton label={busy ? 'Stopping' : 'Hold to stop this agent'} armedLabel="Press Enter again to stop" onConfirm={go} disabled={busy || state === 'killed'} />
                <Dialog.Close className="btn">Cancel</Dialog.Close>
              </div>
            </>
          )}
          {agent && proof && (proof.stage === 'kill_unconfirmed' ? <KillUnconfirmed ev={proof} /> : proof.proof ? <ProofCard agentId={agent.id} proof={proof.proof} /> : <p className="note">Kill sent. The server returned no proof yet: {proof.message}</p>)}
          {proof && <div className="modal-foot"><Dialog.Close className="btn btn--primary">Done</Dialog.Close></div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Panel = ({ title, aside, children, className = '', id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) => (
  <section className={`panel ${className}`} aria-labelledby={id}>
    {(title || aside) && <header className="panel-h">{title && <h2 id={id}>{title}</h2>}{aside && <div className="panel-aside">{aside}</div>}</header>}
    {children}
  </section>
);

export { NotMeasured };
