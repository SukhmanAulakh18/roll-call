import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, Pause, TriangleAlert, X } from 'lucide-react';
import { useStore } from './store';
import { Sparkline, groupIncidents, usd, useNow, type AgentState } from './ui';

/** Heartbeat older than this means the agent did not answer the last sweep. */
const FRESH_MS = 15000;
/** One full sweep. Stations answer as the beam passes their angle. */
const SWEEP_S = 14;

type Look = 'live' | 'quiet' | 'alert' | 'throttled' | 'killed';
const LOOK_LABEL: Record<Look, string> = { live: 'Answered', quiet: 'No answer yet', alert: 'Needs attention', throttled: 'Slowed down', killed: 'Stopped' };

function useWide(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface Props { selected: string | null; onSelect: (id: string) => void; focus?: string | null; compact?: boolean }

/** The roll: every registered agent is a station on a ring, a slow sweep asks each to answer. */
export function RollRing({ selected, onSelect, focus = null, compact = false }: Props) {
  const agents = useStore((s) => s.agents);
  const states = useStore((s) => s.fleet?.states);
  const rates = useStore((s) => s.fleet?.spendPerMinUsd);
  const unreg = useStore((s) => s.fleet?.unregisteredRunning ?? 0);
  const beat = useStore((s) => s.beat);
  const source = useStore((s) => s.source);
  const incidents = useStore((s) => s.incidents);
  const hist = useStore((s) => s.spendHist);
  const now = useNow(1000);
  const box = useRef<HTMLDivElement>(null);
  const width = useWide(box);
  const wide = width >= 640 && !compact;
  const [peek, setPeek] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);

  const ghosts = Math.min(Math.max(unreg, 0), 4);
  const n = agents.length + ghosts;
  const VW = wide ? 1400 : 1000, VH = 1000, R = wide ? 322 : 380, cx = VW / 2, cy = VH / 2;
  const pos = (i: number) => { const a = (-90 + (360 * i) / Math.max(n, 1)) * (Math.PI / 180); return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), side: Math.cos(a) > 0.25 ? 'r' : Math.cos(a) < -0.25 ? 'l' : Math.sin(a) < 0 ? 't' : 'b' } as const; };

  const rows = useMemo(() => agents.map((a, i) => {
    const st = (states?.[a.id] ?? 'unknown') as AgentState;
    const fresh = source === 'replay' ? st !== 'unknown' : now - (beat[a.id] ?? 0) < FRESH_MS;
    const look: Look = st === 'killed' ? 'killed' : st === 'alert' ? 'alert' : st === 'throttled' ? 'throttled' : fresh && st === 'healthy' ? 'live' : 'quiet';
    const g = groupIncidents(incidents.filter((e) => e.agentId === a.id))[0];
    return { a, i, look, proof: look === 'killed' && !!g?.byStage.proof };
  }), [agents, states, beat, now, source, incidents]);

  const live = rows.filter((r) => r.look === 'live').length;
  const needs = rows.filter((r) => r.look === 'alert' || r.look === 'throttled').length;
  const stopped = rows.filter((r) => r.look === 'killed').length;
  const shown = focus ?? peek;
  const sel = shown ? rows.find((r) => r.a.id === shown) : undefined;
  const fp = focus ? rows.find((r) => r.a.id === focus) : undefined;
  const fpos = fp ? pos(fp.i) : null;
  const scale = fp ? 1.9 : 1;
  const zoom: CSSProperties = fpos ? { transform: `translate(${(-(fpos.x / VW - 0.5) * scale * 100).toFixed(2)}%, ${(-(fpos.y / VH - 0.5) * scale * 100).toFixed(2)}%) scale(${scale})` } : {};

  const move = (e: KeyboardEvent, i: number) => {
    const last = rows.length - 1;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % rows.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + last) % rows.length : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (to < 0) return;
    e.preventDefault(); setTab(to); btns.current[to]?.focus();
  };
  const summary = `${live} of ${agents.length} agents answered the roll${needs ? `, ${needs} need a person` : ''}${stopped ? `, ${stopped} stopped` : ''}${ghosts ? `, ${ghosts} unregistered workloads did not answer` : ''}`;
  const tabIdx = Math.min(tab, Math.max(rows.length - 1, 0));

  return (
    <div className={`roll ${wide ? 'roll--wide' : 'roll--sq'} ${fp ? 'is-zoomed' : ''} ${compact ? 'roll--compact' : ''}`} ref={box} style={{ aspectRatio: `${VW} / ${VH}` }}>
      <div className="ring-zoom" style={zoom}>
        <svg className="ring-svg" viewBox={`0 0 ${VW} ${VH}`} aria-hidden="true" focusable="false">
          <circle cx={cx} cy={cy} r={R + 62} className="ring-outer" />
          {Array.from({ length: 72 }, (_, k) => { const a = (k * 5 * Math.PI) / 180, major = k % 6 === 0, r1 = R + 62, r2 = r1 - (major ? 22 : 9); return <line key={k} x1={cx + r1 * Math.cos(a)} y1={cy + r1 * Math.sin(a)} x2={cx + r2 * Math.cos(a)} y2={cy + r2 * Math.sin(a)} className={major ? 'tick tick--maj' : 'tick'} />; })}
          <circle cx={cx} cy={cy} r={R} className="ring-track" />
          <circle cx={cx} cy={cy} r={R - 120} className="ring-inner" />
        </svg>
        <div className="sweep" aria-hidden="true" style={{ width: `${((R + 62) * 2 / VW) * 100}%`, height: `${((R + 62) * 2 / VH) * 100}%`, animationDuration: `${SWEEP_S}s` }} />
        <div role="group" aria-label="Fleet roster. Use the arrow keys to move between agents, Enter to open one." className="roster">
          {rows.map((r) => {
            const p = pos(r.i);
            const on = selected === r.a.id;
            return (
              <button key={r.a.id} ref={(el) => { btns.current[r.i] = el; }} type="button" tabIndex={r.i === tabIdx ? 0 : -1}
                className={`st st-${r.look} st-side-${p.side} ${on ? 'is-on' : ''} ${focus === r.a.id ? 'is-focus' : ''}`}
                style={{ left: `${(p.x / VW) * 100}%`, top: `${(p.y / VH) * 100}%`, ['--delay' as string]: `${((r.i / Math.max(n, 1)) * SWEEP_S).toFixed(2)}s`, ['--period' as string]: `${SWEEP_S}s` }}
                aria-label={`${r.a.name}, ${LOOK_LABEL[r.look]}${r.proof ? ', proof of stop on file' : ''}. Open record.`} aria-current={on ? 'true' : undefined}
                onClick={() => { setTab(r.i); onSelect(r.a.id); }} onKeyDown={(e) => move(e, r.i)}
                onFocus={() => { setTab(r.i); setPeek(r.a.id); }} onBlur={() => setPeek(null)} onPointerEnter={() => setPeek(r.a.id)} onPointerLeave={() => setPeek(null)}>
                <span className="st-node" aria-hidden="true"><i className="st-ping" />
                  {r.look === 'live' ? <Check size={20} strokeWidth={2.8} /> : r.look === 'alert' ? <TriangleAlert size={20} strokeWidth={2.4} /> : r.look === 'throttled' ? <Pause size={18} strokeWidth={2.6} /> : r.look === 'killed' ? <X size={20} strokeWidth={2.6} /> : <span className="st-dot" />}
                </span>
                <span className={`st-label ${compact && !on && focus !== r.a.id ? 'st-label--off' : ''}`} aria-hidden="true"><span className="st-name">{r.a.name}</span>{r.look !== 'live' && <span className="st-sub">{LOOK_LABEL[r.look]}</span>}</span>
                {r.proof && <span className="st-stamp" aria-hidden="true">Proof</span>}
              </button>
            );
          })}
          {Array.from({ length: ghosts }, (_, k) => {
            const p = pos(agents.length + k);
            return (
              <div key={`g${k}`} className={`st st-gap st-side-${p.side}`} role="img" aria-label="Unregistered workload running with no record. It did not answer." style={{ left: `${(p.x / VW) * 100}%`, top: `${(p.y / VH) * 100}%` }}>
                <span className="st-node" aria-hidden="true"><span className="st-q">?</span></span>
                <span className="st-label" aria-hidden="true"><span className="st-name">Unregistered</span><span className="st-sub">Did not answer</span></span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ring-read" aria-hidden="true">
        {sel ? (
          <div className="readout readout--agent">
            <p className="readout-k">{LOOK_LABEL[sel.look]}</p>
            <p className="readout-name">{sel.a.name}</p>
            <p className="readout-rate measured">{typeof rates?.[sel.a.id] === 'number' ? `${usd(rates[sel.a.id], 3)} / min` : 'spend not reported yet'}</p>
            <p className="readout-scopes">{sel.a.scopes.tools.slice(0, 4).map((t) => <span className="tag" key={t}>{t}</span>)}{sel.a.scopes.tools.length > 4 && <span className="tag">+{sel.a.scopes.tools.length - 4}</span>}</p>
            <Sparkline values={hist[sel.a.id] ?? []} w={200} h={36} tone={sel.look === 'alert' || sel.look === 'throttled' ? 'bad' : sel.look === 'killed' ? 'muted' : 'cool'} label={`${sel.a.name} spend per minute trace`} />
          </div>
        ) : (
          <div className="readout">
            <p className="readout-big measured">{agents.length ? live : '–'}<span className="readout-of"> / {agents.length || '–'}</span></p>
            <p className="readout-k">answered the roll</p>
            <p className="readout-s">{!agents.length ? 'Waiting for the registry' : needs ? `${needs} need a person` : stopped ? `${stopped} stopped, proof on file` : ghosts ? `${ghosts} unregistered, no answer` : 'No gaps in the roll'}</p>
          </div>
        )}
      </div>
      <p className="visually-hidden" role="status">{summary}</p>
    </div>
  );
}
