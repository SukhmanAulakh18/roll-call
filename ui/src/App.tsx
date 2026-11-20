import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { Command as CmdIcon, GraduationCap, Moon, Presentation, Sun, Video } from 'lucide-react';
import { FIXTURE, REPLAY_ONLY, start, useStore } from './store';
import { setUi, useUi } from './ui-state';
import { ModeChip, SimChip } from './modes';
import { FixtureChip, TipProvider, VerifySheet, useLocal } from './ui';
import { KillDialog } from './components';
import { GlobalDrawer } from './drawer';
import { Fleet } from './screens/Fleet';
import { Palette } from './palette';
import { Tour } from './tour';
import { useIncidentToasts } from './toasts';

const Drill = lazy(() => import('./screens/Drill').then((m) => ({ default: m.Drill })));
const Admission = lazy(() => import('./screens/Admission').then((m) => ({ default: m.Admission })));
const Money = lazy(() => import('./screens/Money'));
const Engineering = lazy(() => import('./screens/Engineering').then((m) => ({ default: m.Engineering })));
const Registry = lazy(() => import('./screens/Registry').then((m) => ({ default: m.Registry })));
const Story = lazy(() => import('./screens/Story').then((m) => ({ default: m.Story })));
const Business = lazy(() => import('./screens/Business'));
const Replay = lazy(() => import('./screens/Replay').then((m) => ({ default: m.Replay })));

export type Lens = 'exec' | 'ops' | 'eng';
const LENSES: { id: Lens; label: string }[] = [{ id: 'exec', label: 'Executive' }, { id: 'ops', label: 'Operations' }, { id: 'eng', label: 'Engineering' }];
const NAV = { fleet: ['control', 'Control room'], drill: ['drill', 'Drill'], admission: ['admission', 'Admission'], money: ['money', 'Spend and value'], eng: ['engineering', 'Engineering'], registry: ['registry', 'Registry'], replay: ['replay', 'Replay'], biz: ['business', 'Business case'] } as const;
const ORDER: Record<Lens, (keyof typeof NAV)[]> = {
  exec: ['fleet', 'money', 'drill', 'admission', 'registry', 'eng', 'replay', 'biz'],
  ops: ['fleet', 'drill', 'admission', 'registry', 'money', 'eng', 'replay', 'biz'],
  eng: ['fleet', 'eng', 'drill', 'admission', 'registry', 'money', 'replay', 'biz'],
};

const useRoute = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
};

export function App() {
  const [lens, setLens] = useLocal<Lens>('lens', 'exec');
  const [theme, setTheme] = useLocal<'dark' | 'light'>('theme', 'light');
  const [presenter, setPresenter] = useLocal('presenter', false);
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  const isReplay = route[0] === 'replay';
  const source = useStore((s) => s.source);
  const impact = useStore((s) => s.impact);
  const updatedAt = useStore((s) => s.updatedAt);
  const connected = useStore((s) => s.connected);
  useIncidentToasts();

  useEffect(() => { setUi({ lens, presenter }); }, [lens, presenter]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.classList.toggle('presenter', presenter); }, [presenter]);
  useEffect(() => { void start(isReplay ? 'replay' : 'live'); }, [isReplay]);
  useEffect(() => { // lens changes made through the palette arrive via the ui store
    const un = setInterval(() => { /* keep persisted values in sync */ }, 60000); return () => clearInterval(un);
  }, []);
  const uiLens = useUi((u) => u.lens), uiPresenter = useUi((u) => u.presenter);
  useEffect(() => { if (uiLens !== lens) setLens(uiLens); }, [uiLens]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (uiPresenter !== presenter) setPresenter(uiPresenter); }, [uiPresenter]); // eslint-disable-line react-hooks/exhaustive-deps
  const r0 = route[0], r1 = route[1];
  useEffect(() => { main.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [r0]);

  const selected = r0 === 'agent' ? r1 ?? null : null;
  const page = r0 === 'drill' ? <Drill /> : r0 === 'admission' ? <Admission /> : r0 === 'money' || r0 === 'spend' || r0 === 'value' ? <Money tab={r0 === 'money' ? r1 : r0 === 'spend' ? 'spend' : 'value'} />
    : r0 === 'engineering' ? <Engineering /> : r0 === 'registry' ? <Registry /> : r0 === 'business' ? <Business /> : isReplay ? <Replay /> : r0 === 'control' || r0 === 'agent' ? <Fleet selected={selected} /> : <Story />;
  const recorded = REPLAY_ONLY || source === 'recorded';
  const status = source === 'recorded' ? 'Recorded run, looping' : source === 'replay' ? 'Replay, recorded' : source === 'fixture' ? 'Fixture simulator' : connected ? 'Live stream connected' : 'Stream not connected';

  return (
    <TipProvider>
      <a href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus(); }} className="skip">Skip to content</a>
      <header className="topbar">
        <div className="topbar-in">
          <a href="#/" className="brand" aria-label="Roll Call, home"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="9.5" className="brand-ring" /><line x1="12" y1="12" x2="12" y2="3.5" className="brand-beam" /><circle cx="12" cy="12" r="2" className="brand-dot" /></svg>Roll Call</a>
          <nav aria-label="Screens" className="nav">
            {ORDER[lens].map((k) => {
              const [p, label] = NAV[k];
              const cur = p === 'control' ? r0 === 'control' || r0 === 'agent' : r0 === p || (p === 'money' && (r0 === 'spend' || r0 === 'value'));
              return <a key={k} href={`#/${p}`} aria-current={cur ? 'page' : undefined}>{label}</a>;
            })}
            {recorded && <a href="video.html" className="nav-video"><Video size={14} aria-hidden />Demo video</a>}
          </nav>
          <div className="topbar-r">
            {FIXTURE && <FixtureChip />}
            <ModeChip />
            <div className="seg seg--lens" role="radiogroup" aria-label="Lens">
              {LENSES.map((l) => <button key={l.id} role="radio" aria-checked={lens === l.id} onClick={() => { setLens(l.id); location.hash = '#/control'; }}>{l.label}</button>)}
            </div>
            <button className="btn btn--sm" onClick={() => setUi({ palette: true })}><CmdIcon size={14} aria-hidden /><span className="visually-hidden">Search</span><kbd>Ctrl K</kbd></button>
            <button className="btn btn--sm btn--tour" onClick={() => setUi({ tour: 0 })}><GraduationCap size={14} aria-hidden /><span className="hide-s">Tour</span></button>
            <button className="btn btn--sm btn--icon" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}</button>
            <button className="btn btn--sm btn--icon hide-s" aria-label="Presenter mode, larger type" aria-pressed={presenter} onClick={() => setPresenter(!presenter)}><Presentation size={16} aria-hidden /></button>
          </div>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="page">
        <Suspense fallback={<p className="empty" role="status">Loading</p>}>{page}</Suspense>
      </main>
      <footer className="footer">
        <div className="footer-in">
          <p><SimChip /> real controls · every number from the {recorded ? 'recorded run' : 'last test run'} ({source === 'fixture' ? 'FIXTURE, no real run' : impact?.generatedAt ? new Date(impact.generatedAt).toLocaleString() : 'no run yet'}) · not affiliated with any company</p>
          <p className="footer-r"><span className="muted">{status}</span><span className="measured">Updated {updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour12: false }) : 'never'}</span></p>
        </div>
      </footer>
      <VerifySheet /><KillDialog /><GlobalDrawer /><Palette theme={theme} setTheme={setTheme} /><Tour />
      <Toaster position="bottom-right" theme={theme} offset={{ bottom: 56 }} toastOptions={{ classNames: { toast: 'rc-toast' } }} />
    </TipProvider>
  );
}
