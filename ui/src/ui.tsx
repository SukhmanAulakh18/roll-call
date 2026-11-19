import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { animate, useReducedMotion } from 'motion/react';
import { BadgeCheck, CircleDashed, OctagonX, PauseCircle, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { ActionEvent, IncidentEvent, IncidentStage } from '../../contracts/types';
import { useStore } from './store';
import { setUi, useUi } from './ui-state';

export const usd = (n: number, max = 2) => `$${n.toLocaleString('en-US', { maximumFractionDigits: max, minimumFractionDigits: n !== 0 && Math.abs(n) < 1 ? Math.min(2, max) : 0 })}`;
export const secs = (ms: number) => `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`;
export const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const get = (o: any, path: string): any => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
export const initials = (name: string) => name.replace(/\(.*\)/, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const ownerShort = (name: string) => name.replace(/\s*\(.*\)/, '');

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem('rc.' + key); return s == null ? init : (JSON.parse(s) as T); } catch { return init; } });
  return [v, (n) => { setV(n); try { localStorage.setItem('rc.' + key, JSON.stringify(n)); } catch { /* storage unavailable */ } }];
}
export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setN(Date.now()), ms); return () => clearInterval(h); }, [ms]);
  return n;
}

export const NotMeasured = ({ cmd }: { cmd: string }) => (
  <span className="not-measured">not measured yet, run <code className="measured">{cmd}</code></span>
);
export const Assumption = ({ children = 'ASSUMPTION' }: { children?: ReactNode }) => <span className="chip chip--assume" title="A number someone typed in, not something we measured">{children}</span>;
export const Measured = () => <span className="chip chip--cool" title="Computed from a real run of the simulated fleet">measured</span>;
export const FixtureChip = () => <span className="chip chip--fixture" title="Invented placeholder data for development. Never a real run.">FIXTURE DATA</span>;

// ---------- tooltip ----------
export const TipProvider = ({ children }: { children: ReactNode }) => <Tooltip.Provider delayDuration={250}>{children}</Tooltip.Provider>;
export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tip" side={side} sideOffset={6}>{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

// ---------- state marks: icon + text, never colour alone ----------
export type AgentState = 'healthy' | 'alert' | 'throttled' | 'killed' | 'unknown';
const LABEL: Record<AgentState, string> = { healthy: 'Healthy', alert: 'Needs attention', throttled: 'Slowed down', killed: 'Stopped', unknown: 'No data yet' };
export const stateLabel = (s: AgentState) => LABEL[s];
export const StateIcon = ({ state, size = 16 }: { state: AgentState; size?: number }) => {
  const P = { size, 'aria-hidden': true, strokeWidth: 2.2 } as const;
  return state === 'healthy' ? <ShieldCheck {...P} /> : state === 'alert' ? <TriangleAlert {...P} /> : state === 'throttled' ? <PauseCircle {...P} /> : state === 'killed' ? <OctagonX {...P} /> : <CircleDashed {...P} />;
};
export const StateMark = ({ state }: { state: AgentState }) => <span className={`statemark s-${state}`}><StateIcon state={state} />{LABEL[state]}</span>;

// ---------- verdicts ----------
export const VerdictChip = ({ v, code }: { v: ActionEvent['verdict']; code?: string }) => (
  <span className={`verdict v-${v}`}>{v === 'allow' ? <ShieldCheck size={14} aria-hidden /> : v === 'deny' ? <OctagonX size={14} aria-hidden /> : <PauseCircle size={14} aria-hidden />}{v === 'allow' ? 'Allowed' : v === 'deny' ? 'Denied' : 'Slowed'}{code && v !== 'allow' ? <span className="measured">{code}</span> : null}</span>
);

// ---------- tiny graphics ----------
export function Sparkline({ values, w = 96, h = 24, label, tone = 'cool' }: { values: number[]; w?: number; h?: number; label?: string; tone?: 'cool' | 'amber' | 'bad' | 'muted' }) {
  if (values.length < 2) return <svg width={w} height={h} role="img" aria-label={label ?? 'no trend yet'} className="spark spark--empty"><line x1="0" x2={w} y1={h - 2} y2={h - 2} /></svg>;
  const max = Math.max(...values, 1e-9), min = Math.min(...values, 0);
  const x = (i: number) => (i / (values.length - 1)) * (w - 2) + 1, y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 5);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ?? 'trend'} className={`spark spark--${tone}`}>
      <path d={`${d}L${w - 1},${h - 1}L1,${h - 1}Z`} className="spark-area" /><path d={d} className="spark-line" /><circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2" />
    </svg>
  );
}

export function CountUp({ value, format, duration = 0.9 }: { value: number; format: (n: number) => string; duration?: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const prev = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { setShown(value); prev.current = value; return; }
    const c = animate(prev.current, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { prev.current = v; setShown(v); } });
    return () => c.stop();
  }, [value, reduce, duration]);
  return <>{format(shown)}</>;
}

export const Initials = ({ name, size = 28 }: { name: string; size?: number }) => (
  <span className="initials" style={{ width: size, height: size, ['--ini' as string]: `${size * 0.46}px` }} title={`Owner ${ownerShort(name)}`}>{initials(name)}</span>
);

// ---------- incidents ----------
export const STAGES: IncidentStage[] = ['canary_started', 'detected', 'throttled', 'paged', 'owner_ack', 'killed', 'proof', 'kill_unconfirmed', 'resolved', 'rolled_back', 'promoted'];
export interface IncidentGroup { id: string; agentId: string; byStage: Partial<Record<IncidentStage, IncidentEvent>>; last: IncidentEvent; first: number }
export function groupIncidents(list: IncidentEvent[]): IncidentGroup[] {
  const m = new Map<string, IncidentGroup>();
  for (const e of list) {
    const g = m.get(e.incidentId) ?? { id: e.incidentId, agentId: e.agentId, byStage: {}, last: e, first: e.ts };
    g.byStage[e.stage] = e; g.first = Math.min(g.first, e.ts);
    if (STAGES.indexOf(e.stage) >= STAGES.indexOf(g.last.stage)) g.last = e;
    m.set(e.incidentId, g);
  }
  return [...m.values()].sort((a, b) => b.last.ts - a.last.ts);
}

// ---------- Verify sheet ----------
export interface VerifySpec { title: string; what: string; field: string; shown: string; kind: 'measured' | 'ASSUMPTION'; command: string; extra?: string }
export function VerifySheet() {
  const spec = useUi((u) => u.verify);
  const impact = useStore((s) => s.impact);
  const source = useStore((s) => s.source);
  return (
    <Dialog.Root open={!!spec} onOpenChange={(o) => !o && setUi({ verify: null })}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="sheet" aria-describedby="vh-d">
          {spec && <>
            <div className="sheet-h">
              <Dialog.Title asChild><h2>{spec.title}</h2></Dialog.Title>
              <Dialog.Close className="btn btn--icon" aria-label="Close verification"><X size={16} aria-hidden /></Dialog.Close>
            </div>
            <Dialog.Description id="vh-d" className="sheet-lead">{spec.what}</Dialog.Description>
            <dl className="facts">
              <div><dt>Shown as</dt><dd className="reading reading--s">{spec.shown}</dd></div>
              <div><dt>Kind</dt><dd>{spec.kind === 'measured' ? <Measured /> : <Assumption />} {spec.kind === 'measured' ? 'Measured in a real run of the simulated fleet.' : 'A typed-in assumption, not a measurement.'}</dd></div>
              <div><dt>Source field</dt><dd className="measured wrap">{spec.field}</dd></div>
              <div><dt>Last run</dt><dd>{source === 'fixture' ? <><FixtureChip /> <span className="muted">Fixture mode has no real run.</span></> : impact?.generatedAt ? <><span className="measured">{new Date(impact.generatedAt).toLocaleString()}</span><br /><span className="measured muted">git {impact?.gitSha ?? 'unknown'}</span></> : <NotMeasured cmd={spec.command} />}</dd></div>
              <div><dt>Reproduce it</dt><dd><code className="codeblock measured">{spec.command}</code></dd></div>
              {spec.extra && <div><dt>Note</dt><dd>{spec.extra}</dd></div>}
            </dl>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export const VerifyButton = ({ spec }: { spec: VerifySpec }) => (
  <button className="btn btn--sm" onClick={() => setUi({ verify: spec })} aria-haspopup="dialog"><BadgeCheck size={14} aria-hidden />Verify<span className="visually-hidden"> {spec.title}</span></button>
);
