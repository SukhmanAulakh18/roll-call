import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRecord, PolicyBundle } from '../../../contracts/types.ts';
import { HIGH_RISK_TOOLS, PRICES } from '../../../contracts/prices.ts';

export type Throttle = { ratePerSec: number; hard: boolean; reason: string };

/** Small on purpose: a Postgres adapter only has to implement this. */
export interface Registry {
  version(): number;
  list(): AgentRecord[];
  get(id: string): AgentRecord | undefined;
  upsert(r: AgentRecord): void;
  revoke(id: string, ts: number): void;
  isRevoked(id: string): boolean;
  setThrottle(id: string, t: Throttle): void;
  clearThrottle(id: string): void;
  getThrottle(id: string): Throttle | undefined;
  reset(): void;                       // restore seed records, clear revocations + throttles
  bundle(now: number, staleAfterMs?: number): PolicyBundle;
}

export function createRegistry(dataDir: string, seed: AgentRecord[]): Registry {
  const file = join(dataDir, 'registry.json');
  mkdirSync(dataDir, { recursive: true });
  let records = new Map<string, AgentRecord>();
  let revoked: Record<string, number> = {};
  const throttles = new Map<string, Throttle>();
  let version = 1;
  const persist = () => writeFileSync(file, JSON.stringify({ records: [...records.values()], revoked }, null, 1));
  const load = (list: AgentRecord[]) => { records = new Map(list.map(r => [r.id, structuredClone(r)])); };
  if (existsSync(file)) {
    try { const s = JSON.parse(readFileSync(file, 'utf8')); load(s.records); revoked = s.revoked ?? {}; } catch { load(seed); }
  } else load(seed);
  persist();
  const bump = () => { version++; persist(); };
  return {
    version: () => version,
    list: () => [...records.values()],
    get: id => records.get(id),
    upsert(r) { records.set(r.id, r); bump(); },
    revoke(id, ts) { revoked[id] = ts; bump(); },
    isRevoked: id => id in revoked,
    setThrottle(id, t) { throttles.set(id, t); version++; },
    clearThrottle(id) { if (throttles.delete(id)) version++; },
    getThrottle: id => throttles.get(id),
    reset() { load(seed); revoked = {}; throttles.clear(); bump(); },
    bundle(now, staleAfterMs = 2000) {
      const agents: PolicyBundle['agents'] = {};
      for (const r of records.values()) agents[r.id] = { id: r.id, riskRating: r.riskRating, lifecycleState: r.lifecycleState, scopes: r.scopes, models: r.models, budgets: r.budgets };
      return { version, issuedAt: now, agents, revoked: { ...revoked }, throttles: Object.fromEntries(throttles), highRiskTools: HIGH_RISK_TOOLS, prices: PRICES, staleAfterMs };
    },
  };
}
