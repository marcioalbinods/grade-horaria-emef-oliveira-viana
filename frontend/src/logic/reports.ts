// Montagem dos relatórios (tabelas) a partir dos dados e da grade.
import type { AppData, Entry, Schedule } from '../types';
import { CATEGORY_LABELS, checkData } from './checks';
import { validateSchedule } from './conflicts';
import { computeMetrics } from './metrics';
import { ACTIVITY_LABELS, className, indexData, slotTime, sortedClasses } from './util';
import { fmtNumber, workloadReport } from './workload';
import { jeifInfo, jeifLabel } from './jeif';

export interface ReportTable {
  title: string;
  subtitle?: string;
  head: string[];
  rows: (string | number)[][];
  colors?: (string | null)[][];
  grid?: boolean; // tabela de grade semanal (formatação especial)
}

export interface Report {
  id: string;
  title: string;
  tables: ReportTable[];
}

export const REPORTS: { id: string; title: string; needsSchedule: boolean; description: string }[] = [
  { id: 'grade-turma', title: 'Grade semanal por turma', needsSchedule: true, description: 'Uma tabela por turma, com disciplina e professor em cada horário.' },
  { id: 'grade-professor', title: 'Grade semanal por professor', needsSchedule: true, description: 'Uma tabela por professor, com turmas, H.A., CCH, HL e janelas.' },
  { id: 'distribuicao', title: 'Distribuição de disciplinas', needsSchedule: true, description: 'Quantidade de aulas de cada disciplina por dia da semana, em cada turma.' },
  { id: 'carga', title: 'Carga horária individual', needsSchedule: false, description: 'Demonstrativo da composição da jornada de cada professor, com divergências.' },
  { id: 'aulas', title: 'Quantidade de aulas por professor', needsSchedule: false, description: 'Aulas atribuídas e aulas efetivamente alocadas na grade.' },
  { id: 'ha', title: 'Quantidade de H.A.', needsSchedule: false, description: 'H.A. declarada, cadastrada e alocada por professor.' },
  { id: 'cch', title: 'Quantidade de CCH', needsSchedule: false, description: 'CCH declarada, cadastrada e alocada por professor.' },
  { id: 'hl', title: 'Quantidade de HL', needsSchedule: false, description: 'HL declarada, cadastrada e alocada por professor.' },
  { id: 'janelas', title: 'Quantidade de janelas', needsSchedule: true, description: 'Janelas (horários vagos entre compromissos) de cada professor.' },
  { id: 'dias', title: 'Dias trabalhados por professor', needsSchedule: true, description: 'Dias e turnos em que cada professor comparece.' },
  { id: 'livres', title: 'Horários livres por turma', needsSchedule: true, description: 'Horários sem aula em cada turma e como são tratados.' },
  { id: 'pendencias', title: 'Conflitos e pendências', needsSchedule: false, description: 'Problemas de cadastro, incompatibilidades e conflitos da grade.' },
];

const FREE_LABEL = { livre: 'Livre', reservado: 'Reservado', complementar: 'Livre (complementar)' } as const;

export function buildReport(data: AppData, schedule: Schedule | null, id: string): Report {
  const meta = REPORTS.find((r) => r.id === id)!;
  const ix = indexData(data);
  const entries: Entry[] = schedule?.entries ?? [];
  const days = data.school.days;
  const tables: ReportTable[] = [];
  const metrics = schedule ? computeMetrics(data, entries, schedule.strategy) : null;

  const teacherAct = (tid: string, type: string) => data.activities.filter((r) => r.teacherId === tid && r.type === type);
  const placed = (tid: string, type: string) =>
    entries.filter((e) => e.kind === 'atividade' && ix.activity.get(e.refId)?.teacherId === tid && ix.activity.get(e.refId)?.type === type).length;

  switch (id) {
    case 'grade-turma':
      for (const c of sortedClasses(data)) {
        const p = ix.period.get(c.periodId);
        if (!p) continue;
        const rows: (string | number)[][] = [];
        const colors: (string | null)[][] = [];
        p.slots.forEach((_, s) => {
          const row: (string | number)[] = [`${s + 1}ª`, slotTime(p, s)];
          const col: (string | null)[] = [null, null];
          days.forEach((_, d) => {
            const here = entries.filter((e) => e.day === d && e.slot === s && e.periodId === p.id);
            const lesson = here.find((e) => e.kind === 'aula' && ix.assignment.get(e.refId)?.classId === c.id);
            const act = here.find((e) => e.kind === 'atividade' && ix.activity.get(e.refId)?.classId === c.id);
            if (lesson) {
              const a = ix.assignment.get(lesson.refId)!;
              const sub = ix.subject.get(a.subjectId);
              row.push(`${sub?.name ?? '?'}\n${a.teacherId ? ix.teacher.get(a.teacherId)?.name ?? '' : 'sem professor'}`);
              col.push(sub?.color ?? null);
            } else if (act) {
              const r = ix.activity.get(act.refId)!;
              row.push(`${r.label || ACTIVITY_LABELS[r.type]}\n${ix.teacher.get(r.teacherId)?.name ?? ''}`);
              col.push('#94a3b8');
            } else {
              row.push(c.blocked.some(([bd, bs]) => bd === d && bs === s) ? 'Bloqueado' : FREE_LABEL[c.freePolicy]);
              col.push(null);
            }
          });
          rows.push(row);
          colors.push(col);
          const br = p.breaks.find((b) => b.afterSlot === s);
          if (br) {
            rows.push(['', `${br.start}–${br.end}`, ...days.map(() => br.label || 'Intervalo')]);
            colors.push(days.map(() => null).concat([null, null]));
          }
        });
        const g = ix.grade.get(c.gradeId);
        tables.push({
          title: `Turma ${className(data, c)}`,
          subtitle: `${p.name} · ${g?.name ?? ''} · ${c.weeklyLessons} aulas semanais`,
          head: ['Aula', 'Horário', ...days], rows, colors, grid: true,
        });
      }
      break;
    case 'grade-professor':
      for (const t of [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
        const s = metrics?.teachers.get(t.id);
        const wr = workloadReport(data, t);
        const jf = jeifInfo(data, t);
        for (const pid of t.periodIds) {
          const p = ix.period.get(pid);
          if (!p) continue;
          const rows: (string | number)[][] = [];
          const colors: (string | null)[][] = [];
          const span = days.map((_, d) => {
            const sl = entries.filter((e) => e.day === d && e.periodId === pid && entryTeacher(ix, e) === t.id).map((e) => e.slot);
            return sl.length ? [Math.min(...sl), Math.max(...sl)] : null;
          });
          p.slots.forEach((_, sIdx) => {
            const row: (string | number)[] = [`${sIdx + 1}ª`, slotTime(p, sIdx)];
            const col: (string | null)[] = [null, null];
            days.forEach((_, d) => {
              const e = entries.find((x) => x.day === d && x.slot === sIdx && x.periodId === pid && entryTeacher(ix, x) === t.id);
              if (!e) {
                const sp = span[d];
                row.push(jf.blocked.has(`${pid}|${d}|${sIdx}`) ? 'JEIF' : sp && sIdx > sp[0] && sIdx < sp[1] ? 'Janela' : '');
                col.push(null);
              } else if (e.kind === 'aula') {
                const a = ix.assignment.get(e.refId)!;
                const sub = ix.subject.get(a.subjectId);
                row.push(`${className(data, ix.cls.get(a.classId))}\n${sub?.name ?? ''}`);
                col.push(sub?.color ?? null);
              } else {
                const r = ix.activity.get(e.refId)!;
                row.push(r.label || ACTIVITY_LABELS[r.type]);
                col.push('#94a3b8');
              }
            });
            rows.push(row);
            colors.push(col);
          });
          const acts = s?.activities ?? {};
          tables.push({
            title: `${t.name} — ${p.name}`,
            subtitle: `Aulas: ${s?.lessons ?? 0} · H.A.: ${acts.HA ?? 0} · CCH: ${acts.CCH ?? 0} · HL: ${acts.HL ?? 0} · Janelas: ${s?.gaps ?? 0} · Dias: ${s?.days ?? 0} · Carga contabilizada: ${fmtNumber(wr.computedTotal)} ${wr.unit} · JEIF: ${jeifLabel(jf.group, days)}`,
            head: ['Aula', 'Horário', ...days], rows, colors, grid: true,
          });
        }
      }
      break;
    case 'distribuicao':
      for (const c of sortedClasses(data)) {
        const asg = data.assignments.filter((a) => a.classId === c.id);
        if (!asg.length) continue;
        tables.push({
          title: `Turma ${className(data, c)}`,
          head: ['Disciplina', 'Professor', 'Aulas', ...days],
          rows: asg.map((a) => [
            ix.subject.get(a.subjectId)?.name ?? '?',
            a.teacherId ? ix.teacher.get(a.teacherId)?.name ?? '?' : '(sem professor)',
            a.lessons,
            ...days.map((_, d) => entries.filter((e) => e.kind === 'aula' && e.refId === a.id && e.day === d).length),
          ]),
        });
      }
      break;
    case 'carga': {
      const rows: (string | number)[][] = [];
      for (const t of [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
        const wr = workloadReport(data, t);
        for (const l of wr.lines)
          rows.push([t.name, l.label, l.declared ?? '—', l.configured, l.counts ? 'Sim' : 'Não', fmtNumber(l.weight), fmtNumber(l.value)]);
        rows.push([t.name, 'TOTAL contabilizado', wr.declaredTotal ?? '—', '', '', '', fmtNumber(wr.computedTotal)]);
        rows.push([t.name, 'Divergências', wr.divergences.length ? wr.divergences.join(' ') : 'Nenhuma', '', '', '', '']);
      }
      tables.push({
        title: 'Carga horária individual',
        subtitle: `Unidade: ${data.school.workload.unit}`,
        head: ['Professor', 'Componente', 'Declarado', 'Cadastrado/atribuído', 'Contabiliza?', 'Peso', 'Valor na jornada'],
        rows,
      });
      break;
    }
    case 'aulas':
      tables.push({
        title: 'Quantidade de aulas por professor',
        head: ['Professor', 'Aulas declaradas', 'Aulas atribuídas', 'Aulas na grade', 'Turmas atendidas'],
        rows: sortedTeachers(data).map((t) => {
          const mine = data.assignments.filter((a) => a.teacherId === t.id);
          return [
            t.name, t.workload.regular ?? '—', mine.reduce((s, a) => s + a.lessons, 0),
            schedule ? metrics?.teachers.get(t.id)?.lessons ?? 0 : '—',
            [...new Set(mine.map((a) => className(data, ix.cls.get(a.classId))))].join(', '),
          ];
        }),
      });
      break;
    case 'ha':
    case 'cch':
    case 'hl': {
      const type = id.toUpperCase() as 'HA' | 'CCH' | 'HL';
      const field = id as 'ha' | 'cch' | 'hl';
      tables.push({
        title: `Quantidade de ${ACTIVITY_LABELS[type]}`,
        head: ['Professor', 'Declarado', 'Cadastrado (regras)', 'Na grade (fora da grade não é alocado)', 'Alocado na grade'],
        rows: sortedTeachers(data).map((t) => {
          const acts = teacherAct(t.id, type);
          return [
            t.name, t.workload[field] ?? '—', acts.reduce((s, r) => s + r.qty, 0),
            acts.filter((r) => r.inGrid).reduce((s, r) => s + r.qty, 0),
            schedule ? placed(t.id, type) : '—',
          ];
        }),
      });
      break;
    }
    case 'janelas':
      tables.push({
        title: 'Quantidade de janelas por professor',
        head: ['Professor', 'Janelas', 'Turnos com aula isolada'],
        rows: sortedTeachers(data).map((t) => [t.name, metrics?.teachers.get(t.id)?.gaps ?? 0, metrics?.teachers.get(t.id)?.isolated ?? 0]),
      });
      break;
    case 'dias':
      tables.push({
        title: 'Dias trabalhados por professor',
        head: ['Professor', 'Dias', 'Turnos', 'Dias em que comparece'],
        rows: sortedTeachers(data).map((t) => {
          const s = metrics?.teachers.get(t.id);
          return [t.name, s?.days ?? 0, s?.shifts ?? 0, (s?.daysList ?? []).map((d) => days[d]).join(', ')];
        }),
      });
      break;
    case 'livres':
      tables.push({
        title: 'Horários livres por turma',
        head: ['Turma', 'Período', 'Aulas semanais', 'Horários do período', 'Horários livres', 'Tratamento', 'Horários livres (dia/aula)'],
        rows: sortedClasses(data).map((c) => {
          const p = ix.period.get(c.periodId);
          const n = p?.slots.length ?? 0;
          const used = new Set(entries.filter((e) => entryClass(ix, e) === c.id).map((e) => `${e.day}|${e.slot}`));
          const free: string[] = [];
          days.forEach((dn, d) => {
            for (let s = 0; s < n; s++) if (!used.has(`${d}|${s}`)) free.push(`${dn.slice(0, 3)} ${s + 1}ª`);
          });
          return [className(data, c), p?.name ?? '?', c.weeklyLessons, n * days.length, free.length,
            { livre: 'Permanecem livres', reservado: 'Reservados para atividades específicas', complementar: 'Podem receber atividades complementares' }[c.freePolicy],
            free.join(', ')];
        }),
      });
      break;
    case 'pendencias': {
      const rows: (string | number)[][] = checkData(data).map((i) => [CATEGORY_LABELS[i.category], i.message, i.suggestion ?? '']);
      if (schedule)
        for (const v of validateSchedule(data, entries))
          rows.push([v.severity === 'conflito' ? 'Conflito na grade' : 'Pendência na grade', v.message, '']);
      if (schedule && metrics)
        for (const p of metrics.preferences.filter((x) => !x.met))
          rows.push(['Preferência não atendida', `${p.who}: ${p.text}${p.detail ? ` (${p.detail})` : ''}`, '']);
      tables.push({ title: 'Conflitos e pendências', head: ['Tipo', 'Descrição', 'Sugestão'], rows: rows.length ? rows : [['—', 'Nenhum problema encontrado.', '']] });
      break;
    }
  }
  return { id, title: meta.title, tables };
}

function sortedTeachers(data: AppData) {
  return [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function entryTeacher(ix: ReturnType<typeof indexData>, e: Entry): string | null {
  return e.kind === 'aula' ? ix.assignment.get(e.refId)?.teacherId ?? null : ix.activity.get(e.refId)?.teacherId ?? null;
}
export function entryClass(ix: ReturnType<typeof indexData>, e: Entry): string | null {
  return e.kind === 'aula' ? ix.assignment.get(e.refId)?.classId ?? null : ix.activity.get(e.refId)?.classId ?? null;
}
