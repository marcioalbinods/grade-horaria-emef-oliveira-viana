// Armazenamento local no IndexedDB do navegador (sem servidor, sem serviços pagos).
import type { AppData } from '../types';
import { defaultJeifGroups, initialData, newAvailability, newWorkload } from './defaults';

const DB_NAME = 'grade-horaria-emef-oliveira-viana';
const STORE = 'kv';
const KEY = 'appdata';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadData(): Promise<AppData | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ? normalizeData(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveData(data: AppData): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (value === null) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearData(): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function withDefaults<T>(defaults: Partial<T>, v: T): T {
  return { ...defaults, ...v };
}

/** Garante que dados vindos de backups (ou versões antigas) tenham todos os campos. */
export function normalizeData(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') throw new Error('Arquivo inválido: conteúdo vazio.');
  const r = raw as Partial<AppData>;
  if (!Array.isArray(r.periods) || !Array.isArray(r.classes) || !r.school) {
    throw new Error('Arquivo inválido: não é um backup do Sistema de Grade Horária.');
  }
  const base = initialData();
  const days = r.school.days?.length ?? 5;
  const data: AppData = {
    ...base,
    ...r,
    school: {
      ...base.school,
      ...r.school,
      workload: { ...base.school.workload, ...(r.school.workload ?? {}),
        components: { ...base.school.workload.components, ...(r.school.workload?.components ?? {}) } },
      solver: { ...base.school.solver, ...(r.school.solver ?? {}) },
      jeifGroups: Array.isArray(r.school.jeifGroups) ? r.school.jeifGroups : defaultJeifGroups(),
    },
    periods: r.periods.map((p) => ({ ...withDefaults({ breaks: [] }, p), slots: p.slots ?? [] })),
    cycles: r.cycles ?? [],
    grades: r.grades ?? base.grades,
    classes: r.classes.map((c) =>
      withDefaults({ dailyMax: null, blocked: [], freePolicy: 'livre', freePosition: 'qualquer', notes: '', letter: '' }, c),
    ),
    pending: r.pending ?? [],
    subjects: r.subjects ?? [],
    teachers: (r.teachers ?? []).map((t) => ({
      ...withDefaults({ subjectIds: [], periodIds: [], notes: '', jeifGroupId: null }, t),
      workload: { ...newWorkload(), ...(t.workload ?? {}) },
      availability: { ...newAvailability(days), ...(t.availability ?? {}) },
    })),
    assignments: (r.assignments ?? []).map((a) => withDefaults({ maxPerDay: null, double: 'indiferente' }, a)),
    activities: (r.activities ?? []).map((a) =>
      withDefaults({ inGrid: true, days: [], slots: [], position: 'qualquer', mode: 'flexivel', fixed: [], maxPerDay: null, classId: null, notes: '' }, a),
    ),
    schedules: (r.schedules ?? []).map((s) => withDefaults({ edited: false, notes: '' }, s)),
    activeScheduleId: r.activeScheduleId ?? null,
    isDemo: !!r.isDemo,
    lastBackup: r.lastBackup ?? null,
    updatedAt: r.updatedAt ?? new Date().toISOString(),
    version: 1,
  };
  return data;
}
