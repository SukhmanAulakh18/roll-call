// node scripts/serve.ts [--ui <dir>] [--role control|gateway|tools|fleet] [--keep-state]
// No role: whole stack in-process on fixed ports (control 7100, gateway 7200, tools 7300). Roles read CONTROL_URL, TOOLS_URL,
// GATEWAY_URL(S), FLEET_URL, DATA_DIR, GATEWAY_ID, PORT and bind 0.0.0.0 for docker compose.
import { resolve } from 'node:path';
import { startControl } from '../services/control/src/app.ts';
import { httpFleet } from '../services/control/src/runtime.ts';
import { startGateway } from '../services/gateway/src/app.ts';
import { runDrill } from '../sim/drills.ts';
import { serveFleet, startFleet } from '../sim/fleet.ts';
import { startStack } from '../sim/stack.ts';
import { startTools } from '../sim/tools.ts';

const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const role = flag('role'), ui = flag('ui') ? resolve(flag('ui')!) : undefined;
const env = process.env, dataDir = env.DATA_DIR ?? 'data', port = (d: number) => Number(env.PORT ?? d), host = '0.0.0.0';
const stoppers: (() => Promise<void>)[] = [];
const keepState = process.argv.includes('--keep-state'); // default: every boot starts from the seeded, healthy fleet (no revocations carried over in data/registry.json)
let url = '';

if (!role) {
  const s = await startStack({ dataDir, ports: { control: port(7100), gateway: 7200, tools: 7300 }, host: env.HOST, uiDir: ui, // PORT/HOST let a cloud host (e.g. Render) route to control+UI
    tickMs: env.RC_TICK_MS ? Number(env.RC_TICK_MS) : undefined }); // RC_TICK_MS=0 disables detection (k6 lab)
  if (!keepState) s.control.registry.reset();
  stoppers.push(s.close); url = s.control.url;
  console.log(`Roll Call stack up: control ${s.control.url}  gateway ${s.gateways[0].url}  tools ${s.tools.url}  fleet ${(await s.fleet.running()).length} agents${ui ? `  UI at ${s.control.url}/` : ''}`);
} else if (role === 'tools') {
  const t = await startTools({ port: port(7300), host }); stoppers.push(t.close); console.log('tools', t.url);
} else if (role === 'control') {
  const fleetUrl = env.FLEET_URL;
  const c = await startControl({ dataDir, port: port(7100), host, uiDir: ui, gatewayUrls: (env.GATEWAY_URLS ?? env.GATEWAY_URL ?? '').split(',').filter(Boolean), runtime: fleetUrl ? httpFleet(fleetUrl) : undefined });
  if (fleetUrl) c.setDrillRunner((name, mode) => runDrill({ control: c, fleet: httpFleet(fleetUrl) }, name, mode));
  if (!keepState) c.registry.reset();
  stoppers.push(c.close); console.log('control', c.url);
} else if (role === 'gateway') {
  const g = await startGateway({ controlUrl: env.CONTROL_URL ?? 'http://127.0.0.1:7100', toolsUrl: env.TOOLS_URL ?? 'http://127.0.0.1:7300', gatewayId: env.GATEWAY_ID ?? 'gw-1', dataDir, port: port(7200), host });
  stoppers.push(g.close); console.log('gateway', g.url);
} else if (role === 'fleet') {
  const f = await startFleet({ controlUrl: env.CONTROL_URL ?? 'http://127.0.0.1:7100', gatewayUrls: (env.GATEWAY_URLS ?? env.GATEWAY_URL ?? 'http://127.0.0.1:7200').split(',') });
  const srv = await serveFleet(f, Number(env.FLEET_PORT ?? 7400), host);
  stoppers.push(f.close, srv.close); console.log('fleet', srv.url, `${(await f.running()).length} agents`);
} else { console.error(`unknown role '${role}'`); process.exit(2); }

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { for (const s of stoppers) await s().catch(() => {}); process.exit(0); });
void url;
