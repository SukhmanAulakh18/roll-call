import type { StreamMessage } from '../../contracts/types.ts';
/** Records the control SSE stream with arrival timestamps (for replay/*.json). Returns a stop function. */
export async function record(url: string, sink: (StreamMessage & { ts: number })[]): Promise<() => void> {
  const ac = new AbortController();
  const res = await fetch(`${url}/v1/stream`, { signal: ac.signal });
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    try { for await (const chunk of res.body!) { buf += dec.decode(chunk as Uint8Array, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); if (f.startsWith('data: ')) sink.push({ ...(JSON.parse(f.slice(6)) as StreamMessage), ts: Date.now() }); } } } catch { /* aborted */ }
  })();
  return () => ac.abort();
}
