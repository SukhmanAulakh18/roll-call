import { useSyncExternalStore } from 'react';
import type { ActionEvent } from '../../contracts/types';
import type { VerifySpec } from './ui';

export interface U {
  killId: string | null;
  palette: boolean;
  tour: number | null;
  receipt: ActionEvent | null;
  verify: VerifySpec | null;
  lens: 'exec' | 'ops' | 'eng';
  presenter: boolean;
}
let u: U = { killId: null, palette: false, tour: null, receipt: null, verify: null, lens: 'exec', presenter: false };
const subs = new Set<() => void>();
export const setUi = (p: Partial<U>) => { u = { ...u, ...p }; subs.forEach((f) => f()); };
export const getUi = () => u;
export const useUi = <T,>(sel: (s: U) => T): T => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => sel(u));
