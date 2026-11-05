// Converte os dados da aplicação no formato aceito pelo motor de otimização.
import type { AppData, Entry, StrategyId } from '../types';
import { parseSlotKey } from './util';

export interface SolveOptions {
  strategies: StrategyId[];
  timeLimit: number;
  locks: Entry[];
}

export function buildProblem(data: AppData, opts: SolveOptions) {
  const D = data.school.days.length;
  const periodIds = new Set(data.periods.map((p) => p.id));
  const classes = data.classes.filter((c) => periodIds.has(c.periodId));
  const classIds = new Set(classes.map((c) => c.id));
  const nslots = new Map(data.periods.map((p) => [p.id, p.slots.length]));
  const teachers = data.teachers.map((t) => {
    const av = t.availability;
    const entry: Record<string, number> = {};
    const exit: Record<string, number> = {};
    for (const [k, v] of Object.entries(av.entry)) if (v != null && periodIds.has(k)) entry[k] = v;
    for (const [k, v] of Object.entries(av.exit)) if (v != null && periodIds.has(k)) exit[k] = v;
    const key3 = (k: string) => {
      const [p, d, s] = parseSlotKey(k);
      return [p, d, s] as [string, number, number];
    };
    const validKey = ([p, d, s]: [string, number, number]) => periodIds.has(p) && d < D && s < (nslots.get(p) ?? 0);
    return {
      id: t.id,
      name: t.name,
      periodIds: t.periodIds.filter((p) => periodIds.has(p)),
      workDays: av.workDays.filter((d) => d < D),
      unavailable: av.unavailable.map(key3).filter(validKey),
      avoid: av.avoid.map(key3).filter(validKey),
      entry,
      exit,
      maxDaily: av.maxDaily,
      maxConsecutive: av.maxConsecutive,
      preferredDays: av.preferredDays.filter((d) => d < D),
      maxDays: av.maxDays,
      preferConsecutive: av.preferConsecutive,
      avoidGaps: av.avoidGaps,
    };
  });
  const teacherIds = new Set(teachers.map((t) => t.id));
  const assignments = data.assignments
    .filter((a) => a.teacherId && teacherIds.has(a.teacherId) && classIds.has(a.classId) && a.lessons > 0)
    .map((a) => ({
      id: a.id, classId: a.classId, teacherId: a.teacherId!, subjectId: a.subjectId, lessons: a.lessons,
      maxPerDay: a.maxPerDay, double: a.double,
    }));
  const activities = data.activities
    .filter((r) => r.inGrid && r.qty > 0 && teacherIds.has(r.teacherId) && periodIds.has(r.periodId))
    .map((r) => ({
      id: r.id, teacherId: r.teacherId, type: r.type, label: r.label || r.type, periodId: r.periodId, qty: r.qty,
      days: r.days.filter((d) => d < D), slots: r.slots, position: r.position, mode: r.mode, fixed: r.fixed,
      maxPerDay: r.maxPerDay, classId: r.classId && classIds.has(r.classId) ? r.classId : null,
    }));
  const aIds = new Set(assignments.map((a) => a.id));
  const rIds = new Set(activities.map((r) => r.id));
  const locks = opts.locks
    .filter((e) => (e.kind === 'aula' ? aIds.has(e.refId) : rIds.has(e.refId)))
    .map((e) => ({ kind: e.kind, refId: e.refId, periodId: e.periodId, day: e.day, slot: e.slot }));
  return {
    days: data.school.days,
    periods: data.periods.map((p) => ({ id: p.id, name: p.name, slots: p.slots.map((s) => ({ start: s.start || null, end: s.end || null })) })),
    classes: classes.map((c) => ({
      id: c.id, name: c.name, periodId: c.periodId, weeklyLessons: c.weeklyLessons, dailyMax: c.dailyMax,
      blocked: c.blocked, freePosition: c.freePosition,
    })),
    teachers,
    assignments,
    activities,
    locks,
    options: { strategies: opts.strategies, timeLimit: opts.timeLimit, numWorkers: 8, diagnose: true },
  };
}
export type Problem = ReturnType<typeof buildProblem>;
