// FIXTURE DATA: scripted stream messages used only with ?fixture=1. Not real measurements.
import type { ActionEvent, DrillResult, FleetSummary, IncidentEvent, IncidentStage, StreamMessage } from '../../../contracts/types';
import { FIXTURE_AGENTS } from './FIXTURE_agents';

const ids = FIXTURE_AGENTS.map((a) => a.id);
const rates: Record<string, number> = Object.fromEntries(ids.map((id, i) => [id, 0.05 + ((i * 7) % 11) * 0.03]));

export const fixtureFleet = (states: FleetSummary['states'] = {}, boost: Record<string, number> = {}, ts?: number): StreamMessage => ({
  type: 'fleet', ts,
  data: {
    registered: 12, running: 12, unregisteredRunning: 0,
    spendPerMinUsd: Object.fromEntries(ids.map((id) => [id, boost[id] ?? rates[id]])),
    states: Object.fromEntries(ids.map((id) => [id, states[id] ?? 'healthy'])) as FleetSummary['states'],
  },
} as StreamMessage);

const tools = ['ledger.read', 'docs.search', 'kyc.lookup', 'llm.complete'];
/** Quiet baseline traffic so the Spend and Value screens have something to show. */
export function fixtureBaseline(now: number): StreamMessage[] {
  const out: StreamMessage[] = [fixtureFleet()];
  for (let i = 0; i < 120; i++) {
    const a = FIXTURE_AGENTS[i % 12];
    const tool = a.scopes.tools[i % a.scopes.tools.length] ?? tools[0];
    out.push({ type: 'action', data: act(now - (120 - i) * 2000, a.id, tool, 'allow', 'OK', tool === 'llm.complete' ? 0.04 : 0.002, true, i) });
  }
  return out;
}

function act(ts: number, agentId: string, tool: string, verdict: ActionEvent['verdict'], code: string, costUsd: number, governed: boolean, n: number): ActionEvent {
  return { ts, gatewayId: governed ? 'gw-1' : 'direct', receiptId: `${governed ? 'gw-1' : 'direct'}:${1000 + n}`, agentId, tool, argsHash: `fixture${n}`, verdict, code, costUsd, latencyMs: 0.5, governed };
}

const inc = (id: string, agentId: string, stage: IncidentStage, ts: number, message: string, extra: Partial<IncidentEvent> = {}): StreamMessage => ({ type: 'incident', data: { incidentId: id, agentId, stage, ts, message, ...extra } });

/** One scripted drill. Messages carry absolute ts starting at t0; the caller plays them back in real time. */
export function fixtureDrill(name: string, mode: 'governed' | 'ungoverned', t0: number): { msgs: StreamMessage[]; result: DrillResult } {
  const agentId = name === 'ping-pong' ? 'case-router' : name === 'scope-drift' ? 'collections-nudger' : 'fraud-ranker';
  const tool = name === 'scope-drift' ? 'payments.transfer' : name === 'ping-pong' ? 'agent.call' : 'llm.complete';
  const gov = mode === 'governed';
  const msgs: StreamMessage[] = [];
  let spend = 0, calls = 0;
  const end = gov ? 3400 : 6000;
  for (let t = 0; t < end; t += 100) {
    const stopped = gov && t >= 2900;
    const thr = gov && t >= 1400 && !stopped;
    const cost = stopped || thr ? 0 : 0.04;
    spend += cost; calls++;
    msgs.push({ type: 'action', data: act(t0 + t, agentId, tool, stopped ? 'deny' : thr ? 'throttle' : 'allow', stopped ? 'REVOKED' : thr ? 'THROTTLED' : 'OK', cost, gov, 2000 + calls + (gov ? 0 : 500)) });
  }
  const id = `inc-fixture-${name}`;
  if (gov) {
    msgs.push(fixtureFleet({ [agentId]: 'alert' }, { [agentId]: 2.4 }, t0 + 1200), inc(id, agentId, 'detected', t0 + 1200, `${agentId} is calling ${tool} far faster than normal and repeating itself.`, { signals: { rateRatio: 14, repeatCount: 30 } }));
    msgs.push(fixtureFleet({ [agentId]: 'throttled' }, { [agentId]: 0.5 }, t0 + 1400), inc(id, agentId, 'throttled', t0 + 1400, 'Calls slowed to a trickle while a person is paged.'));
    msgs.push(inc(id, agentId, 'paged', t0 + 1900, 'Owner paged.'));
    msgs.push(fixtureFleet({ [agentId]: 'killed' }, { [agentId]: 0 }, t0 + 2900), inc(id, agentId, 'killed', t0 + 2900, 'Identity revoked. The agent can no longer act.'));
    msgs.push(inc(id, agentId, 'proof', t0 + 3300, `Probe tried ${tool} as ${agentId}: denied (REVOKED).`, { proof: { attemptedTool: tool, verdict: 'deny', code: 'REVOKED', receiptId: 'gw-1:123' } }));
  }
  const stages = gov ? { detected: 1200, throttled: 1400, paged: 1900, killed: 2900, proof: 3300 } : {};
  return { msgs, result: { drill: name, mode, agentId, startedAt: t0, durationMs: end, spendUsd: +spend.toFixed(2), calls, stages, timeToContainMs: gov ? 3300 : null, detected: gov, hardContained: gov } };
}
