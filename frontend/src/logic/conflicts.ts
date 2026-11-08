// Validação de uma grade (gerada ou editada manualmente) contra os dados atuais.
import type { AppData, Entry } from '../types';
import { jeifInfo, type JeifInfo } from './jeif';
import { className, entryKey, indexData, periodOverlaps, type DataIndex } from './util';

export interface Violation {
  severity: 'conflito' | 'pendencia';
  message: string;
  entries: string[]; // chaves das entradas envolvidas
}

export interface EntryInfo {
  e: Entry;
  key: string;
  teacherId: string | null;
  classId: string | null; // turma ocupada (aula ou atividade vinculada)
  isLesson: boolean;
  label: string;
}

export function describeEntry(data: AppData, ix: DataIndex, e: Entry): EntryInfo {
  if (e.kind === 'aula') {
    const a = ix.assignment.get(e.refId);
    const s = a ? ix.subject.get(a.subjectId) : undefined;
    const c = a ? ix.cls.get(a.classId) : undefined;
    return {
      e, key: entryKey(e), teacherId: a?.teacherId ?? null, classId: a?.classId ?? null, isLesson: true,
      label: a ? `${s?.name ?? '?'} – ${className(data, c)}` : 'Aula removida',
    };
  }
  const r = ix.activity.get(e.refId);
  return {
    e, key: entryKey(e), teacherId: r?.teacherId ?? null, classId: r?.classId ?? null, isLesson: false,
    label: r ? r.label || r.type : 'Atividade removida',
  };
}

const DAY = (data: AppData, d: number) => data.school.days[d] ?? `dia ${d + 1}`;

export function validateSchedule(data: AppData, entries: Entry[]): Violation[] {
  const ix = indexData(data);
  const out: Violation[] = [];
  const D = data.school.days.length;
  const infos = entries.map((e) => describeEntry(data, ix, e));
  const tName = (id: string | null) => (id ? ix.teacher.get(id)?.name ?? '?' : '?');
  const where = (e: Entry) => `${DAY(data, e.day)}, ${e.slot + 1}ª aula (${ix.period.get(e.periodId)?.name ?? '?'})`;

  const jeifCache = new Map<string, JeifInfo>();
  const jeifOf = (tid: string) => {
    if (!jeifCache.has(tid)) jeifCache.set(tid, jeifInfo(data, ix.teacher.get(tid)!));
    return jeifCache.get(tid)!;
  };
  const classOcc = new Map<string, EntryInfo[]>();
  const teacherOcc = new Map<string, EntryInfo[]>();
  const valid: EntryInfo[] = [];

  for (const inf of infos) {
    const e = inf.e;
    const p = ix.period.get(e.periodId);
    if (e.kind === 'aula' && !ix.assignment.get(e.refId)) {
      out.push({ severity: 'conflito', message: `Aula de uma atribuição que não existe mais (${where(e)}).`, entries: [inf.key] });
      continue;
    }
    if (e.kind === 'atividade' && !ix.activity.get(e.refId)) {
      out.push({ severity: 'conflito', message: `Atividade que não existe mais (${where(e)}).`, entries: [inf.key] });
      continue;
    }
    if (!p || e.day < 0 || e.day >= D || e.slot < 0 || e.slot >= p.slots.length) {
      out.push({ severity: 'conflito', message: `${inf.label}: horário fora da estrutura atual da escola.`, entries: [inf.key] });
      continue;
    }
    valid.push(inf);
    if (inf.classId) {
      const k = `${inf.classId}|${e.day}|${e.slot}`;
      classOcc.set(k, [...(classOcc.get(k) ?? []), inf]);
    }
    if (inf.teacherId) {
      const k = `${inf.teacherId}|${e.periodId}|${e.day}|${e.slot}`;
      teacherOcc.set(k, [...(teacherOcc.get(k) ?? []), inf]);
    }
  }

  // ---- por entrada
  for (const inf of valid) {
    const e = inf.e;
    if (e.kind === 'aula') {
      const a = ix.assignment.get(e.refId)!;
      const c = ix.cls.get(a.classId);
      if (!c) continue;
      if (c.periodId !== e.periodId)
        out.push({ severity: 'conflito', message: `${inf.label}: aula fora do período de funcionamento da turma.`, entries: [inf.key] });
      if (c.blocked.some(([d, s]) => d === e.day && s === e.slot))
        out.push({ severity: 'conflito', message: `${inf.label}: horário bloqueado para aulas da turma (${where(e)}).`, entries: [inf.key] });
      if (!a.teacherId) out.push({ severity: 'pendencia', message: `${inf.label}: aula sem professor definido.`, entries: [inf.key] });
    } else {
      const r = ix.activity.get(e.refId)!;
      const n = ix.period.get(r.periodId)?.slots.length ?? 0;
      if (r.periodId !== e.periodId)
        out.push({ severity: 'conflito', message: `${r.label} de ${tName(r.teacherId)}: fora do período configurado.`, entries: [inf.key] });
      if (r.mode === 'fixo') {
        if (!r.fixed.some(([d, s]) => d === e.day && s === e.slot))
          out.push({ severity: 'conflito', message: `${r.label} de ${tName(r.teacherId)} tem horário fixo e foi colocada em outro horário (${where(e)}).`, entries: [inf.key] });
      } else {
        if (r.days.length && !r.days.includes(e.day))
          out.push({ severity: 'conflito', message: `${r.label} de ${tName(r.teacherId)}: dia não permitido (${DAY(data, e.day)}).`, entries: [inf.key] });
        if (r.slots.length && !r.slots.includes(e.slot))
          out.push({ severity: 'conflito', message: `${r.label} de ${tName(r.teacherId)}: horário não permitido (${e.slot + 1}ª aula).`, entries: [inf.key] });
        if (r.position === 'meio' && (e.slot === 0 || e.slot === n - 1))
          out.push({ severity: 'conflito', message: `${r.label} de ${tName(r.teacherId)} deve ficar no meio do período.`, entries: [inf.key] });
      }
    }
    if (inf.teacherId) {
      const t = ix.teacher.get(inf.teacherId);
      if (!t) continue;
      const av = t.availability;
      const msgs: string[] = [];
      if (!t.periodIds.includes(e.periodId)) msgs.push(`não trabalha no período ${ix.period.get(e.periodId)?.name}`);
      if (!av.workDays.includes(e.day)) msgs.push(`não trabalha às ${DAY(data, e.day).toLowerCase()}s`);
      if (av.unavailable.includes(`${e.periodId}|${e.day}|${e.slot}`)) msgs.push('está indisponível neste horário');
      const jf = jeifOf(t.id);
      if (jf.blocked.has(`${e.periodId}|${e.day}|${e.slot}`)) msgs.push(`está em JEIF (${jf.group?.name}, ${jf.group?.start}–${jf.group?.end}) neste horário`);
      const lo = av.entry[e.periodId], hi = av.exit[e.periodId];
      if (lo != null && e.slot < lo) msgs.push(`só pode começar a partir da ${lo + 1}ª aula`);
      if (hi != null && e.slot > hi) msgs.push(`precisa sair após a ${hi + 1}ª aula`);
      for (const m of msgs) out.push({ severity: 'conflito', message: `${t.name} ${m} (${where(e)}) — ${inf.label}.`, entries: [inf.key] });
    }
  }

  // ---- sobreposições
  for (const [, list] of classOcc)
    if (list.length > 1) {
      const c = ix.cls.get(list[0].classId!);
      out.push({
        severity: 'conflito',
        message: `Turma ${className(data, c)} com ${list.length} aulas/atividades no mesmo horário (${where(list[0].e)}): ${list.map((x) => x.label.split(' – ')[0]).join(', ')}.`,
        entries: list.map((x) => x.key),
      });
    }
  for (const [, list] of teacherOcc)
    if (list.length > 1)
      out.push({
        severity: 'conflito',
        message: `${tName(list[0].teacherId)} está em ${list.length} lugares ao mesmo tempo (${where(list[0].e)}): ${list.map((x) => x.label).join('; ')}.`,
        entries: list.map((x) => x.key),
      });
  const overlaps = periodOverlaps(data.periods);
  if (overlaps.size) {
    const seen = new Set<string>();
    const byTD = new Map<string, string[]>();
    for (const k of teacherOcc.keys()) {
      const [tid, , d] = k.split('|');
      byTD.set(`${tid}|${d}`, [...(byTD.get(`${tid}|${d}`) ?? []), k]);
    }
    for (const keys of byTD.values())
      for (const k1 of keys)
        for (const k2 of keys) {
          const [tid, p1, d, s1] = k1.split('|');
          const [, p2, , s2] = k2.split('|');
          if (p1 === p2 || !overlaps.has(`${p1}|${s1}|${p2}|${s2}`)) continue;
          const sig = [k1, k2].sort().join('#');
          if (seen.has(sig)) continue;
          seen.add(sig);
          out.push({
            severity: 'conflito',
            message: `${tName(tid)} tem compromissos em períodos diferentes com horários sobrepostos (${DAY(data, Number(d))}).`,
            entries: [...teacherOcc.get(k1)!, ...teacherOcc.get(k2)!].map((x) => x.key),
          });
        }
  }

  // ---- JEIF: sem horário vago entre as aulas do período anterior e a JEIF
  for (const t of data.teachers) {
    const jf = jeifOf(t.id);
    for (const { periodId, day } of jf.noGap) {
      const n = ix.period.get(periodId)?.slots.length ?? 0;
      const occ: number[] = [];
      for (let s = 0; s < n; s++) if (teacherOcc.has(`${t.id}|${periodId}|${day}|${s}`)) occ.push(s);
      if (!occ.length) continue;
      const first = Math.min(...occ);
      const vagas: number[] = [];
      for (let s = first; s < n; s++) if (!occ.includes(s)) vagas.push(s + 1);
      if (vagas.length)
        out.push({
          severity: 'conflito',
          message: `${t.name} (JEIF ${jf.group?.name} às ${jf.group?.start}) tem horário vago entre suas aulas do período ${ix.period.get(periodId)?.name} e a JEIF em ${DAY(data, day)} (${vagas.map((v) => v + 'ª').join(', ')} aula). As aulas desse dia devem seguir até a última aula do período.`,
          entries: occ.flatMap((s) => teacherOcc.get(`${t.id}|${periodId}|${day}|${s}`)!.map((x) => x.key)),
        });
    }
  }

  // ---- limites diários e contagens
  const byAssignDay = new Map<string, EntryInfo[]>();
  const byActDay = new Map<string, EntryInfo[]>();
  const byClassDay = new Map<string, EntryInfo[]>();
  const lessonsTeacherDay = new Map<string, EntryInfo[]>();
  const countA = new Map<string, number>();
  const countR = new Map<string, number>();
  for (const inf of valid) {
    const e = inf.e;
    if (e.kind === 'aula') {
      const a = ix.assignment.get(e.refId)!;
      byAssignDay.set(`${a.id}|${e.day}`, [...(byAssignDay.get(`${a.id}|${e.day}`) ?? []), inf]);
      byClassDay.set(`${a.classId}|${e.day}`, [...(byClassDay.get(`${a.classId}|${e.day}`) ?? []), inf]);
      if (a.teacherId) lessonsTeacherDay.set(`${a.teacherId}|${e.day}`, [...(lessonsTeacherDay.get(`${a.teacherId}|${e.day}`) ?? []), inf]);
      countA.set(a.id, (countA.get(a.id) ?? 0) + 1);
    } else {
      byActDay.set(`${e.refId}|${e.day}`, [...(byActDay.get(`${e.refId}|${e.day}`) ?? []), inf]);
      countR.set(e.refId, (countR.get(e.refId) ?? 0) + 1);
    }
  }
  for (const [k, list] of byAssignDay) {
    const a = ix.assignment.get(k.split('|')[0])!;
    if (a.maxPerDay != null && list.length > a.maxPerDay)
      out.push({ severity: 'conflito', message: `${list[0].label}: ${list.length} aulas em ${DAY(data, list[0].e.day)}, acima do máximo de ${a.maxPerDay} por dia.`, entries: list.map((x) => x.key) });
  }
  for (const [k, list] of byClassDay) {
    const c = ix.cls.get(k.split('|')[0]);
    if (c && c.dailyMax != null && list.length > c.dailyMax)
      out.push({ severity: 'conflito', message: `Turma ${className(data, c)}: ${list.length} aulas em ${DAY(data, list[0].e.day)}, acima do limite de ${c.dailyMax}.`, entries: list.map((x) => x.key) });
  }
  for (const [k, list] of lessonsTeacherDay) {
    const t = ix.teacher.get(k.split('|')[0]);
    const md = t?.availability.maxDaily;
    if (t && md?.hard && list.length > md.value)
      out.push({ severity: 'conflito', message: `${t.name}: ${list.length} aulas em ${DAY(data, list[0].e.day)}, acima do limite obrigatório de ${md.value}.`, entries: list.map((x) => x.key) });
    const mc = t?.availability.maxConsecutive;
    if (t && mc?.hard) {
      const byP = new Map<string, Map<number, string>>();
      for (const x of list) {
        if (!byP.has(x.e.periodId)) byP.set(x.e.periodId, new Map());
        byP.get(x.e.periodId)!.set(x.e.slot, x.key);
      }
      for (const [pid, slots] of byP) {
        const n = ix.period.get(pid)?.slots.length ?? 0;
        let run: string[] = [];
        for (let s = 0; s <= n; s++) {
          if (slots.has(s)) run.push(slots.get(s)!);
          else {
            if (run.length > mc.value)
              out.push({ severity: 'conflito', message: `${t.name}: ${run.length} aulas consecutivas em ${DAY(data, list[0].e.day)}, acima do limite obrigatório de ${mc.value}.`, entries: run });
            run = [];
          }
        }
      }
    }
  }
  for (const [k, list] of byActDay) {
    const r = ix.activity.get(k.split('|')[0])!;
    if (r.maxPerDay != null && list.length > r.maxPerDay)
      out.push({ severity: 'conflito', message: `${r.label} de ${tName(r.teacherId)}: ${list.length} em ${DAY(data, list[0].e.day)}, acima do máximo diário de ${r.maxPerDay}.`, entries: list.map((x) => x.key) });
    const pos = r.position;
    if (pos === 'qualquer' || pos === 'meio' || r.mode === 'fixo') continue;
    const n = ix.period.get(r.periodId)?.slots.length ?? 0;
    const sl = list.map((x) => x.e.slot).sort((a, b) => a - b);
    const set = new Set(sl);
    const blockStart = sl.every((_, i) => set.has(i)) && sl.length === set.size && Math.max(...sl) === set.size - 1;
    const blockEnd = sl.every((s) => s >= n - set.size) && Math.min(...sl) === n - set.size;
    const others: number[] = [];
    for (let s = 0; s < n; s++) {
      const occ = teacherOcc.get(`${r.teacherId}|${r.periodId}|${list[0].e.day}|${s}`) ?? [];
      if (occ.some((x) => !(x.e.kind === 'atividade' && x.e.refId === r.id))) others.push(s);
    }
    const jStart = others.every((o) => o > Math.max(...sl));
    const jEnd = others.every((o) => o < Math.min(...sl));
    const ok =
      pos === 'inicio_periodo' ? blockStart :
      pos === 'fim_periodo' ? blockEnd :
      pos === 'inicio_ou_fim_periodo' ? blockStart || blockEnd :
      pos === 'inicio_jornada' ? jStart :
      pos === 'fim_jornada' ? jEnd :
      jStart || jEnd;
    if (!ok)
      out.push({
        severity: 'conflito',
        message: `${r.label} de ${tName(r.teacherId)} em ${DAY(data, list[0].e.day)} não respeita a regra de posição: ${positionShort(pos)}.`,
        entries: list.map((x) => x.key),
      });
  }
  for (const a of data.assignments) {
    if (!ix.cls.get(a.classId)) continue;
    const n = countA.get(a.id) ?? 0;
    const label = `${ix.subject.get(a.subjectId)?.name ?? '?'} – ${className(data, ix.cls.get(a.classId))}`;
    if (n < a.lessons) out.push({ severity: 'pendencia', message: `${label}: ${n} de ${a.lessons} aulas alocadas (faltam ${a.lessons - n}).`, entries: [] });
    if (n > a.lessons)
      out.push({
        severity: 'conflito',
        message: `${label}: ${n} aulas alocadas, mas a matriz prevê ${a.lessons}.`,
        entries: valid.filter((x) => x.e.kind === 'aula' && x.e.refId === a.id).map((x) => x.key),
      });
  }
  for (const r of data.activities) {
    if (!r.inGrid) continue;
    const n = countR.get(r.id) ?? 0;
    if (n < r.qty) out.push({ severity: 'pendencia', message: `${r.label} de ${tName(r.teacherId)}: ${n} de ${r.qty} alocadas.`, entries: [] });
    if (n > r.qty)
      out.push({ severity: 'conflito', message: `${r.label} de ${tName(r.teacherId)}: ${n} alocadas, mas o cadastro prevê ${r.qty}.`, entries: valid.filter((x) => x.e.refId === r.id).map((x) => x.key) });
  }
  return out;
}

export function positionShort(p: string) {
  return (
    {
      inicio_periodo: 'início do período', fim_periodo: 'final do período', inicio_ou_fim_periodo: 'início ou final do período',
      inicio_jornada: 'início da jornada', fim_jornada: 'final da jornada', inicio_ou_fim_jornada: 'início ou final da jornada',
      meio: 'meio do período', qualquer: 'qualquer',
    } as Record<string, string>
  )[p] ?? p;
}

const vKey = (v: Violation) => v.severity + '|' + v.message;

/** Conflitos novos que uma alteração introduz (comparando antes/depois). */
export function newConflicts(data: AppData, before: Entry[], after: Entry[]): Violation[] {
  const b = new Set(validateSchedule(data, before).filter((v) => v.severity === 'conflito').map(vKey));
  return validateSchedule(data, after).filter((v) => v.severity === 'conflito' && !b.has(vKey(v)));
}

export function moveEntry(entries: Entry[], key: string, day: number, slot: number): Entry[] {
  return entries.map((e) => (entryKey(e) === key ? { ...e, day, slot } : e));
}

/** Troca de posição duas entradas. */
export function swapEntries(entries: Entry[], k1: string, k2: string): Entry[] {
  const e1 = entries.find((e) => entryKey(e) === k1);
  const e2 = entries.find((e) => entryKey(e) === k2);
  if (!e1 || !e2) return entries;
  return entries.map((e) => {
    const k = entryKey(e);
    if (k === k1) return { ...e, day: e2.day, slot: e2.slot, periodId: e2.periodId };
    if (k === k2) return { ...e, day: e1.day, slot: e1.slot, periodId: e1.periodId };
    return e;
  });
}

/** Lista os horários (do mesmo período) para onde a entrada pode ir sem criar conflitos. */
export function validTargets(data: AppData, entries: Entry[], key: string): { day: number; slot: number }[] {
  const e = entries.find((x) => entryKey(x) === key);
  if (!e) return [];
  const p = data.periods.find((x) => x.id === e.periodId);
  if (!p) return [];
  const base = new Set(validateSchedule(data, entries).filter((v) => v.severity === 'conflito').map(vKey));
  const out: { day: number; slot: number }[] = [];
  for (let d = 0; d < data.school.days.length; d++)
    for (let s = 0; s < p.slots.length; s++) {
      if (d === e.day && s === e.slot) continue;
      const after = moveEntry(entries, key, d, s);
      const bad = validateSchedule(data, after).some((v) => v.severity === 'conflito' && !base.has(vKey(v)));
      if (!bad) out.push({ day: d, slot: s });
    }
  return out;
}
