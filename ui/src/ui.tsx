import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { IncidentEvent, IncidentStage } from '../../contracts/types';
import { useStore } from './store';

export const usd = (n: number, max = 2) => `$${n.toLocaleString('en-US', { maximumFractionDigits: max, minimumFractionDigits: n !== 0 && Math.abs(n) < 1 ? Math.min(2, max) : 0 })}`;
export const secs = (ms: number) => `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`;
export const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const get = (o: any, path: string): any => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem('rc.' + key); return s == null ? init : (JSON.parse(s) as T); } catch { return init; } });
  return [v, (n) => { setV(n); try { localStorage.setItem('rc.' + key, JSON.stringify(n)); } catch { /* storage unavailable */ } }];
}

export const NotMeasured = ({ cmd }: { cmd: string }) => (
  <span className="text-mute italic">not measured yet <span className="not-italic">— run <code className="font-mono text-ink">{cmd}</code></span></span>
);
export const Assumption = ({ children = 'ASSUMPTION' }: { children?: ReactNode }) => <span className="chip chip-assume" title="A number someone typed in, not something we measured">{children}</span>;
export const Measured = () => <span className="chip" title="Computed from a real run of the simulated fleet">measured</span>;

// ---------- state marks: icon + text, never color alone ----------
export type AgentState = 'healthy' | 'alert' | 'throttled' | 'killed' | 'unknown';
const STATE: Record<AgentState, { label: string; path: ReactNode }> = {
  healthy: { label: 'Healthy', path: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></> },
  alert: { label: 'Needs attention', path: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.4v.1" /></> },
  throttled: { label: 'Slowed down', path: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8.5v7M14.5 8.5v7" /></> },
  killed: { label: 'Stopped', path: <><circle cx="12" cy="12" r="9" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" /></> },
  unknown: { label: 'No data yet', path: <circle cx="12" cy="12" r="9" strokeDasharray="3 3" /> },
};
export const stateLabel = (s: AgentState) => STATE[s].label;
export const StateIcon = ({ state, size = 20 }: { state: AgentState; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{STATE[state].path}</svg>
);
export const StateMark = ({ state }: { state: AgentState }) => (
  <span className={`inline-flex items-center gap-1.5 font-medium ${state === 'alert' || state === 'throttled' ? 'text-accent' : state === 'killed' ? 'text-mute' : ''}`}>
    <StateIcon state={state} />{STATE[state].label}
  </span>
);

// ---------- incidents ----------
export const STAGES: IncidentStage[] = ['detected', 'throttled', 'paged', 'owner_ack', 'killed', 'proof', 'resolved'];
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
export function useLiveIncident(): IncidentGroup | null {
  const incidents = useStore((s) => s.incidents);
  const newest = useStore((s) => s.actions[s.actions.length - 1]?.ts ?? 0);
  const g = groupIncidents(incidents)[0];
  if (!g || g.last.stage === 'resolved') return null;
  return newest - g.last.ts > 120000 && newest > 0 ? null : g;
}

// ---------- Verify drawer ----------
export interface VerifySpec { title: string; what: string; field: string; shown: string; kind: 'measured' | 'ASSUMPTION'; command: string; extra?: string }
const Ctx = createContext<(s: VerifySpec | null) => void>(() => undefined);
export const useVerify = () => useContext(Ctx);

export function VerifyProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<VerifySpec | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const impact = useStore((s) => s.impact);
  const close = useCallback(() => { setSpec(null); opener.current?.focus(); }, []);
  const open = useCallback((s: VerifySpec | null) => { opener.current = document.activeElement as HTMLElement; setSpec(s); }, []);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!spec) return;
    box.current?.querySelector<HTMLElement>('button')?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { // keep focus inside the drawer
        const f = box.current!.querySelectorAll<HTMLElement>('button,a,[tabindex]'); const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [spec, close]);
  return (
    <Ctx.Provider value={open}>
      {children}
      {spec && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div ref={box} role="dialog" aria-modal="true" aria-labelledby="vh" className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="vh" className="h-display text-3xl">{spec.title}</h2>
              <button className="btn" onClick={close} aria-label="Close verification">Close</button>
            </div>
            <p className="mt-4">{spec.what}</p>
            <dl className="mt-6 space-y-5 text-[0.95rem]">
              <div><dt className="text-mute">Shown as</dt><dd className="text-xl">{spec.shown}</dd></div>
              <div><dt className="text-mute">Kind</dt><dd>{spec.kind === 'measured' ? <Measured /> : <Assumption />} {spec.kind === 'measured' ? 'Measured in a real run of the simulated fleet.' : 'A typed-in assumption, not a measurement.'}</dd></div>
              <div><dt className="text-mute">Source field in impact.json</dt><dd className="font-mono text-sm break-all">{spec.field}</dd></div>
              <div><dt className="text-mute">Last run</dt><dd>{impact?.generatedAt ? new Date(impact.generatedAt).toLocaleString() : <NotMeasured cmd={spec.command} />}<br /><span className="font-mono text-sm">git {impact?.gitSha ?? 'unknown'}</span></dd></div>
              <div><dt className="text-mute">Reproduce it</dt><dd><code className="block rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm">{spec.command}</code></dd></div>
              {spec.extra && <div><dt className="text-mute">Note</dt><dd>{spec.extra}</dd></div>}
            </dl>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
export function VerifyButton({ spec }: { spec: VerifySpec }) {
  const open = useVerify();
  return <button className="btn !min-h-[36px] !py-1 !text-[0.85rem]" onClick={() => open(spec)} aria-haspopup="dialog">Verify<span className="sr-only"> {spec.title}</span></button>;
}

// ---------- spend line (plain SVG) ----------
export interface Pt { t: number; v: number }
export function Line({ pts, max, maxT, label, dashed, marks = [] }: { pts: Pt[]; max: number; maxT: number; label: string; dashed?: boolean; marks?: { t: number; text: string }[] }) {
  const W = 520, H = 220, L = 46, B = 26, T = 12, R = 12;
  const x = (t: number) => L + (t / (maxT || 1)) * (W - L - R), y = (v: number) => H - B - (v / (max || 1)) * (H - B - T);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 0.5, 1].map((f) => (<g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" /><text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{usd(max * f)}</text></g>))}
      {[0, 0.5, 1].map((f) => <text key={f} x={x(maxT * f)} y={H - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize="11" fill="var(--mute)">{(maxT * f).toFixed(0)} s</text>)}
      {marks.map((m) => (<g key={m.text}><line x1={x(m.t)} x2={x(m.t)} y1={T} y2={H - B} stroke="var(--accent)" strokeDasharray="4 3" /><text x={x(m.t) + 5} y={T + 11} fontSize="11" fill="var(--accent)" fontWeight="600">{m.text}</text></g>))}
      {pts.length > 1 && <path d={d} fill="none" stroke="var(--ink)" strokeWidth={dashed ? 2 : 3} strokeDasharray={dashed ? '6 5' : undefined} strokeLinejoin="round" />}
      {last && <><circle cx={x(last.t)} cy={y(last.v)} r="4.5" fill="var(--ink)" /><text x={Math.min(x(last.t), W - R - 4)} y={y(last.v) < T + 22 ? y(last.v) + 20 : y(last.v) - 9} textAnchor="end" fontSize="13" fontWeight="600" fill="var(--ink)">{usd(last.v)}</text></>}
    </svg>
  );
}
