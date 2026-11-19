import type { IncidentEvent, StreamMessage } from '../../../contracts/types.ts';

// time-to-contain = first 'detected' event -> 'proof' event of the same incident (includes the simulated owner ack, ADR-006).
const TTC_BUCKETS = [0.5, 1, 2, 5, 10, 15, 20, 30, 45, 60, 120];

export interface MetricsState {
  /** Feed every stream message through this (cheap; ignores everything but incident events). */
  onMessage(m: StreamMessage): void;
  render(s: { registered: number; running: number; unregisteredRunning: number; bundleVersion: number; acks: Record<string, { version: number; ts: number }>; now: number }): string;
}

export function createMetrics(): MetricsState {
  const stages = new Map<string, number>(), started = new Map<string, number>();
  const ttc = new Array(TTC_BUCKETS.length + 1).fill(0); let ttcSum = 0, ttcCount = 0;
  return {
    onMessage(m) {
      if (m.type !== 'incident') return;
      const e = m.data as IncidentEvent;
      stages.set(e.stage, (stages.get(e.stage) ?? 0) + 1);
      if (e.stage === 'detected' && !started.has(e.incidentId)) { started.set(e.incidentId, e.ts); if (started.size > 5000) started.delete(started.keys().next().value!); }
      if (e.stage === 'proof' && started.has(e.incidentId)) {
        const s = (e.ts - started.get(e.incidentId)!) / 1000; started.delete(e.incidentId);
        let i = 0; while (i < TTC_BUCKETS.length && s > TTC_BUCKETS[i]) i++;
        ttc[i]++; ttcSum += s; ttcCount++;
      }
    },
    render(s) {
      const L = ['# TYPE rollcall_control_incident_events_total counter'];
      for (const [k, n] of stages) L.push(`rollcall_control_incident_events_total{stage="${k}"} ${n}`);
      L.push('# TYPE rollcall_control_time_to_contain_seconds histogram');
      let cum = 0; TTC_BUCKETS.forEach((b, i) => { cum += ttc[i]; L.push(`rollcall_control_time_to_contain_seconds_bucket{le="${b}"} ${cum}`); });
      L.push(`rollcall_control_time_to_contain_seconds_bucket{le="+Inf"} ${ttcCount}`, `rollcall_control_time_to_contain_seconds_sum ${ttcSum}`, `rollcall_control_time_to_contain_seconds_count ${ttcCount}`);
      L.push('# TYPE rollcall_control_agents_registered gauge', `rollcall_control_agents_registered ${s.registered}`);
      L.push('# TYPE rollcall_control_agents_running gauge', `rollcall_control_agents_running ${s.running}`);
      L.push('# TYPE rollcall_control_unregistered_running gauge', `rollcall_control_unregistered_running ${s.unregisteredRunning}`);
      L.push('# TYPE rollcall_control_bundle_version gauge', `rollcall_control_bundle_version ${s.bundleVersion}`);
      L.push('# TYPE rollcall_control_gateway_bundle_lag_versions gauge');
      for (const [gw, a] of Object.entries(s.acks)) L.push(`rollcall_control_gateway_bundle_lag_versions{gateway="${gw}"} ${Math.max(0, s.bundleVersion - a.version)}`);
      L.push('# TYPE rollcall_control_gateway_last_poll_age_seconds gauge');
      for (const [gw, a] of Object.entries(s.acks)) L.push(`rollcall_control_gateway_last_poll_age_seconds{gateway="${gw}"} ${(s.now - a.ts) / 1000}`);
      return L.join('\n') + '\n';
    },
  };
}
