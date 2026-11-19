import type { ActionEvent, AgentRecord, IncidentEvent } from '../../contracts/types';
import { groupIncidents, type IncidentGroup } from './ui';

export type GroupBy = 'team' | 'risk';
const RISK_ORDER = ['critical', 'high', 'medium', 'low'];
export const groupKey = (a: AgentRecord, by: GroupBy) => (by === 'team' ? a.owner.team : `${a.riskRating} risk`);

export const AGENT_W = 300, AGENT_H = 122, AGENT_PITCH = 142;
export const TOOL_X = 520, TOOL_W = 230, RIGHT_X = 1070, NODE_PITCH = 42, NODE_H = 34;

export interface Layout {
  agents: { id: string; x: number; y: number; side: 'l' | 'r'; group: string }[];
  tools: { id: string; x: number; y: number }[];
  data: { id: string; x: number; y: number }[];
}

export function sortAgents(agents: AgentRecord[], by: GroupBy): AgentRecord[] {
  const k = (a: AgentRecord) => (by === 'risk' ? RISK_ORDER.indexOf(a.riskRating) : 0);
  return [...agents].sort((a, b) => k(a) - k(b) || groupKey(a, by).localeCompare(groupKey(b, by)) || a.name.localeCompare(b.name));
}

/** Agents in two outer columns, tools then data stacked down the middle. */
export function layout(agents: AgentRecord[], by: GroupBy, extraTools: string[] = []): Layout {
  const sorted = sortAgents(agents, by);
  const half = Math.ceil(sorted.length / 2);
  const tools = [...new Set([...agents.flatMap((a) => a.scopes.tools), ...extraTools])].sort();
  const data = [...new Set(agents.flatMap((a) => a.scopes.data))].sort();
  return {
    agents: sorted.map((a, i) => ({ id: a.id, side: i < half ? 'l' : 'r', x: i < half ? 0 : RIGHT_X, y: (i < half ? i : i - half) * AGENT_PITCH, group: groupKey(a, by) })),
    tools: tools.map((id, i) => ({ id, x: TOOL_X, y: i * NODE_PITCH })),
    data: data.map((id, i) => ({ id, x: TOOL_X, y: tools.length * NODE_PITCH + 22 + i * NODE_PITCH })),
  };
}

export interface LiveStats {
  rate: Map<string, number>;                       // `${agent}>${tool}` -> calls/s over the last 10 s
  drift: Map<string, { count: number; last: number; denied: boolean }>;  // `${agent}>${tool}` for tools outside the agent's scope, last 60 s
  a2a: Map<string, { count: number; last: number }>;  // `${agent}>${peer}` seen in the last 20 s
  perAgent: Map<string, number>;                   // calls/s over the last 10 s
}

export function computeStats(actions: ActionEvent[], agents: AgentRecord[], now: number): LiveStats {
  const rate = new Map<string, number>(), drift = new Map<string, { count: number; last: number; denied: boolean }>(), a2a = new Map<string, { count: number; last: number }>(), perAgent = new Map<string, number>();
  const scope = new Map(agents.map((a) => [a.id, new Set(a.scopes.tools)]));
  // the stream's own clock can lag or lead the browser clock (replay, fixture), so measure against the newest event
  const newest = actions.length ? actions[actions.length - 1].ts : now;
  const ref = Math.abs(newest - now) > 60_000 ? newest : now;
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    if (!a.governed) continue;
    const age = ref - a.ts;
    if (age > 60_000) break;
    const key = `${a.agentId}>${a.tool}`;
    if (age <= 10_000) { rate.set(key, (rate.get(key) ?? 0) + 0.1); perAgent.set(a.agentId, (perAgent.get(a.agentId) ?? 0) + 0.1); }
    const sc = scope.get(a.agentId);
    if (sc && !sc.has(a.tool)) { const d = drift.get(key); drift.set(key, { count: (d?.count ?? 0) + 1, last: Math.max(d?.last ?? 0, a.ts), denied: (d?.denied ?? false) || a.verdict === 'deny' }); }
    if (a.targetAgentId && age <= 20_000) { const k2 = `${a.agentId}>${a.targetAgentId}`; const d = a2a.get(k2); a2a.set(k2, { count: (d?.count ?? 0) + 1, last: Math.max(d?.last ?? 0, a.ts) }); }
  }
  return { rate, drift, a2a, perAgent };
}

/** The incident the room should be looking at: newest unresolved, and recent relative to the newest event. */
export function liveIncident(incidents: IncidentEvent[], newestTs: number): IncidentGroup | null {
  const g = groupIncidents(incidents)[0];
  if (!g || g.last.stage === 'resolved') return null;
  return newestTs - g.last.ts > 120_000 && newestTs > 0 ? null : g;
}
