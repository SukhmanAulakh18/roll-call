import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useStore } from './store';
import { ownerShort } from './ui';

// toasts for incident stages (global, mounted once in the shell)
export function useIncidentToasts() {
  const incidents = useStore((s) => s.incidents);
  const agents = useStore((s) => s.agents);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seen.current == null) { seen.current = new Set(incidents.map((e) => `${e.incidentId}:${e.stage}`)); return; }
    for (const e of incidents) {
      const k = `${e.incidentId}:${e.stage}`;
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      const a = agents.find((x) => x.id === e.agentId);
      const who = a ? ownerShort(a.owner.name) : 'the owner';
      if (e.stage === 'detected') toast.warning(`${a?.name ?? e.agentId} is off its baseline`, { description: e.message });
      else if (e.stage === 'paged') toast(`Paged owner ${who} (simulated)`, { description: a?.owner.escalation });
      else if (e.stage === 'owner_ack') toast(`${who} acknowledged (simulated)`);
      else if (e.stage === 'proof') toast.success('Proof recorded', { description: e.proof ? `${e.proof.attemptedTool} denied (${e.proof.code}), receipt ${e.proof.receiptId}` : undefined });
    }
  }, [incidents, agents]);
}
