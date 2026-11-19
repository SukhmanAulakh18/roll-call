import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { BadgeCheck, Check, Link2, OctagonX, ShieldOff, X } from 'lucide-react';
import type { ActionEvent, IncidentEvent } from '../../contracts/types';
import { FIXTURE, getState, killAgent, useStore, verifyReceipts } from './store';
import { fixtureReceipt } from './fixtures/FIXTURE_stream';
import { setUi, useUi } from './ui-state';
import { FixtureChip, Initials, NotMeasured, StateMark, VerdictChip, clock, ownerShort, usd, type AgentState } from './ui';

/** Mirrors contracts/prices.ts HIGH_RISK_TOOLS (the tools a stale bundle fails closed on). */
export const HIGH_RISK_TOOLS = ['payments.transfer', 'ledger.post', 'mail.send'];

// ---------- animated proof card ----------
export function ProofCard({ agentId, proof, title = 'Stopped, and proven.' }: { agentId: string; proof: NonNullable<IncidentEvent['proof']>; title?: string }) {
  const reduce = useReducedMotion();
  const denied = proof.verdict === 'deny';
  return (
    <motion.section className={`proof ${denied ? 'is-ok' : 'is-bad'}`} role="status" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
      <svg className="proof-check" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <motion.circle cx="24" cy="24" r="21" fill="none" strokeWidth="2.5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.55, ease: 'easeOut' }} />
        <motion.path d="M14 25l7 7 13-15" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5, duration: 0.35, ease: 'easeOut' }} />
      </svg>
      <div>
        <h3>{denied ? title : 'The probe was not blocked.'}</h3>
        <p className="proof-line">Probe replayed <code className="measured">{proof.attemptedTool}</code> as <code className="measured">{agentId}</code> <span aria-hidden="true">→</span> <strong>{proof.verdict === 'deny' ? 'DENIED' : proof.verdict.toUpperCase()} ({proof.code})</strong> <span className="measured">receipt {proof.receiptId}</span></p>
        <button className="btn btn--sm" onClick={() => { const a = getState().actions.find((x) => x.receiptId === proof.receiptId); if (a) setUi({ receipt: a }); else toast('Receipt is not in this browser session yet.', { description: proof.receiptId }); }}><Link2 size={14} aria-hidden />Open receipt</button>
      </div>
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
      toast.success(`${agent?.name ?? id} stopped`, { description: ev.proof ? `Probe denied (${ev.proof.code}).` : 'Kill sent.' });
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
          {agent && proof && (proof.proof ? <ProofCard agentId={agent.id} proof={proof.proof} /> : <p className="note">Kill sent. The server returned no proof yet: {proof.message}</p>)}
          {proof && <div className="modal-foot"><Dialog.Close className="btn btn--primary">Done</Dialog.Close></div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------- receipt detail ----------
export function ReceiptDialog() {
  const a = useUi((u) => u.receipt);
  const actions = useStore((s) => s.actions);
  const [res, setRes] = useState<Awaited<ReturnType<typeof verifyReceipts>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setRes(null); setErr(''); }, [a?.receiptId]);
  if (!a) return null;
  const [gw, seqS] = a.receiptId.split(':');
  const seq = Number(seqS);
  const fx = FIXTURE ? fixtureReceipt(a.receiptId) : undefined;
  const prevId = `${gw}:${seq - 1}`, nextId = `${gw}:${seq + 1}`;
  const prev = actions.find((x) => x.receiptId === prevId);
  const verify = async () => { setBusy(true); setErr(''); try { setRes(await verifyReceipts()); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const open = (x?: ActionEvent) => x && setUi({ receipt: x });
  const next = actions.find((x) => x.receiptId === nextId);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && setUi({ receipt: null })}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal" aria-describedby="rc-d">
          <div className="sheet-h">
            <Dialog.Title asChild><h2>Receipt <span className="measured">{a.receiptId}</span></h2></Dialog.Title>
            <Dialog.Close className="btn btn--icon" aria-label="Close"><X size={16} aria-hidden /></Dialog.Close>
          </div>
          <Dialog.Description id="rc-d" className="sheet-lead">One gateway decision, written to a hash chain so it cannot be edited later without breaking every receipt after it. {a.governed ? '' : 'This one came from the ungoverned baseline path and has no receipt.'}</Dialog.Description>
          <dl className="facts facts--cols">
            <div><dt>Decision</dt><dd><VerdictChip v={a.verdict} code={a.code} /> <span className="measured">{a.code}</span></dd></div>
            <div><dt>Agent and tool</dt><dd><span className="measured">{a.agentId}</span> called <span className="measured">{a.tool}</span>{a.targetAgentId ? <> targeting <span className="measured">{a.targetAgentId}</span></> : null}</dd></div>
            <div><dt>When</dt><dd className="measured">{new Date(a.ts).toLocaleString()}</dd></div>
            <div><dt>Cost and decision time</dt><dd className="measured">{usd(a.costUsd, 4)}, {a.latencyMs} ms</dd></div>
            <div><dt>Arguments hash</dt><dd className="measured wrap">{a.argsHash}</dd></div>
            <div><dt>Gateway</dt><dd className="measured">{a.gatewayId}</dd></div>
          </dl>
          {a.governed && (
            <section className="chainbox" aria-label="Hash chain">
              <h3>Hash chain {FIXTURE && <FixtureChip />}</h3>
              <div className="chain">
                <div className="link"><span className="link-k">previous receipt</span><span className="measured">{prevId}</span><span className="link-h measured wrap">{fx ? fx.prevHash.slice(0, 32) + '…' : seq === 0 ? 'GENESIS' : 'hash is in the gateway JSONL'}</span></div>
                <span className="chain-arrow" aria-hidden="true">→</span>
                <div className="link link--this"><span className="link-k">this receipt</span><span className="measured">{a.receiptId}</span><span className="link-h measured wrap">{fx ? fx.hash.slice(0, 32) + '…' : 'hash is in the gateway JSONL'}</span></div>
              </div>
              {!fx && <p className="muted">The stream carries the decision, not the hashes. Verifying recomputes every hash on the gateway and reports the first broken sequence, if any.</p>}
              {FIXTURE && <p className="muted">Fixture hashes come from a simple in-browser mixer, not SHA-256. They only show the shape of the chain.</p>}
              <div className="row-actions">
                <button className="btn btn--sm" onClick={() => open(prev)} disabled={!prev}>Previous</button>
                <button className="btn btn--sm" onClick={() => open(next)} disabled={!next}>Next</button>
                <button className="btn btn--primary btn--sm" onClick={verify} disabled={busy}><BadgeCheck size={14} aria-hidden />{busy ? 'Recomputing' : 'Verify chain'}</button>
              </div>
              <div aria-live="polite">
                {err && <p className="note-bad">{err}</p>}
                {res?.map((r) => <p key={r.gateway} className={r.ok ? 'note-ok' : 'note-bad'}>{r.ok ? <Check size={14} aria-hidden /> : <ShieldOff size={14} aria-hidden />} {r.gateway}: {r.ok ? `chain intact${r.count != null ? `, ${r.count} receipts recomputed` : ''}` : `BROKEN ${r.reason ?? ''}`}</p>)}
              </div>
            </section>
          )}
          <p className="muted">{clock(a.ts)}</p>
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
