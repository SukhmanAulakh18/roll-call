import { useEffect, useRef, useState } from 'react';
import { FIXTURE, start, useStore } from './store';
import { VerifyProvider, useLocal } from './ui';
import { Home } from './screens/Home';
import { AgentCard } from './screens/AgentCard';
import { Registry } from './screens/Registry';
import { Drill } from './screens/Drill';
import { Spend } from './screens/Spend';
import { Value } from './screens/Value';
import { Engineering } from './screens/Engineering';
import { Replay } from './screens/Replay';

export type Lens = 'exec' | 'ops' | 'eng';
const LENSES: { id: Lens; label: string }[] = [{ id: 'exec', label: 'Executive' }, { id: 'ops', label: 'Operations' }, { id: 'eng', label: 'Engineering' }];
const NAV = { fleet: ['', 'Fleet'], drill: ['drill', 'Drill'], registry: ['registry', 'Registry'], spend: ['spend', 'Spend'], value: ['value', 'Value'], eng: ['engineering', 'Engineering'], replay: ['replay', 'Replay'] } as const;
const ORDER: Record<Lens, (keyof typeof NAV)[]> = {
  exec: ['fleet', 'spend', 'value', 'drill', 'registry', 'eng', 'replay'],
  ops: ['fleet', 'drill', 'registry', 'spend', 'value', 'eng', 'replay'],
  eng: ['fleet', 'eng', 'drill', 'registry', 'spend', 'value', 'replay'],
};

const useRoute = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
};
export const href = (p: string) => `#/${p}`;

export function App() {
  const [lens, setLens] = useLocal<Lens>('lens', 'exec');
  const [theme, setTheme] = useLocal<'dark' | 'light'>('theme', 'dark');
  const [presenter, setPresenter] = useLocal('presenter', false);
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  const isReplay = route[0] === 'replay';
  const source = useStore((s) => s.source);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.classList.toggle('presenter', presenter); }, [presenter]);
  useEffect(() => { void start(isReplay ? 'replay' : 'live'); }, [isReplay]);
  const r0 = route[0], r1 = route[1];
  useEffect(() => { main.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [r0, r1]);

  const impact = useStore((s) => s.impact);
  const updatedAt = useStore((s) => s.updatedAt);
  const connected = useStore((s) => s.connected);
  const page = route[0] === 'agent' ? <AgentCard id={route[1]} /> : route[0] === 'registry' ? <Registry />
    : route[0] === 'drill' ? <Drill /> : route[0] === 'spend' ? <Spend /> : route[0] === 'value' ? <Value />
    : route[0] === 'engineering' ? <Engineering /> : isReplay ? <Replay /> : <Home lens={lens} />;

  return (
    <VerifyProvider>
      <a href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2">Skip to content</a>
      <header className="mx-auto max-w-[1280px] px-8 pt-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <a href={href('')} className="h-display text-5xl no-underline">Roll Call</a>
            <p className="mt-1 text-lg text-mute">Watches your AI workers, and can stop one that goes wrong.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {FIXTURE && <span className="chip !border-solid !border-ink !font-bold !text-ink" role="status">FIXTURE DATA</span>}
            <span className="chip" role="status">{source === 'replay' ? 'Replay' : source === 'fixture' ? 'Fixture feed' : connected ? 'Live stream connected' : 'Stream not connected'}</span>
            <div role="radiogroup" aria-label="Lens" className="inline-flex overflow-hidden rounded-md border border-line">
              {LENSES.map((l) => (
                <button key={l.id} role="radio" aria-checked={lens === l.id} onClick={() => { setLens(l.id); location.hash = '#/'; }}
                  className={`min-h-[44px] px-4 text-[0.95rem] ${lens === l.id ? 'bg-ink font-semibold text-bg' : 'bg-surface hover:bg-raised'}`}>{l.label}</button>
              ))}
            </div>
            <button className="btn" aria-pressed={theme === 'light'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
            <button className="btn" aria-pressed={presenter} onClick={() => setPresenter(!presenter)}>Presenter mode</button>
          </div>
        </div>
        <nav aria-label="Screens" className="mt-6 flex flex-wrap gap-x-7 gap-y-1 border-b border-line">
          {ORDER[lens].map((k) => {
            const [p, label] = NAV[k];
            const cur = (route[0] ?? '') === p;
            return <a key={k} href={href(p)} aria-current={cur ? 'page' : undefined} className={`-mb-px inline-flex min-h-[44px] items-center border-b-2 px-0.5 no-underline ${cur ? 'border-ink font-semibold' : 'border-transparent text-mute hover:text-ink'}`}>{label}</a>;
          })}
        </nav>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="mx-auto max-w-[1280px] px-8 py-10 outline-none">{page}</main>
      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-8 py-3 text-[0.85rem] text-mute">
          <p>Simulated fleet · real controls · every number from the last run ({impact?.generatedAt ? new Date(impact.generatedAt).toLocaleString() : 'no run yet'}) · not affiliated with any bank</p>
          <p>Last updated {updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour12: false }) : 'never'}</p>
        </div>
      </footer>
    </VerifyProvider>
  );
}
