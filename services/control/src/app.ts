import http from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { AgentRecord, DrillResult, StreamMessage } from '../../../contracts/types.ts';
import { FLEET } from '../../../sim/fleet.ts';
import { closeServer, createRouter, fail, listen, ok, send } from '../../lib/http.ts';
import type { Out } from '../../lib/http.ts';
import { verifyChain } from '../../gateway/src/receipts.ts';
import { checkRecord, review } from './admission.ts';
import { createEngine } from './engine.ts';
import { issueToken } from './identity.ts';
import { createRegistry } from './registry.ts';
import type { DrillMode, FleetControl } from './runtime.ts';

export interface ControlOpts {
  port?: number; host?: string; dataDir: string; seedFile?: string; clock?: () => number;
  tickMs?: number;                 // incident engine tick (default 250). 0 disables detection (bench)
  ttlMs?: number;                  // identity token TTL (default 60 s)
  ackMs?: number;                  // simulated owner auto-ack (default 1000)
  staleAfterMs?: number;
  gatewayUrls?: string[]; runtime?: FleetControl;
  drillRunner?: (name: string, mode: DrillMode) => Promise<DrillResult>;
  uiDir?: string; impactFile?: string; replayFile?: string;
}
export interface ControlHandle {
  url: string; close(): Promise<void>;
  registry: ReturnType<typeof createRegistry>; engine: ReturnType<typeof createEngine>;
  reset(): Promise<void>;
  setGateways(urls: string[]): void; setRuntime(r: FleetControl): void; setDrillRunner(f: NonNullable<ControlOpts['drillRunner']>): void;
}
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

export async function startControl(opts: ControlOpts): Promise<ControlHandle> {
  const clock = opts.clock ?? Date.now;
  const seed: AgentRecord[] = opts.seedFile ? JSON.parse(readFileSync(opts.seedFile, 'utf8')) : FLEET;
  const registry = createRegistry(opts.dataDir, seed);
  let runtime = opts.runtime, gateways = opts.gatewayUrls ?? [], drillRunner = opts.drillRunner;
  const acks: Record<string, { version: number; ts: number }> = {};
  const tokens = new Map<string, { token: string; expiresAt: number }>();
  const clients = new Set<http.ServerResponse>();
  const ttl = opts.ttlMs ?? 60_000;
  const publish = (m: StreamMessage) => {
    if (!clients.size) return;
    const s = `data: ${JSON.stringify(m)}\n\n`;
    for (const c of clients) if (c.writableLength < 1_000_000) c.write(s);
  };
  const engine = createEngine({
    registry, clock, publish, runtime: () => runtime, gateways: () => gateways, acks: () => acks, lastToken: id => tokens.get(id),
    mintToken: (id, t) => issueToken(id, t, clock()).token, ackMs: opts.ackMs,
  });

  const r = createRouter(CORS);
  r.add('GET', '/healthz', () => ok({ ok: true, bundleVersion: registry.version() }));
  r.add('GET', '/v1/agents', () => ok(registry.list()));
  r.add('GET', '/v1/agents/:id', c => {
    const rec = registry.get(c.params.id); if (!rec) return fail(404, `no agent '${c.params.id}'`);
    return ok({ ...rec, revokedAt: registry.bundle(clock()).revoked[rec.id] ?? null, incidents: engine.openIncidents(rec.id) });
  });
  r.add('POST', '/v1/agents', async c => {
    const rec = await c.json() as AgentRecord;
    if (!rec?.id || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(rec.id)) return fail(422, 'id must be DNS-safe (lowercase letters, digits, dashes)', { code: 'BAD_ID' });
    const v = checkRecord(rec); if (!v.allowed) return { status: 422, body: v };
    registry.upsert(rec); return { status: 201, body: rec };
  });
  r.add('POST', '/v1/identity/token', async c => {
    const { agentId } = await c.json(); const rec = registry.get(agentId);
    if (!rec) return fail(404, `agent '${agentId}' is not registered`, { code: 'UNREGISTERED' });
    if (registry.isRevoked(agentId)) return fail(403, `identity for '${agentId}' has been revoked`, { code: 'REVOKED' });
    if (rec.lifecycleState === 'retired') return fail(403, `agent '${agentId}' is retired`, { code: 'RETIRED' });
    const t = issueToken(agentId, ttl, clock()); tokens.set(agentId, t); return ok(t);
  });
  r.add('GET', '/v1/bundle', c => {
    const gw = c.query.get('gw'), v = Number(c.query.get('v'));
    if (gw && Number.isFinite(v)) acks[gw] = { version: v, ts: clock() };
    return ok(registry.bundle(clock(), opts.staleAfterMs ?? 2000));
  });
  r.add('POST', '/v1/events', async c => { const b = await c.json(); if (!Array.isArray(b.events)) return fail(400, 'events[] required'); engine.ingest(b.events); return ok({ accepted: b.events.length }); });
  r.add('GET', '/v1/stream', async c => {
    c.res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...CORS });
    c.res.write(': roll-call stream\n\n');
    clients.add(c.res); c.res.on('close', () => clients.delete(c.res));
    c.res.write(`data: ${JSON.stringify({ type: 'fleet', data: await engine.summary() })}\n\n`);
    return null;
  });
  r.add('GET', '/v1/incidents', c => ok(engine.incidents(c.query.get('agentId') ?? undefined).slice(-500)));
  r.add('POST', '/v1/agents/:id/kill', async c => {
    if (!registry.get(c.params.id)) return fail(404, `no agent '${c.params.id}'`);
    const b = await c.json().catch(() => ({}));
    return ok(await engine.kill(c.params.id, b?.reason ? String(b.reason) : 'manual kill'));
  });
  r.add('POST', '/v1/admission/review', async c => {
    const { out, workload, result } = review(await c.json(), registry.list());
    publish({ type: 'admission', data: { ...result, workload, ts: clock() } });
    return ok(out);
  });
  let drilling = false;
  r.add('POST', '/v1/drills/:name', async c => {
    if (!drillRunner) return fail(501, 'no drill runner attached to this control plane');
    if (drilling) return fail(409, 'a drill is already running');
    const b = await c.json().catch(() => ({})); drilling = true;
    try { return ok(await drillRunner(c.params.name, b?.mode === 'ungoverned' ? 'ungoverned' : 'governed')); }
    catch (e) { return fail(400, (e as Error).message); } finally { drilling = false; }
  });
  const reset = async () => { registry.reset(); engine.reset(); tokens.clear(); await runtime?.reset(); };
  r.add('POST', '/v1/reset', async () => { await reset(); return ok({ ok: true }); });
  r.add('GET', '/v1/fleet', async () => ok(await engine.summary()));
  r.add('GET', '/v1/pages', () => ok(engine.pages));
  const readJsonFile = (f: string | undefined, what: string): Out => (f && existsSync(f) ? ok(JSON.parse(readFileSync(f, 'utf8'))) : fail(404, `${what} not found; run its make target`));
  r.add('GET', '/v1/impact', () => readJsonFile(opts.impactFile ?? 'impact.json', 'impact.json'));
  r.add('GET', '/v1/replay', () => readJsonFile(opts.replayFile ?? 'replay/events.json', 'replay/events.json'));
  // Static copies for the UI Replay screen; matched before the SPA fallback so they never come back as index.html.
  r.add('GET', '/replay/events.json', () => readJsonFile(opts.replayFile ?? 'replay/events.json', 'replay/events.json'));
  r.add('GET', '/replay/impact.json', () => readJsonFile(opts.impactFile ?? 'impact.json', 'impact.json'));
  r.add('GET', '/v1/receipts/verify', () => {
    const dir = join(opts.dataDir, 'receipts'); const res: Record<string, unknown> = {};
    if (existsSync(dir)) for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl'))) res[f.replace(/\.jsonl$/, '')] = verifyChain(join(dir, f));
    return ok(res);
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (await r.handle(req, res)) return;
    if (opts.uiDir && req.method === 'GET' && !req.url?.startsWith('/v1/')) {
      const p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      let f = join(opts.uiDir, p === '/' ? 'index.html' : p);
      if (!f.startsWith(opts.uiDir) || !existsSync(f) || statSync(f).isDirectory()) f = join(opts.uiDir, 'index.html');
      if (existsSync(f)) { res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); return res.end(readFileSync(f)); }
    }
    send(res, 404, { error: 'not found' }, CORS);
  });
  const url = await listen(server, opts.port ?? 0, opts.host);

  const tickMs = opts.tickMs ?? 250;
  const timers: NodeJS.Timeout[] = [];
  if (tickMs > 0) timers.push(setInterval(() => { try { engine.tick(); } catch (e) { console.error('engine tick failed', e); } }, tickMs));
  timers.push(setInterval(async () => { if (clients.size) publish({ type: 'fleet', data: await engine.summary() }); }, 1000));
  let closed = false;
  return {
    url, registry, engine, reset,
    setGateways: u => { gateways = u; }, setRuntime: f => { runtime = f; }, setDrillRunner: f => { drillRunner = f; },
    async close() {
      if (closed) return; closed = true;
      timers.forEach(clearInterval);
      for (const c of clients) c.end();
      await closeServer(server);
    },
  };
}
