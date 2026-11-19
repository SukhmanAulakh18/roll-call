export type FaultKind = 'runaway-loop' | 'ping-pong' | 'scope-drift' | 'healthy-burst' | 'slow-repeat';
export type DrillMode = 'governed' | 'ungoverned';

/** What control (kill, reset) and drills need from whatever runs the agents. SimProcess runtime today; k8s later. */
export interface FleetControl {
  running(): Promise<string[]>;
  stop(agentId: string): Promise<void>;
  start(agentId: string): Promise<void>;
  inject(agentId: string, kind: FaultKind, mode: DrillMode): Promise<void>;
  clear(agentId?: string): Promise<void>;
  reset(): Promise<void>;              // clear faults, start every agent
}

/** Client for a fleet running in another process (`serve.ts --role fleet`). */
export function httpFleet(base: string): FleetControl {
  const call = async (path: string, body: unknown = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    return r.json() as Promise<any>;
  };
  return {
    running: async () => (await call('/fleet/running')).running,
    stop: async id => { await call('/fleet/stop', { agentId: id }); },
    start: async id => { await call('/fleet/start', { agentId: id }); },
    inject: async (id, kind, mode) => { await call('/fleet/inject', { agentId: id, kind, mode }); },
    clear: async id => { await call('/fleet/clear', { agentId: id }); },
    reset: async () => { await call('/fleet/reset'); },
  };
}
