import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Receipt } from '../../../contracts/types.ts';
import { canonicalJSON, sha256 } from '../../lib/hash.ts';

const hashOf = (prevHash: string, r: Omit<Receipt, 'hash'>): string => sha256(prevHash + canonicalJSON(r));

/** Hash-chained JSONL, one chain per gateway. Writes are group-committed every `flushMs`; close() flushes. */
export function createReceiptWriter(file: string, gatewayId: string, flushMs = 20) {
  mkdirSync(dirname(file), { recursive: true });
  let seq = 0, prev = 'GENESIS';
  if (existsSync(file)) { // resume an existing chain
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) { const last = JSON.parse(lines[lines.length - 1]) as Receipt; seq = last.seq + 1; prev = last.hash; }
  }
  let buf: string[] = [];
  const flush = () => { if (buf.length) { const s = buf.join(''); buf = []; appendFileSync(file, s); } };
  const timer = setInterval(flush, flushMs); timer.unref();
  return {
    append(f: Pick<Receipt, 'agentId' | 'tool' | 'argsHash' | 'verdict' | 'code' | 'costUsd'>, ts = Date.now()): { seq: number; id: string } {
      const body: Omit<Receipt, 'hash'> = { seq, ts, gatewayId, ...f, prevHash: prev };
      const hash = hashOf(prev, body);
      buf.push(JSON.stringify({ ...body, hash }) + '\n');
      prev = hash;
      return { seq, id: `${gatewayId}:${seq++}` };
    },
    flush,
    close() { clearInterval(timer); flush(); },
  };
}

export function verifyChain(file: string): { ok: boolean; count: number; brokenAt?: number; reason?: string } {
  if (!existsSync(file)) return { ok: false, count: 0, reason: 'file not found' };
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let prev = 'GENESIS';
  for (let i = 0; i < lines.length; i++) {
    let r: Receipt;
    try { r = JSON.parse(lines[i]); } catch { return { ok: false, count: i, brokenAt: i, reason: `record ${i} is not valid JSON` }; }
    const { hash, ...body } = r;
    if (r.seq !== i) return { ok: false, count: i, brokenAt: r.seq, reason: `sequence gap: expected ${i}, found ${r.seq}` };
    if (r.prevHash !== prev) return { ok: false, count: i, brokenAt: r.seq, reason: `record ${r.seq} does not link to the previous record` };
    if (hashOf(prev, body) !== hash) return { ok: false, count: i, brokenAt: r.seq, reason: `record ${r.seq} was modified: its hash does not match its contents` };
    prev = hash;
  }
  return { ok: true, count: lines.length };
}
