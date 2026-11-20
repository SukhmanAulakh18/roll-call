import type { ActionEvent, AgentRecord, IncidentEvent } from '../../contracts/types';
import { groupIncidents } from './ui';

/** One table: tool id -> short past-tense phrase (calls list) and a plain-English description (tool panel). */
export const TOOLS: Record<string, { verb: string; what: string }> = {
  'ledger.read': { verb: 'read the ledger', what: 'Reads entries from the company ledger. Look, no change.' },
  'ledger.post': { verb: 'posted an entry to the ledger', what: 'Writes a new entry to the ledger. A change to the books, so it is a higher-risk tool.' },
  'llm.complete': { verb: 'asked an AI model to write', what: 'Sends text to an approved AI model and gets text back. This is where most spend comes from.' },
  'docs.search': { verb: 'searched internal documents', what: 'Searches the company document library. Read only.' },
  'kyc.lookup': { verb: "looked up a customer's KYC file", what: "Fetches a customer's know-your-customer identity file. Read only, but the data is sensitive." },
  'txn.lookup': { verb: 'looked up a transaction', what: 'Fetches one card or account transaction. Read only.' },
  'fraud.flag': { verb: 'flagged a transaction as suspicious', what: 'Marks a transaction for a fraud analyst to review.' },
  'limits.get': { verb: "checked a customer's limits", what: 'Reads the credit or payment limits set for a customer. Read only.' },
  'approvals.enqueue': { verb: 'queued an item for human approval', what: 'Puts a decision in front of a person instead of acting alone.' },
  'agent.call': { verb: 'asked another agent for help', what: 'One agent hands work to another. Roll Call watches these for loops.' },
  'payments.transfer': { verb: 'moved money', what: 'Starts a payment transfer. The highest-risk tool in the fleet.' },
  'mail.send': { verb: 'sent an email', what: 'Sends an email on the company name. Cannot be taken back.' },
};
export const toolVerb = (t: string) => TOOLS[t]?.verb ?? `called ${t}`;
export const toolWhat = (t: string) => TOOLS[t]?.what ?? 'A tool this agent can call through the gateway. No plain-English description on file yet.';
export const dataWhat = (d: string) => `Stand-in ${d.replace(/^synthetic-/, '').replace(/-/g, ' ')} records. Synthetic: no real customer data. Roll Call shows who may read it; individual reads are not on the stream.`;

export const CODES: Record<string, string> = {
  OK: 'within scope and budget',
  OUT_OF_SCOPE: 'tool is outside what this agent is approved to use',
  SCOPE: 'tool is outside what this agent is approved to use',
  BUDGET_EXCEEDED: 'spend limit reached',
  THROTTLED: 'calling too fast, so it was slowed down',
  REVOKED: 'agent was stopped and its identity revoked',
  UNREGISTERED: 'no record of this agent in the registry',
  IDENTITY_MISMATCH: 'the identity did not match the agent',
  UNAUTHENTICATED: 'no valid identity was shown',
  MODEL_NOT_ALLOWED: 'AI model is not approved for this agent',
  NOT_ACTIVE: 'agent is not in a live lifecycle stage',
  NO_POLICY: 'no policy was loaded yet',
  SHADOW_HIGH_RISK: 'a shadow-mode agent tried a high-risk action',
  STALE_POLICY_HIGH_RISK: 'policy copy too old for a high-risk action',
  TOOL_ERROR: 'the tool itself failed',
  RETIRED: 'agent is retired',
};
export const codeWords = (c: string) => CODES[c] ?? c.toLowerCase().replace(/_/g, ' ');
export const VERDICT_WORD = { allow: 'Allowed', deny: 'Denied', throttle: 'Slowed' } as const;

/** "Right now" in plain words, from the agent's state and its latest incident / calls. */
export function rightNow(a: AgentRecord, state: string, incidents: IncidentEvent[], actions: ActionEvent[]): string {
  const g = groupIncidents(incidents.filter((e) => e.agentId === a.id))[0];
  const proof = g?.byStage.proof?.proof;
  if (state === 'killed') return `Stopped${g ? `: ${lower(g.byStage.detected?.message ?? g.last.message)}` : ''}${proof ? `; probe ${proof.verdict === 'deny' ? 'denied' : proof.verdict}, receipt ${proof.receiptId}` : g ? '' : '. Its identity is revoked, so every call is refused.'}`;
  if (state === 'throttled') return `Slowed: ${lower(g?.last.message ?? 'calling too fast, so the gateway is limiting it')}`;
  if (state === 'alert') return `Needs attention: ${lower(g?.last.message ?? 'the detector flagged unusual behaviour')}`;
  if (state === 'healthy') { const n = actions.filter((x) => x.agentId === a.id && x.governed).length; return n ? 'Working normally, inside its scope and budget.' : 'Healthy. No calls seen in this window yet.'; }
  return 'State not reported yet.';
}
const lower = (s?: string) => (s ? s.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, '') : 'details not recorded');
