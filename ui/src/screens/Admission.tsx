import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Box, DoorClosed, DoorOpen, Rocket, ShieldCheck, ShieldX } from 'lucide-react';
import type { AdmissionResult, AgentRecord, WorkloadSpec } from '../../../contracts/types';
import { FIXTURE, registerDraft, reviewAdmission, useStore } from '../store';
import { FixtureChip, VerifyButton, clock } from '../ui';
import { Panel } from '../components';

const LABEL = 'rollcall.dev/agent-id';
const toYaml = (w: WorkloadSpec) => `name: ${w.name}\nnamespace: ${w.namespace}\nlabels:\n${Object.entries(w.labels).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`;

/** A deliberately small YAML subset (name, namespace, labels) or plain JSON. */
export function parseWorkload(text: string): { w?: WorkloadSpec; error?: string } {
  const t = text.trim();
  if (!t) return { error: 'The editor is empty.' };
  try {
    if (t.startsWith('{')) {
      const j = JSON.parse(t);
      const w = j.workload ?? j;
      if (typeof w.name !== 'string') return { error: 'JSON needs a "name" string.' };
      return { w: { name: w.name, namespace: w.namespace ?? 'default', labels: (w.labels ?? {}) as Record<string, string> } };
    }
  } catch (e) { return { error: `Not valid JSON: ${(e as Error).message}` }; }
  const w: WorkloadSpec = { name: '', namespace: 'default', labels: {} };
  let inLabels = false;
  for (const [i, raw] of t.split('\n').entries()) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = raw.match(/^(\s*)([^:]+?):\s*(.*)$/);
    if (!m) return { error: `Line ${i + 1} is not "key: value".` };
    const [, ind, k, v0] = m;
    const v = v0.replace(/^["']|["']$/g, '').trim();
    if (!ind && k === 'labels') { inLabels = true; continue; }
    if (!ind) { inLabels = false; if (k === 'name') w.name = v; else if (k === 'namespace') w.namespace = v; continue; }
    if (inLabels) w.labels[k.trim()] = v;
  }
  if (!w.name) return { error: 'The workload needs a name.' };
  return { w };
}

const REC = (id: string): Partial<AgentRecord> & { id: string } => ({
  id, name: 'Ledger Sweeper', purpose: 'Sweeps stale ledger suspense items.', owner: { name: 'Pat Q. (Finance Operations)', team: 'Finance Operations', escalation: 'pager:finance-operations-oncall (simulated)' },
  developer: 'Platform Engineering', origin: 'internal', riskRating: 'medium', version: '0.1.0', deploymentDate: '2026-06-01', reviewer: 'Model Risk', approver: 'Head of Finance Operations',
  dataSources: ['synthetic-ledger'], approvedUses: ['Sweep suspense items'], limitations: [], scopes: { tools: ['ledger.read'], data: ['synthetic-ledger'] }, models: ['sim-small'], residency: 'ca-central',
  lifecycleState: 'production', evaluation: null, budgets: { perHourUsd: 5, perDayUsd: 40, perTaskUsd: 1 }, reviewDate: '2026-09-01', nextMonitoringDate: '2027-03-01',
  runtimeRef: { kind: 'SimProcess', name: id, namespace: 'agents' },
});
const PRESETS: { key: string; label: string; w: WorkloadSpec; record?: string }[] = [
  { key: 'ok', label: 'Registered agent', w: { name: 'invoice-recon-7f9c', namespace: 'agents', labels: { [LABEL]: 'invoice-recon', 'app.kubernetes.io/part-of': 'finance' } } },
  { key: 'shadow', label: 'Unregistered shadow-bot', w: { name: 'shadow-bot', namespace: 'agents', labels: { 'app.kubernetes.io/part-of': 'unknown' } } },
  { key: 'prod', label: 'Production without evaluation', w: { name: 'ledger-sweeper-prod', namespace: 'agents', labels: { [LABEL]: 'ledger-sweeper', 'rollcall.dev/lifecycle': 'production' } }, record: 'ledger-sweeper' },
];

type Phase = 'idle' | 'reviewing' | 'admitted' | 'rejected';
export function Admission() {
  const agents = useStore((s) => s.agents);
  const feed = useStore((s) => s.admissions);
  const reduce = useReducedMotion();
  const [text, setText] = useState(toYaml(PRESETS[1].w));
  const [preset, setPreset] = useState<string | null>('shadow');
  const [phase, setPhase] = useState<Phase>('idle');
  const [res, setRes] = useState<AdmissionResult | null>(null);
  const [err, setErr] = useState('');
  const parsed = useMemo(() => parseWorkload(text), [text]);
  const idLabel = parsed.w?.labels[LABEL] ?? '';

  const load = (k: string) => { const p = PRESETS.find((x) => x.key === k)!; setText(toYaml(p.w)); setPreset(k); setPhase('idle'); setRes(null); setErr(''); };
  const setLabel = (v: string) => {
    const w = parsed.w; if (!w) return;
    const labels = { ...w.labels }; if (v) labels[LABEL] = v; else delete labels[LABEL];
    setText(toYaml({ ...w, labels })); setPreset(null);
  };
  const deploy = async () => {
    if (!parsed.w) return;
    setPhase('reviewing'); setErr(''); setRes(null);
    try {
      const p = PRESETS.find((x) => x.key === preset);
      let r: AdmissionResult | null = null;
      if (p?.record && idLabel === p.record && !agents.some((a) => a.id === p.record)) {
        const reg = await registerDraft(REC(p.record));
        if (!reg.allowed) r = { ...reg, reason: `The registry refused the record this workload points to. ${reg.reason}` };
      }
      r ??= await reviewAdmission(parsed.w);
      await new Promise((ok) => setTimeout(ok, reduce ? 0 : 650));
      setRes(r); setPhase(r.allowed ? 'admitted' : 'rejected');
    } catch (e) { setErr((e as Error).message); setPhase('idle'); }
  };

  const deployRef = useRef(deploy); deployRef.current = deploy;
  useEffect(() => { const f = () => { load('shadow'); setTimeout(() => void deployRef.current(), 50); }; addEventListener('rc:try-deploy', f); return () => removeEventListener('rc:try-deploy', f); }, []);  
  return (
    <div className="admission">
      <header className="page-h"><div><h1>Admission playground</h1><p className="lead">Nothing runs in the cluster unless it carries a registered agent label. Edit a workload and try to deploy it.</p></div>{FIXTURE && <FixtureChip />}</header>
      <div className="adm-grid">
        <Panel title="Workload" id="wl-h" aside={<div className="seg" role="group" aria-label="Presets">{PRESETS.map((p) => <button key={p.key} aria-pressed={preset === p.key} onClick={() => load(p.key)}>{p.label}</button>)}</div>}>
          <label className="visually-hidden" htmlFor="wl-text">Workload as YAML or JSON</label>
          <div className="editor">
            <pre className="gutter measured" aria-hidden="true">{text.split('\n').map((_, i) => i + 1).join('\n')}</pre>
            <textarea id="wl-text" className="measured" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setPreset(null); }} rows={9} aria-describedby="wl-err" />
          </div>
          <p id="wl-err" className={parsed.error ? 'note-bad' : 'muted'} role={parsed.error ? 'alert' : undefined}>{parsed.error ?? 'YAML (name, namespace, labels) or JSON. The gate reads one label.'}</p>
          <div className="labelrow">
            <label htmlFor="agent-id">Agent id label</label>
            <input id="agent-id" className="field measured" list="agent-ids" value={idLabel} onChange={(e) => setLabel(e.target.value.trim())} placeholder="not set" />
            <datalist id="agent-ids">{agents.map((a) => <option key={a.id} value={a.id} />)}</datalist>
          </div>
          <div className="row-actions">
            <button className="btn btn--primary btn--lg" onClick={deploy} disabled={!parsed.w || phase === 'reviewing'} data-tour="try-deploy"><Rocket size={16} aria-hidden />{phase === 'reviewing' ? 'Reviewing' : 'Try to deploy'}</button>
            <VerifyButton spec={{ title: 'Admission gate', what: 'POST /v1/admission/review reads the rollcall.dev/agent-id label, finds the registry record, and denies if there is no label, no record, no owner, no scopes, the agent is retired, or it is in production or canary without a passing evaluation.', field: 'POST /v1/admission/review {workload}', shown: res ? (res.allowed ? 'admitted' : `rejected (${res.code})`) : 'not tried yet', kind: 'measured', command: 'make admission-demo' }} />
          </div>
          {err && <p className="note-bad" role="alert">Could not reach the gate: {err}</p>}
        </Panel>

        <Panel title="The gate" id="gate-h" className="gate-panel">
          <Gate phase={phase} name={parsed.w?.name ?? 'workload'} reduce={!!reduce} />
          <div aria-live="polite" className="gate-verdict">
            <AnimatePresence mode="wait">
              {res && phase !== 'reviewing' && (
                <motion.div key={res.code + res.reason} className={`verdict-card ${res.allowed ? 'is-ok' : 'is-bad'}`} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                  <h3>{res.allowed ? <ShieldCheck size={20} aria-hidden /> : <ShieldX size={20} aria-hidden />}{res.allowed ? 'Admitted' : 'Rejected'} <span className="measured">{res.code}</span></h3>
                  <p>{res.reason}</p>
                </motion.div>
              )}
            </AnimatePresence>
            {!res && phase === 'idle' && <p className="muted">Press Try to deploy. The answer comes from the same function the cluster webhook uses.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="Recent gate decisions" id="feed-h" aside={<span className="muted">from the stream</span>}>
        {feed.length ? <ul className="feed">{feed.map((a, i) => <li key={i}><span className="measured">{clock(a.ts)}</span> <strong>{a.workload}</strong> {a.allowed ? 'admitted' : 'rejected'} <span className="measured">{a.code}</span> <span className="muted">{a.reason}</span></li>)}</ul> : <p className="empty">No admission decisions on the stream yet. The ones you make here appear here.</p>}
      </Panel>
    </div>
  );
}

function Gate({ phase, name, reduce }: { phase: Phase; name: string; reduce: boolean }) {
  const open = phase === 'admitted';
  const shut = phase === 'rejected';
  const x = phase === 'idle' ? 0 : phase === 'reviewing' ? 118 : open ? 300 : 96;
  return (
    <div className={`gate gate--${phase}`} role="img" aria-label={`Gate: ${phase === 'idle' ? 'waiting' : phase === 'reviewing' ? 'reviewing the workload' : open ? 'workload admitted to the cluster' : 'workload rejected at the gate'}`}>
      <div className="lane"><span className="lane-l">Your workload</span><span className="lane-l lane-r">The cluster</span></div>
      <motion.div className="token" animate={reduce ? { x } : { x, rotate: shut ? [0, -3, 3, -2, 0] : 0 }} transition={{ type: 'spring', stiffness: 160, damping: 20 }}>
        <Box size={16} aria-hidden /><span className="measured">{name}</span>
      </motion.div>
      <div className="gate-door"><motion.span className="door door--t" animate={{ y: open ? -34 : 0 }} transition={{ duration: reduce ? 0 : 0.35 }} /><span className="gate-ic">{open ? <DoorOpen size={22} aria-hidden /> : <DoorClosed size={22} aria-hidden />}</span><motion.span className="door door--b" animate={{ y: open ? 34 : 0 }} transition={{ duration: reduce ? 0 : 0.35 }} /></div>
      {phase === 'reviewing' && <span className="scan" aria-hidden="true" />}
    </div>
  );
}
