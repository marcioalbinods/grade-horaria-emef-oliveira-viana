import type { AppData, Entry, Period, Position, SchoolClass, Subject, Teacher } from '../types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}

export const slotKey = (periodId: string, day: number, slot: number) => `${periodId}|${day}|${slot}`;
export function parseSlotKey(k: string): [string, number, number] {
  const [p, d, s] = k.split('|');
  return [p, Number(d), Number(s)];
}
export const entryKey = (e: Entry) => `${e.kind}|${e.refId}|${e.periodId}|${e.day}|${e.slot}`;

export function toMinutes(h: string | undefined | null): number | null {
  if (!h) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(h.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? v : null;
}
export function fromMinutes(v: number): string {
  const h = Math.floor(v / 60) % 24;
  const m = v % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function slotLabel(p: Period | undefined, s: number): string {
  const sl = p?.slots[s];
  if (sl && sl.start && sl.end) return `${s + 1}ª aula · ${sl.start}–${sl.end}`;
  return `${s + 1}ª aula`;
}
export function slotTime(p: Period | undefined, s: number): string {
  const sl = p?.slots[s];
  return sl && sl.start && sl.end ? `${sl.start}–${sl.end}` : '';
}

/** Pares de aulas de períodos diferentes que se sobrepõem no relógio. */
export function periodOverlaps(periods: Period[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < periods.length; i++)
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i], b = periods[j];
      a.slots.forEach((x, s1) => {
        const a0 = toMinutes(x.start), a1 = toMinutes(x.end);
        if (a0 == null || a1 == null) return;
        b.slots.forEach((y, s2) => {
          const b0 = toMinutes(y.start), b1 = toMinutes(y.end);
          if (b0 == null || b1 == null) return;
          if (a0 < b1 && b0 < a1) {
            out.add(`${a.id}|${s1}|${b.id}|${s2}`);
            out.add(`${b.id}|${s2}|${a.id}|${s1}`);
          }
        });
      });
    }
  return out;
}

export function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name, 'pt-BR', { numeric: true });
}

export function sortedClasses(data: AppData): SchoolClass[] {
  const pOrder = new Map(data.periods.map((p, i) => [p.id, i]));
  const gOrder = new Map(data.grades.map((g) => [g.id, g.order]));
  return [...data.classes].sort(
    (a, b) =>
      (pOrder.get(a.periodId) ?? 99) - (pOrder.get(b.periodId) ?? 99) ||
      (gOrder.get(a.gradeId) ?? 99) - (gOrder.get(b.gradeId) ?? 99) ||
      a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
  );
}

/** Nome da turma; inclui o período quando há turmas com o mesmo nome em períodos diferentes. */
export function className(data: AppData, c: SchoolClass | undefined | null): string {
  if (!c) return '(turma removida)';
  const dup = data.classes.some((o) => o.id !== c.id && o.name === c.name);
  if (!dup) return c.name;
  const p = data.periods.find((p) => p.id === c.periodId);
  return `${c.name} – ${p?.name ?? '?'}`;
}

export function teacherName(t: Teacher | undefined | null) {
  return t ? t.name : '(sem professor)';
}
export function subjectName(s: Subject | undefined | null) {
  return s ? s.name : '(disciplina removida)';
}

export function indexData(data: AppData) {
  return {
    period: new Map(data.periods.map((x) => [x.id, x])),
    cls: new Map(data.classes.map((x) => [x.id, x])),
    teacher: new Map(data.teachers.map((x) => [x.id, x])),
    subject: new Map(data.subjects.map((x) => [x.id, x])),
    assignment: new Map(data.assignments.map((x) => [x.id, x])),
    activity: new Map(data.activities.map((x) => [x.id, x])),
    grade: new Map(data.grades.map((x) => [x.id, x])),
  };
}
export type DataIndex = ReturnType<typeof indexData>;

export const POSITION_LABELS: Record<Position, string> = {
  qualquer: 'Qualquer horário permitido',
  meio: 'Somente no meio do período (nunca na primeira ou última aula)',
  inicio_periodo: 'Somente no início do período (a partir da 1ª aula)',
  fim_periodo: 'Somente no final do período (até a última aula)',
  inicio_ou_fim_periodo: 'Somente no início OU no final do período',
  inicio_jornada: 'No início da jornada do professor no turno (antes de todas as suas aulas)',
  fim_jornada: 'No final da jornada do professor no turno (depois de todas as suas aulas)',
  inicio_ou_fim_jornada: 'No início OU no final da jornada do professor no turno',
};

export const ACTIVITY_LABELS = { HA: 'H.A.', CCH: 'CCH', HL: 'HL', OUTRA: 'Outra atividade' } as const;

export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111827' : '#ffffff';
}

export function pct(v: number) {
  return `${Math.round(v)}%`;
}

export function plural(n: number, s: string, p: string) {
  return `${n} ${n === 1 ? s : p}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFile(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');
}
