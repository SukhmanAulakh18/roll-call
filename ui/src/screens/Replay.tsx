import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, SkipBack } from 'lucide-react';
import { FIXTURE, replayPause, replayPlay, replayRestart, replaySeek, replaySpeed, useStore } from '../store';
import { FixtureChip, Initials, StateMark, clock, ownerShort, type AgentState } from '../ui';
import { Panel } from '../components';
import { FleetMap } from './FleetMap';
import { Ticker } from './Fleet';

const useWide = () => {
  const [w, setW] = useState(() => matchMedia('(min-width: 1000px)').matches);
  useEffect(() => { const m = matchMedia('(min-width: 1000px)'); const f = () => setW(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return w;
};
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function Replay() {
  const r = useStore((s) => s.replay);
  const incidents = useStore((s) => s.incidents);
  const agents = useStore((s) => s.agents);
  const states = useStore((s) => s.fleet?.states);
  const n = useStore((s) => s.actions.length);
  const wide = useWide();
  if (r.status === 'empty') return <section className="panel"><h1>No recording yet</h1><p className="muted">Nothing at <code className="measured">/replay/events.json</code>. Record a run with <code className="measured">make replay</code>.</p></section>;
  const pct = Math.round(r.pos * 100);
  const label = r.status === 'loading' ? 'Loading' : r.status === 'done' ? 'Finished' : r.status === 'paused' ? 'Paused' : 'Playing';
  return (
    <div className="replay">
      <header className="page-h"><div><h1>Replay</h1><p className="lead">A recorded run played back in your browser. No backend needed. Nothing here is live: it is a recording.</p></div>{FIXTURE && <FixtureChip />}</header>
      <section className="transport" aria-label="Replay controls">
        <div className="transport-row">
          {r.status === 'playing' ? <button className="btn btn--primary btn--lg" onClick={replayPause}><Pause size={18} aria-hidden />Pause</button> : <button className="btn btn--primary btn--lg" onClick={r.status === 'done' ? replayRestart : replayPlay} disabled={r.status === 'loading'}>{r.status === 'done' ? <RotateCcw size={18} aria-hidden /> : <Play size={18} aria-hidden />}{r.status === 'done' ? 'Play again' : 'Play'}</button>}
          <button className="btn btn--lg btn--icon" onClick={() => replaySeek(0)} aria-label="Back to start" disabled={r.status === 'loading'}><SkipBack size={18} aria-hidden /></button>
          <div className="seg" role="group" aria-label="Playback speed">{[1, 4, 16].map((s) => <button key={s} aria-pressed={r.speed === s} onClick={() => replaySpeed(s)}>{s}x</button>)}</div>
          <span className="measured transport-t" role="status">{label}, {fmt(r.pos * r.spanMs)} of {fmt(r.spanMs)}, {n} actions</span>
        </div>
        <div className="scrub">
          <input type="range" min={0} max={1000} value={Math.round(r.pos * 1000)} onChange={(e) => replaySeek(Number(e.target.value) / 1000)} aria-label="Scrub the recording" aria-valuetext={`${pct} percent, ${fmt(r.pos * r.spanMs)}`} style={{ ['--p' as string]: `${r.pos * 100}%` }} />
          <div className="scrub-marks" aria-hidden="true">{r.marks.map((m, i) => <i key={i} className={`mk mk-${m.stage}`} style={{ left: `${m.pos * 100}%` }} title={`${m.stage} ${m.agentId}`} />)}</div>
        </div>
        <p className="muted scrub-legend">Ticks on the track are incident stages: detect, throttle, page, kill, proof.</p>
      </section>

      {wide ? <Panel title="Fleet at this moment" id="rm-h"><div className="map-frame"><FleetMap selected={null} onSelect={() => undefined} /></div></Panel> : (
        <Panel title="Fleet at this moment" id="rg-h">
          <ul className="agrid">{agents.map((a) => <li key={a.id}><span className="agrid-n"><Initials name={a.owner.name} size={22} />{a.name}</span><StateMark state={(states?.[a.id] ?? 'unknown') as AgentState} /></li>)}</ul>
        </Panel>
      )}

      <Panel title="Incident log" id="il-h">
        {incidents.length ? <ol className="ilog">{[...incidents].reverse().slice(0, 12).map((e) => <li key={e.incidentId + e.stage}><span className="measured">{clock(e.ts)}</span><strong>{e.stage.replace('_', ' ')}</strong><span>{agents.find((a) => a.id === e.agentId)?.name ?? e.agentId}</span><span className="muted">{e.message}{e.proof ? ` Probe: ${e.proof.verdict} ${e.proof.code}, receipt ${e.proof.receiptId}.` : ''}</span></li>)}</ol> : <p className="empty">No incidents yet at this point in the recording.</p>}
        <p className="visually-hidden">Owners: {agents.map((a) => ownerShort(a.owner.name)).join(', ')}</p>
      </Panel>
      <Ticker className="ticker--wide" />
    </div>
  );
}
