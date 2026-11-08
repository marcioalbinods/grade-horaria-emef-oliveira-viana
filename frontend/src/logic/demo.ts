// Dados FICTÍCIOS de demonstração. Servem apenas para conhecer e testar o sistema.
import type { Activity, AppData, Assignment, Teacher } from '../types';
import { initialData, newTeacher, PALETTE } from './defaults';
import { fromMinutes, uid } from './util';

function times(start: number, n: number, breakAfter: number, breakLen: number) {
  const out = [];
  let t = start;
  for (let i = 0; i < n; i++) {
    out.push({ start: fromMinutes(t), end: fromMinutes(t + 45) });
    t += 45;
    if (i === breakAfter) t += breakLen;
  }
  return out;
}

export function demoData(): AppData {
  const d = initialData();
  d.isDemo = true;
  d.school.name = 'ESCOLA FICTÍCIA (demonstração)';
  const [manha, tarde] = d.periods;
  manha.slots = times(7 * 60, 8, 3, 15);
  manha.breaks = [{ afterSlot: 3, start: '10:00', end: '10:15', label: 'Intervalo' }];
  tarde.slots = times(13 * 60 + 30, 6, 2, 20);
  tarde.breaks = [{ afterSlot: 2, start: '15:45', end: '16:05', label: 'Intervalo' }];

  const S = (name: string, short: string) => {
    const s = { id: uid('disc'), name, short, color: PALETTE[d.subjects.length % PALETTE.length] };
    d.subjects.push(s);
    return s.id;
  };
  const POL = S('Polivalente (regência)', 'POL'), EF = S('Educação Física', 'EF'), ART = S('Arte', 'ART');
  const ING = S('Língua Inglesa', 'ING'), LEI = S('Leitura', 'LEI'), POR = S('Língua Portuguesa', 'LP');
  const MAT = S('Matemática', 'MAT'), CIE = S('Ciências', 'CIE'), HIS = S('História', 'HIS'), GEO = S('Geografia', 'GEO');

  let n = 0;
  const T = (periods: string[], subjects: string[], opts: Partial<Teacher['availability']> = {}) => {
    n++;
    const t = newTeacher(`Professor(a) Fictício(a) ${String(n).padStart(2, '0')}`, periods, 5);
    t.subjectIds = subjects;
    Object.assign(t.availability, opts);
    d.teachers.push(t);
    return t;
  };
  const A = (classId: string, t: Teacher, subjectId: string, lessons: number, maxPerDay: number | null = null) => {
    const a: Assignment = { id: uid('atr'), classId, subjectId, teacherId: t.id, lessons, maxPerDay, double: 'indiferente' };
    d.assignments.push(a);
    return a;
  };
  const R = (t: Teacher, type: Activity['type'], periodId: string, qty: number, extra: Partial<Activity> = {}) => {
    d.activities.push({
      id: uid('ativ'), teacherId: t.id, type, label: type === 'HA' ? 'H.A.' : type, periodId, qty, inGrid: true, days: [], slots: [],
      position: 'qualquer', mode: 'flexivel', fixed: [], maxPerDay: null, classId: null, notes: '', ...extra,
    });
  };

  const EF1 = T([manha.id], [EF], { maxDaily: { value: 7, hard: true } });
  const EF2 = T([manha.id, tarde.id], [EF]);
  const EF3 = T([tarde.id], [EF]);
  const EF4 = T([tarde.id], [EF], { workDays: [0, 1, 2, 3] });
  const AR1 = T([manha.id], [ART]);
  const AR2 = T([tarde.id], [ART]);
  const AR3 = T([tarde.id], [ART], { workDays: [1, 2, 3] });
  const IN1 = T([manha.id, tarde.id], [ING]);
  const IN2 = T([tarde.id], [ING]);
  const IN3 = T([tarde.id], [ING]);
  const LE1 = T([manha.id], [LEI]);
  const LE2 = T([manha.id, tarde.id], [LEI]);
  R(IN1, 'HL', manha.id, 1, { position: 'fim_periodo' });

  const gradeNum = (gid: string) => Number(gid.replace('serie_', ''));
  for (const c of d.classes.filter((c) => c.periodId === manha.id)) {
    const g = gradeNum(c.gradeId);
    const full = g !== 4;
    const reg = T([manha.id], [POL]);
    A(c.id, reg, POL, full ? 30 : 20);
    A(c.id, g <= 2 ? EF1 : EF2, EF, 3, 1);
    A(c.id, AR1, ART, 2, 1);
    A(c.id, IN1, ING, 2);
    if (full) A(c.id, g <= 2 ? LE1 : LE2, LEI, 3);
    R(reg, 'HA', manha.id, 2, { maxPerDay: 1 });
    reg.workload = { total: (full ? 30 : 20) + 2, regular: full ? 30 : 20, ha: 2, cch: null, hl: null, others: [] };
    if (!full) c.freePosition = 'fim';
  }
  const tardeClasses = d.classes.filter((c) => c.periodId === tarde.id);
  const initial = tardeClasses.filter((c) => gradeNum(c.gradeId) <= 5);
  const finals = tardeClasses.filter((c) => gradeNum(c.gradeId) >= 6);
  for (const c of initial) {
    const g = gradeNum(c.gradeId);
    const reg = T([tarde.id], [POL]);
    const base = g === 1 ? 22 : g === 4 ? 17 : 23;
    A(c.id, reg, POL, base);
    A(c.id, EF3, EF, 3, 1);
    A(c.id, AR2, ART, 2);
    A(c.id, IN1, ING, 2);
    if (g === 1) A(c.id, LE2, LEI, 1);
    R(reg, 'HL', tarde.id, 1, { position: 'inicio_ou_fim_periodo' });
    if (g === 4) c.freePosition = 'fim';
  }
  const groups: [string, number, typeof finals[]][] = [
    [POR, 6, [finals.slice(0, 3), finals.slice(3, 6), finals.slice(6)]],
    [MAT, 6, [finals.slice(0, 3), finals.slice(3, 6), finals.slice(6)]],
    [CIE, 4, [finals.slice(0, 5), finals.slice(5)]],
    [HIS, 3, [finals.slice(0, 5), finals.slice(5)]],
    [GEO, 3, [finals.slice(0, 5), finals.slice(5)]],
  ];
  const specialists: Record<string, Teacher[]> = {};
  for (const [subj, qty, parts] of groups) {
    specialists[subj] = [];
    for (const part of parts) {
      const t = T([tarde.id], [subj]);
      specialists[subj].push(t);
      for (const c of part) A(c.id, t, subj, qty, 2);
    }
  }
  for (const c of finals) {
    const g = gradeNum(c.gradeId);
    A(c.id, g === 6 ? EF2 : g === 7 || g === 8 ? EF4 : EF3, EF, 3, 1);
    A(c.id, g === 6 ? AR2 : AR3, ART, 2, 1);
    A(c.id, g <= 8 ? IN2 : IN3, ING, 3, 1);
  }
  R(specialists[POR][0], 'HA', tarde.id, 3, { maxPerDay: 1 });
  R(specialists[MAT][0], 'HL', tarde.id, 2, { position: 'inicio_ou_fim_jornada' });
  R(specialists[CIE][0], 'CCH', tarde.id, 2, { days: [1, 3] });
  specialists[HIS][0].availability.unavailable = ['per_tarde|4|4', 'per_tarde|4|5'];
  specialists[GEO][1].availability.avoid = ['per_tarde|0|0', 'per_tarde|0|1'];
  specialists[GEO][1].availability.maxDays = 4;
  // JEIF (exemplos fictícios)
  specialists[MAT][1].jeifGroupId = 'jeif_3'; // Grupo III, tarde: aulas até a última aula de seg a qui
  specialists[GEO][0].jeifGroupId = 'jeif_2'; // Grupo II: sem aulas das 14h às 15h30 de seg a qui
  LE1.jeifGroupId = 'jeif_1'; // Grupo I: sem aulas das 10h30 às 12h de seg a qui
  for (const t of d.teachers) {
    if (t.workload.regular == null) {
      const les = d.assignments.filter((a) => a.teacherId === t.id).reduce((s, a) => s + a.lessons, 0);
      const acts = d.activities.filter((r) => r.teacherId === t.id);
      const sum = (ty: string) => acts.filter((r) => r.type === ty).reduce((s, r) => s + r.qty, 0);
      t.workload = { total: les + acts.reduce((s, r) => s + r.qty, 0), regular: les, ha: sum('HA') || null, cch: sum('CCH') || null, hl: sum('HL') || null, others: [] };
    }
  }
  return d;
}
