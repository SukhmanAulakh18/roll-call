import { useEffect } from 'react';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { Activity, Bot, Flame, Gauge, GraduationCap, History, Monitor, Moon, OctagonX, Rocket, Repeat2, ShieldQuestion, Table2, Wallet } from 'lucide-react';
import { resetDrills, runDrill, useStore } from './store';
import { setUi, useUi } from './ui-state';

const go = (h: string) => { location.hash = h; };
export function Palette({ theme, setTheme }: { theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void }) {
  const open = useUi((u) => u.palette);
  const presenter = useUi((u) => u.presenter);
  const agents = useStore((s) => s.agents);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setUi({ palette: !open }); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [open]);
  const run = (f: () => void) => () => { setUi({ palette: false }); setTimeout(f, 30); };
  const drill = (name: string, ab: boolean) => run(() => { go('#/drill'); void resetDrills().then(() => runDrill(name, ab)); });
  return (
    <Dialog.Root open={open} onOpenChange={(o) => setUi({ palette: o })}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="palette" aria-label="Command palette" aria-describedby={undefined}>
          <Dialog.Title className="visually-hidden">Command palette</Dialog.Title>
          <Command label="Command palette" loop>
            <Command.Input placeholder="Jump to an agent, run a drill, switch lens" autoFocus />
            <Command.List>
              <Command.Empty>Nothing matches. Try an agent name, drill, or lens.</Command.Empty>
              <Command.Group heading="Go to">
                <Command.Item onSelect={run(() => go('#/'))}><Activity size={16} aria-hidden />Fleet map</Command.Item>
                <Command.Item onSelect={run(() => go('#/drill'))}><Flame size={16} aria-hidden />Drill theatre</Command.Item>
                <Command.Item onSelect={run(() => go('#/admission'))}><Rocket size={16} aria-hidden />Admission playground</Command.Item>
                <Command.Item onSelect={run(() => go('#/money'))}><Wallet size={16} aria-hidden />Spend and value</Command.Item>
                <Command.Item onSelect={run(() => go('#/engineering'))}><Gauge size={16} aria-hidden />Engineering</Command.Item>
                <Command.Item onSelect={run(() => go('#/registry'))}><Table2 size={16} aria-hidden />Registry</Command.Item>
                <Command.Item onSelect={run(() => go('#/replay'))}><History size={16} aria-hidden />Open replay</Command.Item>
              </Command.Group>
              <Command.Group heading="Run a drill">
                <Command.Item onSelect={drill('runaway-loop', true)}><Flame size={16} aria-hidden />Run runaway loop (A/B)</Command.Item>
                <Command.Item onSelect={drill('ping-pong', false)}><Repeat2 size={16} aria-hidden />Run agent ping-pong</Command.Item>
                <Command.Item onSelect={drill('scope-drift', false)}><ShieldQuestion size={16} aria-hidden />Run scope drift</Command.Item>
              </Command.Group>
              <Command.Group heading="Jump to agent">
                {agents.map((a) => <Command.Item key={a.id} value={`agent ${a.name} ${a.id} ${a.owner.team}`} onSelect={run(() => go(`#/agent/${a.id}`))}><Bot size={16} aria-hidden />{a.name}<span className="cmd-hint">{a.owner.team}</span></Command.Item>)}
              </Command.Group>
              <Command.Group heading="Kill an agent">
                {agents.map((a) => <Command.Item key={a.id} value={`kill stop ${a.name} ${a.id}`} onSelect={run(() => setUi({ killId: a.id }))}><OctagonX size={16} aria-hidden />Stop {a.name}<span className="cmd-hint">asks to confirm</span></Command.Item>)}
              </Command.Group>
              <Command.Group heading="View">
                {(['exec', 'ops', 'eng'] as const).map((l) => <Command.Item key={l} value={`lens ${l}`} onSelect={run(() => { setUi({ lens: l }); try { localStorage.setItem('rc.lens', JSON.stringify(l)); } catch { /* ignore */ } go('#/'); })}><Monitor size={16} aria-hidden />Switch lens to {l === 'exec' ? 'Executive' : l === 'ops' ? 'Operations' : 'Engineering'}</Command.Item>)}
                <Command.Item onSelect={run(() => { setUi({ presenter: !presenter }); try { localStorage.setItem('rc.presenter', JSON.stringify(!presenter)); } catch { /* ignore */ } })}><Monitor size={16} aria-hidden />{presenter ? 'Turn off presenter mode' : 'Turn on presenter mode'}</Command.Item>
                <Command.Item onSelect={run(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}><Moon size={16} aria-hidden />Switch to {theme === 'dark' ? 'light' : 'dark'} theme</Command.Item>
                <Command.Item onSelect={run(() => setUi({ tour: 0 }))}><GraduationCap size={16} aria-hidden />Start the 40-second presenter tour</Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
