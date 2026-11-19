import http from 'node:http';
import type { AddressInfo } from 'node:net';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface Ctx { req: http.IncomingMessage; res: http.ServerResponse; params: Record<string, string>; query: URLSearchParams; json(): Promise<any> }
export type Out = { status: number; body: unknown } | null; // null = handler wrote the response itself (SSE, static)
export const ok = (body: unknown): Out => ({ status: 200, body });
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Out => ({ status, body: { error, ...extra } });

export function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; version=0.0.4' : 'application/json', ...headers });
  res.end(s);
}

export async function readJson(req: http.IncomingMessage, max = 4_000_000): Promise<any> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new HttpError(413, 'body too large'); chunks.push(c as Buffer); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON'); }
}

type Route = { method: string; re: RegExp; keys: string[]; h: (c: Ctx) => Promise<Out> | Out };
export function createRouter(extraHeaders: Record<string, string> = {}) {
  const routes: Route[] = [];
  return {
    add(method: string, path: string, h: Route['h']) {
      const keys: string[] = [];
      const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
      routes.push({ method, re, keys, h });
    },
    /** returns false when no route matched */
    async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? '/', 'http://x');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname); if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        try {
          const out = await r.h({ req, res, params, query: url.searchParams, json: () => readJson(req) });
          if (out) send(res, out.status, out.body, extraHeaders);
        } catch (e) {
          const status = e instanceof HttpError ? e.status : 500;
          if (!res.headersSent) send(res, status, { error: (e as Error).message }, extraHeaders);
        }
        return true;
      }
      return false;
    },
  };
}

export async function listen(server: http.Server, port = 0, host = '127.0.0.1'): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve()); });
  const a = server.address() as AddressInfo;
  return `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${a.port}`;
}
export function closeServer(server: http.Server): Promise<void> {
  return new Promise(resolve => { if (!server.listening) return resolve(); server.close(() => resolve()); server.closeAllConnections(); });
}
export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
