import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Octagon, ArrowUpRight, ArrowLeft, ShieldAlert, Check, BadgeCheck, ShieldOff } from 'lucide-react';
import type { ActionEvent, AgentRecord } from '../../contracts/types';
import { FIXTURE, useStore, verifyReceipts } from './store';
import { fixtureReceipt } from './fixtures/FIXTURE_stream';
import { backDrawer, closeDrawer, openAgent, openReceipt, setUi, useUi } from './ui-state';
import { FixtureChip, StateMark, VerdictChip, clock, ownerShort, usd, type AgentState } from './ui';
import { VERDICT_WORD, codeWords, dataWhat, rightNow, toolVerb, toolWhat } from './vocab';

/** The one side-panel shell used by the topology (and anything else that needs a drawer). Esc and the close button both call onClose. */
export function Drawer({ label, title, sub, onClose, onBack, fixed, children, footer }: { label: string; onBack?: () => void; fixed?: boolean; title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, [label]);
  return (
    <aside ref={ref} tabIndex={-1} className={`drawer ${fixed ? 'drawer--fixed' : ''}`} role="complementary" aria-label={label}>
      <header className="drawer-h">
        {onBack && <button type="button" className="btn btn--sm" onClick={onBack}><ArrowLeft size={14} aria-hidden />Back</button>}
        <div className="drawer-t"><h2>{title}</h2>{sub && <p className="muted drawer-sub">{sub}</p>}</div>
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close panel (Esc)"><X size={16} aria-hidden /></button>
      </header>
      <div className="drawer-b">{children}</div>
      {footer && <footer className="drawer-f">{footer}</footer>}
    </aside>
  );
}
export const Section = ({ h, children }: { h: string; children: ReactNode }) => <section className="drawer-s"><h3>{h}</h3>{children}</section>;

/** Live list of calls. `who` shows the agent name instead of the tool. Newest first. */
export function CallList({ calls, agents, who, markDrift }: { calls: ActionEvent[]; agents: AgentRecord[]; who?: boolean; markDrift?: (a: ActionEvent) => boolean }) {
  if (!calls.length) return <p className="empty empty--s">No calls yet in this window</p>;
  return (
    <ul className="calls" aria-live="off">
      {calls.map((c) => {
        const drift = markDrift?.(c);
        const name = agents.find((a) => a.id === c.agentId)?.name ?? c.agentId;
        return (
          <li key={c.receiptId} className={`call v-${c.verdict} ${drift ? 'is-drift' : ''}`}>
            <button type="button" className="call-b" onClick={() => openReceipt(c)} aria-label={`${clock(c.ts)}, ${name} ${toolVerb(c.tool)}, ${VERDICT_WORD[c.verdict]}, ${codeWords(c.code)}. Open receipt ${c.receiptId}`}>
              <span className="measured call-t">{clock(c.ts)}</span>
              <span className="call-what">{who ? <strong>{name}</strong> : null}{who ? ' ' : ''}{toolVerb(c.tool)}{c.targetAgentId ? ` (${c.targetAgentId})` : ''}{!who && <span className="measured call-tool"> {c.tool}</span>}</span>
              <span className="call-v"><VerdictChip v={c.verdict} />{drift && <span className="chip chip--bad"><ShieldAlert size={12} aria-hidden />out of scope</span>}</span>
              <span className="call-why">{c.verdict === 'allow' ? '' : `${codeWords(c.code)}. `}<span className="measured">{c.governed ? usd(c.costUsd, 4) : 'direct'}, {c.receiptId}</span></span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const latest = (actions: ActionEvent[], f: (a: ActionEvent) => boolean, n = 12) => { const out: ActionEvent[] = []; for (let i = actions.length - 1; i >= 0 && out.length < n; i--) if (actions[i].governed && f(actions[i])) out.push(actions[i]); return out; };

export function AgentDrawer({ id, onClose, canKill, onBack, fixed }: { id: string; onClose: () => void; canKill: boolean; onBack?: () => void; fixed?: boolean }) {
  const a = useStore((s) => s.agents.find((x) => x.id === id));
  const state = (useStore((s) => s.fleet?.states?.[id]) ?? 'unknown') as AgentState;
  const actions = useStore((s) => s.actions);
  const incidents = useStore((s) => s.incidents);
  const agents = useStore((s) => s.agents);
  if (!a) return <Drawer fixed={fixed} onBack={onBack} label="Agent" title="Agent not loaded" onClose={onClose}><p className="empty empty--s">No agent called <code className="measured">{id}</code> is loaded yet.</p></Drawer>;
  const calls = latest(actions, (x) => x.agentId === id);
  return (
    <Drawer fixed={fixed} onBack={onBack} label={`${a.name} details`} title={a.name} sub={<span className="measured">{a.id}</span>} onClose={onClose} footer={<>
      <a className="btn btn--sm btn--primary" href={`#/agent/${encodeURIComponent(a.id)}`} onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); }}>Open full record<ArrowUpRight size={14} aria-hidden /></a>
      {canKill && <button type="button" className="btn btn--sm btn--danger" disabled={state === 'killed'} onClick={() => setUi({ killId: a.id })}><Octagon size={14} aria-hidden />{state === 'killed' ? 'Already stopped' : 'Kill'}</button>}
    </>}>
      <Section h="What this agent does for the business">
        <p>{a.purpose}</p>
        {a.approvedUses.length > 0 && <ul className="plain">{a.approvedUses.map((u) => <li key={u}>{u}</li>)}</ul>}
        <dl className="kv2">
          <div><dt>Owner</dt><dd>{ownerShort(a.owner.name)}, {a.owner.team}</dd></div>
          <div><dt>Risk</dt><dd>{a.riskRating}</dd></div>
          <div><dt>Lifecycle</dt><dd>{a.lifecycleState}</dd></div>
        </dl>
      </Section>
      <Section h="Right now"><p><StateMark state={state} /></p><p>{rightNow(a, state, incidents, actions)}</p></Section>
      <Section h="Latest calls"><CallList calls={calls} agents={agents} markDrift={(c) => !a.scopes.tools.includes(c.tool)} /></Section>
    </Drawer>
  );
}

export function ToolDrawer({ id, kind, onClose, onPick }: { id: string; kind: 'tool' | 'data'; onClose: () => void; onPick: (agentId: string) => void }) {
  const agents = useStore((s) => s.agents);
  const actions = useStore((s) => s.actions);
  const allowed = agents.filter((a) => (kind === 'tool' ? a.scopes.tools : a.scopes.data).includes(id));
  const calls = kind === 'tool' ? latest(actions, (x) => x.tool === id) : [];
  const drift = calls.filter((c) => !allowed.some((a) => a.id === c.agentId));
  return (
    <Drawer label={`${id} details`} title={kind === 'data' ? id.replace(/^synthetic-/, '') : id} sub={kind === 'data' ? 'Data source' : 'Tool'} onClose={onClose}>
      <Section h="What it is"><p>{kind === 'tool' ? toolWhat(id) : dataWhat(id)}</p></Section>
      <Section h={`Agents allowed to use it (${allowed.length})`}>
        {allowed.length ? <ul className="plain plain--links">{allowed.map((a) => <li key={a.id}><button type="button" className="linklike" onClick={() => onPick(a.id)}>{a.name}</button> <span className="muted">{a.riskRating} risk</span></li>)}</ul> : <p className="empty empty--s">No agent is approved for this yet</p>}
      </Section>
      {kind === 'tool' && <>
        {drift.length > 0 && <Section h="Denied or out-of-scope attempts"><p className="note-bad"><ShieldAlert size={14} aria-hidden /> {drift.length} recent call{drift.length > 1 ? 's' : ''} from agents that are not approved for this tool (scope drift).</p></Section>}
        <Section h="Latest calls"><CallList calls={calls} agents={agents} who markDrift={(c) => !allowed.some((a) => a.id === c.agentId)} /></Section>
      </>}
    </Drawer>
  );
}

export function EdgeDrawer({ agentId, target, kind, onClose, onPick }: { agentId: string; target: string; kind: 'tool' | 'data'; onClose: () => void; onPick: (k: 'agent' | 'tool' | 'data', id: string) => void }) {
  const agents = useStore((s) => s.agents);
  const actions = useStore((s) => s.actions);
  const a = agents.find((x) => x.id === agentId);
  const inScope = !!a && (kind === 'tool' ? a.scopes.tools : a.scopes.data).includes(target);
  const calls = kind === 'tool' ? latest(actions, (x) => x.agentId === agentId && x.tool === target) : [];
  return (
    <Drawer label={`${a?.name ?? agentId} to ${target}`} title={<>{a?.name ?? agentId} <span className="muted">to</span> {target.replace(/^synthetic-/, '')}</>} sub="Path between an agent and a tool" onClose={onClose}>
      <Section h="Is this path allowed?">
        <p className={inScope ? 'note-ok' : 'note-bad'}>{inScope ? <><Check size={14} aria-hidden /> In scope. {a?.name} is approved to {kind === 'tool' ? `use ${target}` : `read ${target.replace(/^synthetic-/, '')}`}.</> : <><ShieldAlert size={14} aria-hidden /> Out of scope. {a?.name ?? agentId} is not approved for {target}; the gateway refuses these calls.</>}</p>
        <p className="plain--row"><button type="button" className="linklike" onClick={() => onPick('agent', agentId)}>About the agent</button><button type="button" className="linklike" onClick={() => onPick(kind, target)}>About the {kind === 'tool' ? 'tool' : 'data'}</button></p>
      </Section>
      {kind === 'tool' ? <Section h="Calls on this path"><CallList calls={calls} agents={agents} markDrift={() => !inScope} /></Section> : <Section h="Calls on this path"><p className="empty empty--s">Data reads are not on the stream, only the permission is shown</p></Section>}
    </Drawer>
  );
}

export function ReceiptDrawer({ a, onClose, onBack, fixed }: { a: ActionEvent; onClose: () => void; onBack?: () => void; fixed?: boolean }) {
  const actions = useStore((s) => s.actions);
  const agents = useStore((s) => s.agents);
  const live = useStore((s) => s.source === 'live' || s.source === 'fixture');
  const [res, setRes] = useState<Awaited<ReturnType<typeof verifyReceipts>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setRes(null); setErr(''); }, [a.receiptId]);
  const [gw, seqS] = a.receiptId.split(':');
  const seq = Number(seqS);
  const fx = FIXTURE ? fixtureReceipt(a.receiptId) : undefined;
  const prevId = `${gw}:${seq - 1}`, nextId = `${gw}:${seq + 1}`;
  const prev = actions.find((x) => x.receiptId === prevId);
  const next = actions.find((x) => x.receiptId === nextId);
  const agent = agents.find((x) => x.id === a.agentId);
  const verify = async () => { setBusy(true); setErr(''); try { setRes(await verifyReceipts()); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <Drawer fixed={fixed} label={`Receipt ${a.receiptId}`} title={<>Receipt <span className="measured">{a.receiptId}</span></>} sub={a.governed ? 'One gateway decision on a hash chain' : 'Ungoverned baseline path, no receipt'} onClose={onClose} onBack={onBack}>
      <Section h="Decision">
        <p><VerdictChip v={a.verdict} code={a.code} /> <span className="measured">{a.code}</span> {VERDICT_WORD[a.verdict]}, {codeWords(a.code)}.</p>
        <dl className="kv2">
          <div><dt>Agent</dt><dd><button type="button" className="linklike" onClick={() => openAgent(a.agentId)}>{agent?.name ?? a.agentId}</button></dd></div>
          <div><dt>Tool</dt><dd className="measured">{a.tool}{a.targetAgentId ? ` to ${a.targetAgentId}` : ''}</dd></div>
          <div><dt>When</dt><dd className="measured">{new Date(a.ts).toLocaleString()}</dd></div>
          <div><dt>Cost, decision time</dt><dd className="measured">{usd(a.costUsd, 4)}, {a.latencyMs} ms</dd></div>
          <div><dt>Gateway</dt><dd className="measured">{a.gatewayId}</dd></div>
          <div><dt>Arguments hash</dt><dd className="measured wrap">{a.argsHash}</dd></div>
        </dl>
      </Section>
      {a.governed && (
        <Section h="Hash chain">
          {FIXTURE && <p><FixtureChip /></p>}
          <dl className="kv2">
            <div><dt>Previous {prevId}</dt><dd className="measured wrap">{fx ? fx.prevHash.slice(0, 32) + '…' : seq === 0 ? 'GENESIS' : 'hash is in the gateway JSONL'}</dd></div>
            <div><dt>This {a.receiptId}</dt><dd className="measured wrap">{fx ? fx.hash.slice(0, 32) + '…' : 'hash is in the gateway JSONL'}</dd></div>
          </dl>
          {!fx && <p className="muted">The stream carries the decision, not the hashes. Verifying recomputes every hash on the gateway.</p>}
          <p className="plain--row">
            <button type="button" className="btn btn--sm" onClick={() => prev && openReceipt(prev, 'replace')} disabled={!prev}>Previous</button>
            <button type="button" className="btn btn--sm" onClick={() => next && openReceipt(next, 'replace')} disabled={!next}>Next</button>
          </p>
          <div aria-live="polite">
            {err && <p className="note-bad">{err}</p>}
            {res?.map((r) => <p key={r.gateway} className={r.ok ? 'note-ok' : 'note-bad'}>{r.ok ? <Check size={14} aria-hidden /> : <ShieldOff size={14} aria-hidden />} {r.gateway}: {r.ok ? `chain intact${r.count != null ? `, ${r.count} receipts recomputed` : ''}` : `BROKEN ${r.reason ?? ''}`}</p>)}
          </div>
        </Section>
      )}
      {a.governed && (live
        ? <div><button type="button" className="btn btn--primary btn--sm" onClick={verify} disabled={busy}><BadgeCheck size={14} aria-hidden />{busy ? 'Recomputing' : 'Verify chain'}</button></div>
        : <p className="muted">Verify chain needs live backend. This is a recorded run.</p>)}
    </Drawer>
  );
}

/** Single app-level drawer: whatever the Ring, tickers, chains or call rows opened. Esc closes it. */
export function GlobalDrawer() {
  const v = useUi((u) => u.drawer);
  const trail = useUi((u) => u.trail);
  const canKill = useStore((s) => s.source === 'live' || s.source === 'fixture');
  useEffect(() => {
    if (!v) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) closeDrawer(); };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [v]);
  if (!v) return null;
  const back = trail.length ? backDrawer : undefined;
  return v.k === 'agent' ? <AgentDrawer fixed id={v.id} canKill={canKill} onClose={closeDrawer} onBack={back} /> : <ReceiptDrawer fixed a={v.a} onClose={closeDrawer} onBack={back} />;
}
