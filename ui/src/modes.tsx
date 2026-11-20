import { Activity, Boxes, Calculator, History, Ruler, TriangleAlert } from 'lucide-react';
import { REPLAY_ONLY, useStore } from './store';

/** What the page is showing, in one word. A recording is never called live. */
export function ModeChip() {
  const source = useStore((s) => s.source);
  const connected = useStore((s) => s.connected);
  if (source === 'fixture') return <span className="chip chip--fixture mode" role="status"><TriangleAlert size={14} aria-hidden />FIXTURE DATA</span>;
  if (REPLAY_ONLY || source === 'recorded' || source === 'replay') return <span className="chip chip--rec mode" role="status" title="A recording of a run, played back. No backend is connected."><History size={14} aria-hidden />RECORDED REPLAY</span>;
  return connected
    ? <span className="chip chip--live mode" role="status"><Activity size={14} aria-hidden />LIVE</span>
    : <span className="chip mode" role="status"><TriangleAlert size={14} aria-hidden />NOT CONNECTED</span>;
}
export const SimChip = () => <span className="chip chip--sim mode" title="The agents are simulated. The controls that watch them are real."><Boxes size={14} aria-hidden />SIMULATED FLEET</span>;
/** MEASURED = computed from a test run. MODELED = a projection from typed-in assumptions. */
export const KindChip = ({ kind }: { kind: 'measured' | 'modeled' }) => kind === 'measured'
  ? <span className="chip chip--cool mode"><Ruler size={14} aria-hidden />MEASURED</span>
  : <span className="chip chip--assume mode"><Calculator size={14} aria-hidden />MODELED</span>;

const num = (o: any, keys: string[]): number | undefined => { for (const k of keys) if (typeof o?.[k] === 'number' && Number.isFinite(o[k])) return o[k]; };
const str = (o: any, keys: string[]): string | undefined => { for (const k of keys) if (typeof o?.[k] === 'string' && o[k]) return o[k]; };

export interface IncidentFacts { label: string; agent: string; kind: 'external' | 'drill'; flagged?: number; allowedBeforeStop?: number; deniedAfter?: number; stopMs?: number; source: string }
/** The one incident the story and executive lens describe. Prefers the external Refund Processing Agent run; falls back to the runaway-loop drill. Never invents numbers. */
export function useIncident(): IncidentFacts | null {
  const impact = useStore((s) => s.impact);
  const x = impact?.external, d = impact?.drill;
  if (x && typeof x === 'object') {
    const stopMs = num(x, ['timeToContainMs', 'timeToStopMs', 'containMs']) ?? num(x.timeline, ['toProofMs', 'toKilledMs']) ?? num(x?.timeToContainMs, ['p95', 'p50']);
    return { label: str(x, ['agentName', 'name', 'agent']) ?? 'Refund Processing Agent', agent: str(x, ['agentId', 'id']) ?? 'refund-processing-agent', kind: 'external',
      flagged: num(x.loop, ['calls']) ?? num(x, ['requestsBeforeStop']), allowedBeforeStop: num(x, ['allowedBeforeStop', 'callsBeforeStop', 'requestsBeforeStop']),
      deniedAfter: num(x, ['deniedAfterStop', 'deniedAfter', 'denied', 'blockedAfterStop']), stopMs, source: 'external' };
  }
  if (d && typeof d === 'object') {
    const g = d.callsMean?.governed, u = d.callsMean?.ungoverned;
    return { label: 'Runaway-loop drill', agent: d.agentId ?? 'an agent', kind: 'drill', flagged: undefined, allowedBeforeStop: typeof g === 'number' ? Math.round(g) : undefined,
      deniedAfter: typeof g === 'number' && typeof u === 'number' ? Math.round(u - g) : undefined, stopMs: d.timeToContainMs?.p95, source: 'drill' };
  }
  return null;
}
export { num as pickNum, str as pickStr };
