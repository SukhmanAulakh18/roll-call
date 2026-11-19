import { startControl } from '../services/control/src/app.ts';
import type { ControlHandle, ControlOpts } from '../services/control/src/app.ts';
import { startGateway } from '../services/gateway/src/app.ts';
import type { Gateway } from '../services/gateway/src/app.ts';
import { startFleet } from './fleet.ts';
import type { FleetHandle } from './fleet.ts';
import { startTools } from './tools.ts';
import { runDrill } from './drills.ts';

export interface StackOpts {
  dataDir: string; gateways?: number; fleet?: boolean; tickMs?: number; uiDir?: string;
  ports?: { control?: number; gateway?: number; tools?: number }; host?: string;
  impactFile?: string; replayFile?: string; pollMs?: number;
  control?: Partial<ControlOpts>;    // e.g. ttlMs, staleAfterMs (game days)
  directEnabled?: boolean;           // ungoverned /v1/direct baseline for A/B drills and bench (default true here: this is the simulation harness)
  failover?: boolean;                // fleet gateway failover (default true)
}
export interface Stack {
  control: ControlHandle; gateways: Gateway[]; tools: Awaited<ReturnType<typeof startTools>>; fleet: FleetHandle;
  close(): Promise<void>;
}

/** Everything in-process on ephemeral ports (or fixed ports for serve.ts). Gateway ids are gw-1, gw-2, ... */
export async function startStack(o: StackOpts): Promise<Stack> {
  const tools = await startTools({ port: o.ports?.tools, host: o.host });
  const copts: ControlOpts = { dataDir: o.dataDir, port: o.ports?.control, host: o.host, tickMs: o.tickMs, uiDir: o.uiDir, impactFile: o.impactFile, replayFile: o.replayFile, ...o.control };
  const control = await startControl(copts);
  const gateways: Gateway[] = [];
  for (let i = 1; i <= (o.gateways ?? 1); i++)
    gateways.push(await startGateway({ controlUrl: control.url, toolsUrl: tools.url, gatewayId: `gw-${i}`, dataDir: o.dataDir, port: o.ports?.gateway ? o.ports.gateway + i - 1 : undefined, host: o.host, pollMs: o.pollMs, directEnabled: o.directEnabled ?? true }));
  control.setGateways(gateways.map(g => g.url));
  const fleet = await startFleet({ controlUrl: control.url, gatewayUrls: gateways.map(g => g.url), agents: o.fleet === false ? [] : undefined, failover: o.failover });
  control.setRuntime(fleet);
  const stack: Stack = {
    control, gateways, tools, fleet,
    async close() {
      await fleet.close();
      for (const g of gateways) await g.close();
      await control.close();
      await tools.close();
    },
  };
  control.setDrillRunner((name, mode) => runDrill(stack, name, mode));
  return stack;
}
