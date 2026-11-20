import { useSyncExternalStore } from 'react';
import type { ActionEvent } from '../../contracts/types';
import type { VerifySpec } from './ui';

export type DView = { k: 'agent'; id: string } | { k: 'receipt'; a: ActionEvent };

export interface U {
  killId: string | null;
  palette: boolean;
  tour: number | null;
  drawer: DView | null;
  trail: DView[];
  opener: HTMLElement | null;
  verify: VerifySpec | null;
  lens: 'exec' | 'ops' | 'eng';
  presenter: boolean;
  agentTab: 'now' | 'touch' | 'record' | 'lifecycle';   // which tab the agent panel opens on
}
let u: U = { killId: null, palette: false, tour: null, drawer: null, trail: [], opener: null, verify: null, lens: 'exec', presenter: false, agentTab: 'now' };
const subs = new Set<() => void>();
export const setUi = (p: Partial<U>) => { u = { ...u, ...p }; subs.forEach((f) => f()); };
export const getUi = () => u;
export const useUi = <T,>(sel: (s: U) => T): T => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => sel(u));

/** The one shared drawer. push keeps a Back trail, replace swaps the view in place, reset starts a fresh trail. */
export const openDrawer = (v: DView, mode: 'push' | 'replace' | 'reset' = 'push') => {
  const cur = u.drawer;
  setUi({ drawer: v, trail: mode === 'push' && cur ? [...u.trail, cur] : mode === 'replace' ? u.trail : [], opener: cur ? u.opener : (document.activeElement as HTMLElement | null) });
};
export const openReceipt = (a: ActionEvent, mode: 'push' | 'replace' = 'push') => openDrawer({ k: 'receipt', a }, mode);
export const openAgent = (id: string, mode: 'push' | 'reset' = 'push') => openDrawer({ k: 'agent', id }, mode);
export const closeDrawer = () => {
  const o = u.opener;
  setUi({ drawer: null, trail: [], opener: null });
  requestAnimationFrame(() => { if (o?.isConnected) o.focus(); });
};
export const backDrawer = () => { const t = u.trail; if (!t.length) return closeDrawer(); setUi({ drawer: t[t.length - 1], trail: t.slice(0, -1) }); };
