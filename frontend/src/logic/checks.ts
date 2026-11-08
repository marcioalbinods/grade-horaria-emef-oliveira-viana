// Verificações dos dados antes da montagem da grade.
import type { PageId } from '../store';
import type { AppData } from '../types';
import { className, indexData, toMinutes } from './util';
import { jeifInfo } from './jeif';
import { workloadReport } from './workload';

export type IssueCategory = 'cadastro' | 'matematica' | 'pendencia' | 'aviso';

export interface Issue {
  category: IssueCategory;
  message: string;
  suggestion?: string;
  page?: PageId;
  param?: string;
}

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  cadastro: 'Erro de cadastro',
  matematica: 'Incompatibilidade matemática',
  pendencia: 'Informação pendente',
  aviso: 'Aviso',
};

export function isBlocking(i: Issue) {
  return i.category === 'cadastro' || i.category === 'matematica';
}

export function checkData(data: AppData): Issue[] {
  const out: Issue[] = [];
  const ix = indexData(data);
  const D = data.school.days.length;
  const add = (category: IssueCategory, message: string, suggestion?: string, page?: PageId, param?: string) =>
    out.push({ category, message, suggestion, page, param });

  if (!data.school.name.trim()) add('pendencia', 'O nome da escola não foi informado.', undefined, 'escola');
  if (D === 0) add('cadastro', 'Nenhum dia letivo configurado.', 'Selecione os dias letivos.', 'escola');

  // ---- períodos
  for (const p of data.periods) {
    if (!p.slots.length) add('cadastro', `O período ${p.name} não possui aulas.`, 'Informe a quantidade de aulas diárias.', 'periodos');
    const missing = p.slots.filter((s) => !s.start || !s.end).length;
    if (missing) add('pendencia', `O período ${p.name} tem ${missing} aula(s) sem horário de início/término.`,
      'Configure os horários reais em "Cadastro de períodos". Sem eles, os relatórios mostram apenas a ordem das aulas.', 'periodos');
    let last = -1;
    p.slots.forEach((s, i) => {
      const a = toMinutes(s.start), b = toMinutes(s.end);
      if (a == null || b == null) return;
      if (b <= a) add('cadastro', `${p.name}: a ${i + 1}ª aula termina antes de começar.`, undefined, 'periodos');
      if (a < last) add('cadastro', `${p.name}: a ${i + 1}ª aula começa antes do fim da aula anterior.`, undefined, 'periodos');
      last = b;
    });
  }

  // ---- turmas
  for (const pg of data.pending) {
    const g = ix.grade.get(pg.gradeId), p = ix.period.get(pg.periodId);
    add('pendencia', `${g?.name ?? 'Série'} (${p?.name ?? '?'}): quantidade de turmas pendente de informação.`,
      'Informe a quantidade de turmas em "Cadastro de turmas". Enquanto isso, essas turmas não entram na grade.', 'turmas');
  }
  if (!data.classes.length) add('pendencia', 'Nenhuma turma cadastrada.', undefined, 'turmas');
  for (const c of data.classes) {
    const p = ix.period.get(c.periodId);
    const cn = className(data, c);
    if (!p) { add('cadastro', `A turma ${cn} não possui período válido.`, undefined, 'turmas'); continue; }
    if (!ix.grade.get(c.gradeId)) add('cadastro', `A turma ${cn} não possui ano/série válido.`, undefined, 'turmas');
    const n = p.slots.length;
    const daily = c.dailyMax != null ? Math.min(c.dailyMax, n) : n;
    const blocked = new Set(c.blocked.map(([d, s]) => `${d}|${s}`));
    let cap = 0;
    for (let d = 0; d < D; d++) {
      let free = 0;
      for (let s = 0; s < n; s++) if (!blocked.has(`${d}|${s}`)) free++;
      cap += Math.min(daily, free);
    }
    if (c.weeklyLessons > D * n)
      add('matematica', `A turma ${cn} tem ${c.weeklyLessons} aulas semanais, mas o período ${p.name} só tem ${D * n} horários.`,
        'Corrija a quantidade de aulas semanais.', 'turmas');
    const asg = data.assignments.filter((a) => a.classId === c.id);
    const total = asg.reduce((s, a) => s + a.lessons, 0);
    if (!asg.length) add('pendencia', `A turma ${cn} não possui matriz curricular.`, 'Cadastre as disciplinas, professores e aulas da turma.', 'matriz', c.id);
    else if (total < c.weeklyLessons)
      add('pendencia', `A matriz da turma ${cn} soma ${total} de ${c.weeklyLessons} aulas semanais.`,
        'Complete a matriz curricular ou ajuste a quantidade de aulas semanais da turma.', 'matriz', c.id);
    if (total > c.weeklyLessons)
      add('cadastro', `A matriz da turma ${cn} soma ${total} aulas, acima das ${c.weeklyLessons} aulas semanais da turma.`,
        'Reduza as aulas na matriz ou aumente a carga semanal da turma.', 'matriz', c.id);
    if (total > cap)
      add('matematica', `A turma ${cn} precisa de ${total} aulas, mas só há ${cap} horários disponíveis (considerando bloqueios e limite diário).`,
        'Libere horários bloqueados ou aumente o limite diário da turma.', 'turmas');
  }

  // ---- disciplinas e atribuições
  if (!data.subjects.length) add('pendencia', 'Nenhuma disciplina cadastrada.', undefined, 'matriz');
  for (const a of data.assignments) {
    const c = ix.cls.get(a.classId);
    const s = ix.subject.get(a.subjectId);
    const cn = className(data, c);
    if (!c || !s) { add('cadastro', 'Existe atribuição com turma ou disciplina removida.', undefined, 'matriz'); continue; }
    if (!a.teacherId) {
      add('cadastro', `${s.name} na turma ${cn} está sem professor.`, 'Selecione o professor na matriz curricular.', 'matriz', c.id);
      continue;
    }
    const t = ix.teacher.get(a.teacherId);
    if (!t) { add('cadastro', `${s.name} na turma ${cn} referencia professor removido.`, undefined, 'matriz', c.id); continue; }
    if (a.lessons <= 0) add('aviso', `${s.name} na turma ${cn} está com 0 aulas.`, undefined, 'matriz', c.id);
    if (!t.periodIds.includes(c.periodId)) {
      const p = ix.period.get(c.periodId);
      add('cadastro', `${t.name} leciona ${s.name} na turma ${cn} (${p?.name}), mas não está cadastrado(a) para trabalhar nesse período.`,
        `Inclua o período ${p?.name} no cadastro de ${t.name} ou troque o professor.`, 'professores', t.id);
    }
    if (a.maxPerDay != null && a.maxPerDay * D < a.lessons)
      add('matematica', `${s.name} na turma ${cn}: ${a.lessons} aulas com máximo de ${a.maxPerDay} por dia não cabem em ${D} dias.`,
        'Aumente o máximo de aulas por dia.', 'matriz', c.id);
  }
  const dupKey = new Map<string, number>();
  for (const a of data.assignments) {
    const k = `${a.classId}|${a.subjectId}|${a.teacherId}`;
    dupKey.set(k, (dupKey.get(k) ?? 0) + 1);
  }
  for (const [k, n] of dupKey) if (n > 1) {
    const [cid, sid] = k.split('|');
    add('aviso', `A disciplina ${ix.subject.get(sid)?.name} aparece ${n} vezes com o mesmo professor na turma ${className(data, ix.cls.get(cid))}.`,
      'Considere unir as linhas da matriz.', 'matriz', cid);
  }

  // ---- professores
  for (const t of data.teachers) {
    if (!t.name.trim()) add('cadastro', 'Existe professor sem nome.', undefined, 'professores', t.id);
    if (!t.periodIds.length) add('cadastro', `${t.name} não possui período de trabalho.`, 'Informe em qual período o professor trabalha.', 'professores', t.id);
    if (!t.availability.workDays.length) add('cadastro', `${t.name} não possui dias de trabalho.`, undefined, 'disponibilidade', t.id);
    const mine = data.assignments.filter((a) => a.teacherId === t.id);
    const acts = data.activities.filter((r) => r.teacherId === t.id && r.inGrid);
    const lessons = mine.reduce((s, a) => s + a.lessons, 0);
    const need = lessons + acts.reduce((s, r) => s + r.qty, 0);
    const av = t.availability;
    const jeif = jeifInfo(data, t);
    if (jeif.invalid) add('cadastro', `${t.name}: ${jeif.invalid}`, 'Corrija o horário do agrupamento em "Configuração da escola".', 'escola');
    if (jeif.missingTimes.length)
      add('cadastro', `${t.name} faz JEIF (${jeif.group?.name}), mas o(s) período(s) ${jeif.missingTimes.join(', ')} não tem(têm) horários de início/término configurados. Sem eles, não é possível saber quais aulas coincidem com a JEIF.`,
        'Configure os horários reais das aulas em "Cadastro de períodos".', 'periodos');
    const unav = new Set([...av.unavailable, ...jeif.blocked]);
    let avail = 0;
    for (const pid of t.periodIds) {
      const p = ix.period.get(pid);
      if (!p) continue;
      const lo = av.entry[pid] ?? 0, hi = av.exit[pid] ?? p.slots.length - 1;
      for (const d of av.workDays) if (d < D)
        for (let s = lo; s <= hi && s < p.slots.length; s++) if (!unav.has(`${pid}|${d}|${s}`)) avail++;
    }
    if (need > avail)
      add('matematica', `${t.name} precisa de ${need} horários (aulas + atividades na grade), mas tem apenas ${avail} horários disponíveis.`,
        'Reduza atribuições/atividades ou amplie a disponibilidade.', 'disponibilidade', t.id);
    if (av.maxDaily?.hard && lessons > av.maxDaily.value * av.workDays.length)
      add('matematica', `${t.name} tem ${lessons} aulas, mas o limite obrigatório de ${av.maxDaily.value} por dia em ${av.workDays.length} dia(s) permite só ${av.maxDaily.value * av.workDays.length}.`,
        'Aumente o limite diário ou transforme-o em preferência.', 'disponibilidade', t.id);
    if (!mine.length && !acts.length) add('aviso', `${t.name} não possui aulas atribuídas.`, undefined, 'professores', t.id);
    const wr = workloadReport(data, t);
    for (const dv of wr.divergences) add('aviso', `${t.name} — ${dv}`, 'Verifique o demonstrativo em "Cargas horárias".', 'cargas', t.id);
    for (const a of mine) {
      const c = ix.cls.get(a.classId);
      if (!c || !t.periodIds.includes(c.periodId)) continue;
      const p = ix.period.get(c.periodId)!;
      const blocked = new Set(c.blocked.map(([d, s]) => `${d}|${s}`));
      const lo = av.entry[c.periodId] ?? 0, hi = av.exit[c.periodId] ?? p.slots.length - 1;
      let common = 0;
      for (const d of av.workDays) {
        if (d >= D) continue;
        let k = 0;
        for (let s = lo; s <= hi && s < p.slots.length; s++)
          if (!blocked.has(`${d}|${s}`) && !unav.has(`${c.periodId}|${d}|${s}`)) k++;
        if (a.maxPerDay != null) k = Math.min(k, a.maxPerDay);
        if (c.dailyMax != null) k = Math.min(k, c.dailyMax);
        common += k;
      }
      if (a.lessons > common)
        add('matematica', `${t.name} precisa dar ${a.lessons} aulas na turma ${className(data, c)}, mas só existem ${common} horários compatíveis entre o professor e a turma.`,
          'Amplie a disponibilidade do professor ou libere horários da turma.', 'disponibilidade', t.id);
    }
  }

  // ---- atividades
  for (const r of data.activities) {
    const t = ix.teacher.get(r.teacherId);
    if (!t) { add('cadastro', `Atividade ${r.label} sem professor.`, undefined, 'atividades'); continue; }
    const p = ix.period.get(r.periodId);
    if (!p) { add('cadastro', `A atividade ${r.label} de ${t.name} não possui período válido.`, undefined, 'atividades', t.id); continue; }
    if (!r.inGrid) continue;
    if (!t.periodIds.includes(r.periodId))
      add('cadastro', `A atividade ${r.label} de ${t.name} está no período ${p.name}, em que o professor não trabalha.`, undefined, 'atividades', t.id);
    if (r.mode === 'fixo' && r.fixed.length !== r.qty)
      add('cadastro', `A atividade ${r.label} de ${t.name} tem horário fixo, mas ${r.fixed.length} horário(s) marcado(s) para ${r.qty} unidade(s).`,
        'Marque exatamente a quantidade de horários fixos.', 'atividades', t.id);
    if (r.classId) {
      const c = ix.cls.get(r.classId);
      if (c && c.periodId !== r.periodId)
        add('cadastro', `A atividade ${r.label} de ${t.name} está ligada a uma turma de outro período.`, undefined, 'atividades', t.id);
      if (c && c.freePolicy !== 'complementar')
        add('cadastro', `A atividade ${r.label} de ${t.name} ocupa horários da turma ${className(data, c)}, mas essa turma não permite atividades complementares nos horários livres.`,
          'Em "Cadastro de turmas", configure os horários livres da turma como "podem receber atividades complementares".', 'turmas');
    }
    if (r.mode === 'flexivel') {
      const n = p.slots.length;
      let slots = r.slots.length ? r.slots.filter((s) => s < n) : Array.from({ length: n }, (_, i) => i);
      if (r.position === 'meio') slots = slots.filter((s) => s !== 0 && s !== n - 1);
      const days = (r.days.length ? r.days : t.availability.workDays).filter((d) => t.availability.workDays.includes(d) && d < D);
      const unav = new Set([...t.availability.unavailable, ...jeifInfo(data, t).blocked]);
      let cnt = 0;
      for (const d of days) {
        let k = slots.filter((s) => !unav.has(`${r.periodId}|${d}|${s}`)).length;
        if (r.maxPerDay != null) k = Math.min(k, r.maxPerDay);
        cnt += k;
      }
      if (r.qty > cnt)
        add('matematica', `A atividade ${r.label} de ${t.name} precisa de ${r.qty} horário(s), mas suas regras só permitem ${cnt}.`,
          'Amplie os dias/horários permitidos ou o máximo por dia.', 'atividades', t.id);
    }
  }
  return out;
}
