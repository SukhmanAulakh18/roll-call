import { replayPause, replayPlay, replayRestart, replaySpeed, useStore } from '../store';
import { clock, groupIncidents } from '../ui';
import { FleetMap } from './FleetMap';
import { Heroes, IncidentBanner } from './Home';

export function Replay() {
  const r = useStore((s) => s.replay);
  const impact = useStore((s) => s.impact);
  const incidents = useStore((s) => s.incidents);
  const n = useStore((s) => s.actions.length);
  if (r.status === 'empty') return <section className="panel"><h1 className="h-display text-4xl">No recording yet</h1><p className="mt-2 text-mute">Nothing at <code className="font-mono">/replay/events.json</code>. Record a run with <code className="font-mono text-ink">make replay</code>.</p></section>;
  return (
    <div className="space-y-8">
      <div><h1 className="h-display text-5xl">Replay</h1><p className="mt-1 text-mute">A recorded run played back in your browser. No backend needed; nothing here is live.</p></div>
      <div className="panel flex flex-wrap items-center gap-4">
        {r.status === 'playing' ? <button className="btn" onClick={replayPause}>Pause</button> : <button className="btn btn-accent" onClick={replayPlay} disabled={r.status === 'loading'}>{r.status === 'done' ? 'Play again' : 'Play'}</button>}
        <button className="btn" onClick={replayRestart} disabled={r.status === 'loading'}>Restart</button>
        <label className="flex items-center gap-2">Speed <select className="field" value={r.speed} onChange={(e) => replaySpeed(Number(e.target.value))}>{[1, 4, 16].map((s) => <option key={s} value={s}>{s}×</option>)}</select></label>
        <div className="min-w-[200px] flex-1"><progress className="h-3 w-full" max={1} value={r.pos} aria-label="Replay progress" /></div>
        <span className="text-mute" role="status">{r.status === 'loading' ? 'Loading…' : r.status === 'done' ? 'Finished' : r.status === 'paused' ? 'Paused' : 'Playing'} · {n} actions</span>
      </div>
      <IncidentBanner />
      {impact && <Heroes />}
      <FleetMap />
      <section className="panel" aria-labelledby="rl"><h2 id="rl" className="h-display text-2xl">Incident log</h2>
        {incidents.length ? <ul className="mt-3 space-y-1">{[...incidents].reverse().slice(0, 10).map((e) => <li key={e.incidentId + e.stage}><span className="font-mono text-sm">{clock(e.ts)}</span> · <strong>{e.stage.replace('_', ' ')}</strong> · {e.agentId}: {e.message}</li>)}</ul> : <p className="mt-3 text-mute">No incidents yet in this recording.</p>}
        <p className="sr-only">{groupIncidents(incidents).length} incidents</p>
      </section>
    </div>
  );
}
