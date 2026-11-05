import { produce } from 'immer';
import { create } from 'zustand';
import type { AppData, Entry, ID } from './types';
import { initialData } from './logic/defaults';
import { loadData, saveData } from './logic/db';

export type PageId =
  | 'painel' | 'escola' | 'periodos' | 'turmas' | 'matriz' | 'professores' | 'cargas' | 'atividades'
  | 'disponibilidade' | 'montagem' | 'grade-turma' | 'grade-professor' | 'grade-geral' | 'relatorios'
  | 'configuracoes';

export interface Toast {
  id: number;
  kind: 'ok' | 'erro' | 'aviso';
  text: string;
}

interface State {
  data: AppData;
  loaded: boolean;
  loadError: string | null;
  saveState: 'salvo' | 'salvando' | 'erro';
  savedAt: string | null;
  page: PageId;
  pageParam: string | null;
  toasts: Toast[];
  undo: Record<ID, Entry[][]>;
  redo: Record<ID, Entry[][]>;
  init: () => Promise<void>;
  go: (p: PageId, param?: string | null) => void;
  update: (fn: (d: AppData) => void) => void;
  replaceData: (d: AppData) => void;
  editEntries: (scheduleId: ID, fn: (entries: Entry[]) => Entry[]) => void;
  undoEdit: (scheduleId: ID) => void;
  redoEdit: (scheduleId: ID) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

function scheduleSave(get: () => State, set: (p: Partial<State>) => void) {
  if (saveTimer) clearTimeout(saveTimer);
  set({ saveState: 'salvando' });
  saveTimer = setTimeout(async () => {
    try {
      await saveData(get().data);
      set({ saveState: 'salvo', savedAt: new Date().toISOString() });
    } catch (e) {
      set({ saveState: 'erro' });
      get().toast('Não foi possível salvar no navegador: ' + String(e), 'erro');
    }
  }, 400);
}

const MAX_UNDO = 100;

export const useStore = create<State>((set, get) => ({
  data: initialData(),
  loaded: false,
  loadError: null,
  saveState: 'salvo',
  savedAt: null,
  page: 'painel',
  pageParam: null,
  toasts: [],
  undo: {},
  redo: {},

  init: async () => {
    try {
      const d = await loadData();
      if (d) set({ data: d, loaded: true, savedAt: d.updatedAt });
      else {
        set({ loaded: true });
        await saveData(get().data);
        set({ savedAt: new Date().toISOString() });
      }
    } catch (e) {
      set({ loaded: true, loadError: String(e) });
    }
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch {
      /* navegador não suporta */
    }
  },

  go: (page, param = null) => {
    set({ page, pageParam: param });
    window.scrollTo?.(0, 0);
  },

  update: (fn) => {
    const next = produce(get().data, (d) => {
      fn(d);
      d.updatedAt = new Date().toISOString();
    });
    set({ data: next });
    scheduleSave(get, set);
  },

  replaceData: (d) => {
    set({ data: d, undo: {}, redo: {} });
    scheduleSave(get, set);
  },

  editEntries: (scheduleId, fn) => {
    const sch = get().data.schedules.find((s) => s.id === scheduleId);
    if (!sch) return;
    const prev = sch.entries;
    const next = fn(prev.map((e) => ({ ...e })));
    const undo = { ...get().undo, [scheduleId]: [...(get().undo[scheduleId] ?? []), prev].slice(-MAX_UNDO) };
    set({ undo, redo: { ...get().redo, [scheduleId]: [] } });
    get().update((d) => {
      const s = d.schedules.find((x) => x.id === scheduleId)!;
      s.entries = next;
      s.edited = true;
      s.updatedAt = new Date().toISOString();
    });
  },

  undoEdit: (scheduleId) => {
    const stack = get().undo[scheduleId] ?? [];
    if (!stack.length) return;
    const sch = get().data.schedules.find((s) => s.id === scheduleId);
    if (!sch) return;
    const prev = stack[stack.length - 1];
    set({
      undo: { ...get().undo, [scheduleId]: stack.slice(0, -1) },
      redo: { ...get().redo, [scheduleId]: [...(get().redo[scheduleId] ?? []), sch.entries] },
    });
    get().update((d) => {
      const s = d.schedules.find((x) => x.id === scheduleId)!;
      s.entries = prev;
      s.updatedAt = new Date().toISOString();
    });
  },

  redoEdit: (scheduleId) => {
    const stack = get().redo[scheduleId] ?? [];
    if (!stack.length) return;
    const sch = get().data.schedules.find((s) => s.id === scheduleId);
    if (!sch) return;
    const next = stack[stack.length - 1];
    set({
      redo: { ...get().redo, [scheduleId]: stack.slice(0, -1) },
      undo: { ...get().undo, [scheduleId]: [...(get().undo[scheduleId] ?? []), sch.entries] },
    });
    get().update((d) => {
      const s = d.schedules.find((x) => x.id === scheduleId)!;
      s.entries = next;
      s.edited = true;
      s.updatedAt = new Date().toISOString();
    });
  },

  toast: (text, kind = 'ok') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === 'erro' ? 8000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function useData() {
  return useStore((s) => s.data);
}

export function activeSchedule(d: AppData) {
  return d.schedules.find((s) => s.id === d.activeScheduleId) ?? null;
}
