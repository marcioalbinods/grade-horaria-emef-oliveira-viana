import type { AppData, Availability, Grade, Period, SchoolClass, Teacher, Workload } from '../types';
import { uid } from './util';

export const PALETTE = [
  '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777',
  '#4f46e5', '#059669', '#b91c1c', '#7c3aed', '#c2410c', '#0e7490', '#a16207', '#be185d',
  '#475569', '#65a30d',
];

export const WEEK_DAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];

export function emptySlots(n: number) {
  return Array.from({ length: n }, () => ({ start: '', end: '' }));
}

export function newAvailability(days: number): Availability {
  return {
    workDays: Array.from({ length: days }, (_, i) => i),
    unavailable: [],
    avoid: [],
    entry: {},
    exit: {},
    maxDaily: null,
    maxConsecutive: null,
    preferredDays: [],
    maxDays: null,
    preferConsecutive: false,
    avoidGaps: false,
  };
}

export function newWorkload(): Workload {
  return { total: null, regular: null, ha: null, cch: null, hl: null, others: [] };
}

export function newTeacher(name: string, periodIds: string[], days: number): Teacher {
  return { id: uid('prof'), name, subjectIds: [], periodIds, workload: newWorkload(), availability: newAvailability(days), notes: '' };
}

export function makeClass(periodId: string, grade: Grade, letter: string, weekly: number, freePolicy: SchoolClass['freePolicy'] = 'livre'): SchoolClass {
  return {
    id: uid('tur'), periodId, gradeId: grade.id, letter, name: `${grade.short} ${letter}`,
    weeklyLessons: weekly, dailyMax: null, blocked: [], freePolicy, freePosition: 'qualquer', notes: '',
  };
}

/** Estrutura inicial informada pela escola. Horários de início/fim ficam em
 *  branco para o usuário configurar (não são presumidos). */
export function initialData(): AppData {
  const manha: Period = { id: 'per_manha', name: 'Manhã', slots: emptySlots(8), breaks: [] };
  const tarde: Period = { id: 'per_tarde', name: 'Tarde', slots: emptySlots(6), breaks: [] };
  const grades: Grade[] = Array.from({ length: 9 }, (_, i) => ({
    id: `serie_${i + 1}`, name: `${i + 1}º ano`, short: `${i + 1}º`, cycleId: null, order: i + 1,
  }));
  const g = (n: number) => grades[n - 1];
  const classes: SchoolClass[] = [];
  const add = (p: Period, n: number, qty: number, weekly: number) => {
    for (let i = 0; i < qty; i++) classes.push(makeClass(p.id, g(n), 'ABCDEFGHIJ'[i], weekly));
  };
  add(manha, 1, 4, 40);
  add(manha, 2, 4, 40);
  add(manha, 3, 5, 40);
  add(manha, 4, 2, 27);
  add(tarde, 1, 3, 30);
  add(tarde, 4, 1, 24);
  add(tarde, 5, 1, 30);
  add(tarde, 6, 3, 30);
  add(tarde, 7, 1, 30);
  add(tarde, 8, 3, 30);
  add(tarde, 9, 3, 30);
  const now = new Date().toISOString();
  return {
    version: 1,
    school: {
      name: 'EMEF Oliveira Viana',
      days: WEEK_DAYS.slice(0, 5),
      lessonMinutes: 45,
      workload: {
        unit: 'aulas',
        components: {
          aula: { counts: true, weight: 1 },
          HA: { counts: true, weight: 1 },
          CCH: { counts: true, weight: 1 },
          HL: { counts: true, weight: 1 },
          OUTRA: { counts: true, weight: 1 },
        },
      },
      defaultFreePolicy: 'livre',
      solver: { timeLimit: 30, strategies: ['janelas', 'dias', 'distribuicao', 'equilibrada'], serverUrl: '' },
    },
    periods: [manha, tarde],
    cycles: [],
    grades,
    classes,
    pending: [
      { id: uid('pend'), periodId: tarde.id, gradeId: g(2).id, weeklyLessons: 30, note: 'Quantidade de turmas pendente de informação' },
      { id: uid('pend'), periodId: tarde.id, gradeId: g(3).id, weeklyLessons: 30, note: 'Quantidade de turmas pendente de informação' },
    ],
    subjects: [],
    teachers: [],
    assignments: [],
    activities: [],
    schedules: [],
    activeScheduleId: null,
    isDemo: false,
    lastBackup: null,
    updatedAt: now,
  };
}

export const COMMON_SUBJECTS: [string, string][] = [
  ['Língua Portuguesa', 'LP'], ['Matemática', 'MAT'], ['Ciências', 'CIE'], ['História', 'HIS'],
  ['Geografia', 'GEO'], ['Arte', 'ART'], ['Educação Física', 'EF'], ['Língua Inglesa', 'ING'],
  ['Ensino Religioso', 'ER'],
];
