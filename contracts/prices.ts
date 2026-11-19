// ASSUMPTIONS, not measurements: USD per call by tool, and LLM token prices. Editable; served to gateways in the bundle
// and copied verbatim into impact.json `assumptions` so the UI can label them.
export const PRICES: Record<string, number> = {
  'ledger.read': 0.0002, 'ledger.post': 0.0005, 'txn.lookup': 0.0003, 'kyc.lookup': 0.0008, 'docs.search': 0.0004,
  'payments.transfer': 0.001, 'fraud.flag': 0.0002, 'agent.call': 0.0001, 'approvals.enqueue': 0.0001,
  'limits.get': 0.0002, 'mail.send': 0.0005,
  'llm.complete': 0.005,        // nominal per call: only used for the pre-call budget estimate
  'llm.in.per1k': 0.003,        // llm.complete is actually priced from recorded token counts x these rates
  'llm.out.per1k': 0.015,
};
export const HIGH_RISK_TOOLS = ['payments.transfer', 'ledger.post', 'mail.send'];

export function costOf(tool: string, prices: Record<string, number>, result?: unknown): number {
  const u = (result as { usage?: { inputTokens?: number; outputTokens?: number } } | undefined)?.usage;
  let c = prices[tool] ?? 0;
  if (tool === 'llm.complete' && u) c = ((u.inputTokens ?? 0) / 1000) * (prices['llm.in.per1k'] ?? 0) + ((u.outputTokens ?? 0) / 1000) * (prices['llm.out.per1k'] ?? 0);
  return Math.round(c * 1e8) / 1e8;
}
