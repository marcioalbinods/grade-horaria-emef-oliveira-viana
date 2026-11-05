// Operações que mantêm a consistência entre os módulos (exclusões em cascata etc.).
import type { AppData, ID } from '../types';

export function purgeEntries(d: AppData, assignmentIds: Set<ID>, activityIds: Set<ID>) {
  for (const s of d.schedules) {
    const before = s.entries.length;
    s.entries = s.entries.filter((e) =>
      e.kind === 'aula' ? !assignmentIds.has(e.refId) : !activityIds.has(e.refId),
    );
    if (s.entries.length !== before) {
      s.edited = true;
      s.updatedAt = new Date().toISOString();
    }
  }
}

export function deleteAssignments(d: AppData, ids: Set<ID>) {
  d.assignments = d.assignments.filter((a) => !ids.has(a.id));
  purgeEntries(d, ids, new Set());
}

export function deleteActivities(d: AppData, ids: Set<ID>) {
  d.activities = d.activities.filter((a) => !ids.has(a.id));
  purgeEntries(d, new Set(), ids);
}

export function deleteClasses(d: AppData, ids: Set<ID>) {
  const asg = new Set(d.assignments.filter((a) => ids.has(a.classId)).map((a) => a.id));
  deleteAssignments(d, asg);
  for (const r of d.activities) if (r.classId && ids.has(r.classId)) r.classId = null;
  d.classes = d.classes.filter((c) => !ids.has(c.id));
}

export function deleteTeacher(d: AppData, id: ID) {
  for (const a of d.assignments) if (a.teacherId === id) a.teacherId = null;
  deleteActivities(d, new Set(d.activities.filter((r) => r.teacherId === id).map((r) => r.id)));
  d.teachers = d.teachers.filter((t) => t.id !== id);
}

export function deleteSubject(d: AppData, id: ID) {
  deleteAssignments(d, new Set(d.assignments.filter((a) => a.subjectId === id).map((a) => a.id)));
  for (const t of d.teachers) t.subjectIds = t.subjectIds.filter((s) => s !== id);
  d.subjects = d.subjects.filter((s) => s.id !== id);
}

export function deleteGrade(d: AppData, id: ID) {
  deleteClasses(d, new Set(d.classes.filter((c) => c.gradeId === id).map((c) => c.id)));
  d.pending = d.pending.filter((p) => p.gradeId !== id);
  d.grades = d.grades.filter((g) => g.id !== id);
}

export function deletePeriod(d: AppData, id: ID) {
  deleteClasses(d, new Set(d.classes.filter((c) => c.periodId === id).map((c) => c.id)));
  deleteActivities(d, new Set(d.activities.filter((r) => r.periodId === id).map((r) => r.id)));
  d.pending = d.pending.filter((p) => p.periodId !== id);
  for (const t of d.teachers) {
    t.periodIds = t.periodIds.filter((p) => p !== id);
    t.availability.unavailable = t.availability.unavailable.filter((k) => !k.startsWith(id + '|'));
    t.availability.avoid = t.availability.avoid.filter((k) => !k.startsWith(id + '|'));
    delete t.availability.entry[id];
    delete t.availability.exit[id];
  }
  d.periods = d.periods.filter((p) => p.id !== id);
}

export function deleteCycle(d: AppData, id: ID) {
  for (const g of d.grades) if (g.cycleId === id) g.cycleId = null;
  d.cycles = d.cycles.filter((c) => c.id !== id);
}

/** Ajusta dados dependentes quando o número de aulas de um período diminui. */
export function trimPeriodSlots(d: AppData, periodId: ID, n: number) {
  for (const c of d.classes)
    if (c.periodId === periodId) {
      c.blocked = c.blocked.filter(([, s]) => s < n);
      if (c.dailyMax != null && c.dailyMax > n) c.dailyMax = n;
    }
  for (const t of d.teachers) {
    const keep = (k: string) => {
      const [p, , s] = k.split('|');
      return p !== periodId || Number(s) < n;
    };
    t.availability.unavailable = t.availability.unavailable.filter(keep);
    t.availability.avoid = t.availability.avoid.filter(keep);
    const en = t.availability.entry[periodId];
    if (en != null && en >= n) t.availability.entry[periodId] = null;
    const ex = t.availability.exit[periodId];
    if (ex != null && ex >= n) t.availability.exit[periodId] = null;
  }
  for (const r of d.activities)
    if (r.periodId === periodId) {
      r.slots = r.slots.filter((s) => s < n);
      r.fixed = r.fixed.filter(([, s]) => s < n);
    }
}

/** Ajusta dados dependentes quando a quantidade de dias letivos diminui. */
export function trimDays(d: AppData, n: number) {
  for (const c of d.classes) c.blocked = c.blocked.filter(([day]) => day < n);
  for (const t of d.teachers) {
    const a = t.availability;
    a.workDays = a.workDays.filter((x) => x < n);
    a.preferredDays = a.preferredDays.filter((x) => x < n);
    const keep = (k: string) => Number(k.split('|')[1]) < n;
    a.unavailable = a.unavailable.filter(keep);
    a.avoid = a.avoid.filter(keep);
  }
  for (const r of d.activities) {
    r.days = r.days.filter((x) => x < n);
    r.fixed = r.fixed.filter(([day]) => day < n);
  }
}
