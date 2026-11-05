// Métricas e pontuação de uma grade. A pontuação serve para COMPARAR grades
// geradas a partir dos mesmos dados; não é garantia absoluta de qualidade.
import type { AppData, Entry, StrategyId } from '../types';
import { className, indexData } from './util';

export interface TeacherStats {
  teacherId: string;
  lessons: number;
  activities: Record<string, number>; // HA, CCH, HL, OUTRA (na grade)
  gaps: number;
  days: number;
  shifts: number; // turnos de comparecimento (dia + período)
  isolated: number;
  daysList: number[];
  minDays: number; // limite inferior teórico de dias
}

export interface PreferenceResult {
  who: string;
  text: string;
  met: boolean;
  detail?: string;
}

export interface Criterion {
  id: 'janelas' | 'dias' | 'distribuicao' | 'aproveitamento' | 'preferencias';
  label: string;
  score: number;
  explanation: string;
}

export interface Metrics {
  teachers: Map<string, TeacherStats>;
  totalGaps: number;
  totalDays: number;
  totalShifts: number;
  isolated: number;
  distributionExcess: number;
  triples: number;
  classHoles: number;
  freeSlots: number;
  preferences: PreferenceResult[];
  criteria: Criterion[];
  overall: number;
}

export const STRATEGIES: { id: StrategyId; label: string; description: string }[] = [
  { id: 'janelas', label: 'Menos janelas', description: 'Prioriza reduzir horários vagos entre as aulas dos professores.' },
  { id: 'dias', label: 'Menos dias trabalhados', description: 'Concentra a jornada dos professores em menos dias e menos turnos.' },
  { id: 'distribuicao', label: 'Melhor distribuição das disciplinas', description: 'Espalha as aulas de cada disciplina ao longo da semana e evita 3 aulas seguidas da mesma disciplina.' },
  { id: 'aproveitamento', label: 'Melhor aproveitamento dos horários', description: 'Evita horários vagos no meio do dia das turmas e aulas isoladas de professores.' },
  { id: 'preferencias', label: 'Maior atendimento às preferências', description: 'Dá mais peso às preferências individuais cadastradas.' },
  { id: 'equilibrada', label: 'Solução equilibrada', description: 'Equilibra todos os critérios.' },
];

/** Peso de cada critério na nota geral, por estratégia (soma = 100). */
export const CRITERIA_WEIGHTS: Record<string, Record<Criterion['id'], number>> = {
  janelas: { janelas: 50, dias: 10, distribuicao: 15, aproveitamento: 15, preferencias: 10 },
  dias: { janelas: 15, dias: 50, distribuicao: 10, aproveitamento: 15, preferencias: 10 },
  distribuicao: { janelas: 10, dias: 10, distribuicao: 50, aproveitamento: 15, preferencias: 15 },
  aproveitamento: { janelas: 15, dias: 10, distribuicao: 15, aproveitamento: 50, preferencias: 10 },
  preferencias: { janelas: 15, dias: 10, distribuicao: 10, aproveitamento: 15, preferencias: 50 },
  equilibrada: { janelas: 20, dias: 20, distribuicao: 20, aproveitamento: 20, preferencias: 20 },
};

export function computeMetrics(data: AppData, entries: Entry[], strategy = 'equilibrada'): Metrics {
  const ix = indexData(data);
  const D = data.school.days.length;
  const occ = new Map<string, Set<number>>(); // teacher|period|day -> slots
  const lessonsSlots = new Map<string, Set<number>>();
  const stats = new Map<string, TeacherStats>();
  const classOcc = new Map<string, Set<number>>(); // class|day -> slots
  const assignDay = new Map<string, Map<number, number[]>>();

  const st = (tid: string) => {
    if (!stats.has(tid))
      stats.set(tid, { teacherId: tid, lessons: 0, activities: {}, gaps: 0, days: 0, shifts: 0, isolated: 0, daysList: [], minDays: 0 });
    return stats.get(tid)!;
  };
  for (const t of data.teachers) st(t.id);

  for (const e of entries) {
    let tid: string | null = null;
    let cid: string | null = null;
    if (e.kind === 'aula') {
      const a = ix.assignment.get(e.refId);
      if (!a) continue;
      tid = a.teacherId;
      cid = a.classId;
      if (!assignDay.has(a.id)) assignDay.set(a.id, new Map());
      const m = assignDay.get(a.id)!;
      m.set(e.day, [...(m.get(e.day) ?? []), e.slot]);
      if (tid) {
        st(tid).lessons++;
        const k = `${tid}|${e.periodId}|${e.day}`;
        if (!lessonsSlots.has(k)) lessonsSlots.set(k, new Set());
        lessonsSlots.get(k)!.add(e.slot);
      }
    } else {
      const r = ix.activity.get(e.refId);
      if (!r) continue;
      tid = r.teacherId;
      cid = r.classId;
      const s = st(tid);
      s.activities[r.type] = (s.activities[r.type] ?? 0) + 1;
    }
    if (tid) {
      const k = `${tid}|${e.periodId}|${e.day}`;
      if (!occ.has(k)) occ.set(k, new Set());
      occ.get(k)!.add(e.slot);
    }
    if (cid) {
      const k = `${cid}|${e.day}`;
      if (!classOcc.has(k)) classOcc.set(k, new Set());
      classOcc.get(k)!.add(e.slot);
    }
  }

  // professores
  const daysOf = new Map<string, Set<number>>();
  for (const [k, slots] of occ) {
    const [tid, , d] = k.split('|');
    const s = st(tid);
    const arr = [...slots];
    s.gaps += Math.max(...arr) - Math.min(...arr) + 1 - arr.length;
    s.shifts++;
    if (arr.length === 1) s.isolated++;
    if (!daysOf.has(tid)) daysOf.set(tid, new Set());
    daysOf.get(tid)!.add(Number(d));
  }
  let lbDays = 0;
  for (const s of stats.values()) {
    const ds = daysOf.get(s.teacherId) ?? new Set();
    s.days = ds.size;
    s.daysList = [...ds].sort();
    const t = ix.teacher.get(s.teacherId);
    const cap = (t?.periodIds ?? []).reduce((acc, pid) => acc + (ix.period.get(pid)?.slots.length ?? 0), 0);
    const total = s.lessons + Object.values(s.activities).reduce((a, b) => a + b, 0);
    let perDay = cap || 1;
    if (t?.availability.maxDaily?.hard) perDay = Math.min(perDay, t.availability.maxDaily.value + Object.values(s.activities).reduce((a, b) => a + b, 0));
    s.minDays = total ? Math.ceil(total / perDay) : 0;
    lbDays += s.minDays;
  }
  const all = [...stats.values()];
  const totalGaps = all.reduce((a, s) => a + s.gaps, 0);
  const totalDays = all.reduce((a, s) => a + s.days, 0);
  const totalShifts = all.reduce((a, s) => a + s.shifts, 0);
  const isolated = all.reduce((a, s) => a + s.isolated, 0);
  const occupied = [...occ.values()].reduce((a, s) => a + s.size, 0);

  // distribuição das disciplinas
  let excess = 0, triples = 0, totalLessons = 0;
  const prefs: PreferenceResult[] = [];
  for (const a of data.assignments) {
    const m = assignDay.get(a.id);
    if (!m) continue;
    const t = a.teacherId ? ix.teacher.get(a.teacherId) : undefined;
    const daysAv = t ? t.availability.workDays.filter((d) => d < D).length : D;
    let target = Math.ceil(a.lessons / Math.max(1, daysAv));
    if (a.double === 'preferir') target = Math.max(target, 2);
    let pairs = 0;
    for (const slots of m.values()) {
      totalLessons += slots.length;
      excess += Math.max(0, slots.length - target);
      const set = new Set(slots);
      if (target <= 2) for (const s of slots) if (set.has(s + 1) && set.has(s + 2)) triples++;
      const sorted = [...set].sort((x, y) => x - y);
      for (let i = 0; i < sorted.length - 1; i++) if (sorted[i + 1] === sorted[i] + 1) { pairs++; i++; }
    }
    if (a.double === 'preferir') {
      const want = Math.floor(a.lessons / 2);
      const c = ix.cls.get(a.classId);
      prefs.push({
        who: `${ix.subject.get(a.subjectId)?.name} – ${className(data, c)}`,
        text: 'Preferência por aulas geminadas (duplas)',
        met: pairs >= want,
        detail: `${pairs} de ${want} pares formados`,
      });
    }
  }

  // turmas: horários vagos no meio do dia e posição dos livres
  let holes = 0, freeSlots = 0, classDays = 0;
  for (const c of data.classes) {
    const p = ix.period.get(c.periodId);
    if (!p) continue;
    const n = p.slots.length;
    let posOk = true;
    for (let d = 0; d < D; d++) {
      const sl = classOcc.get(`${c.id}|${d}`);
      freeSlots += n - (sl?.size ?? 0);
      if (!sl || !sl.size) continue;
      classDays++;
      const arr = [...sl];
      holes += Math.max(...arr) - Math.min(...arr) + 1 - arr.length;
      if (c.freePosition === 'fim' && Math.max(...arr) !== sl.size - 1) posOk = false;
      if (c.freePosition === 'inicio' && Math.min(...arr) !== n - sl.size) posOk = false;
    }
    if (c.freePosition !== 'qualquer' && c.weeklyLessons < n * D)
      prefs.push({
        who: `Turma ${className(data, c)}`,
        text: c.freePosition === 'fim' ? 'Horários livres no final do dia' : 'Horários livres no início do dia',
        met: posOk,
      });
  }

  // preferências dos professores
  for (const t of data.teachers) {
    const s = st(t.id);
    const av = t.availability;
    if (!s.lessons && !Object.keys(s.activities).length) continue;
    if (av.avoidGaps) prefs.push({ who: t.name, text: 'Evitar janelas', met: s.gaps === 0, detail: `${s.gaps} janela(s)` });
    if (av.preferConsecutive) prefs.push({ who: t.name, text: 'Aulas consecutivas (sem aulas isoladas)', met: s.isolated === 0 && s.gaps === 0, detail: `${s.isolated} turno(s) com aula isolada, ${s.gaps} janela(s)` });
    if (av.preferredDays.length) {
      const out = s.daysList.filter((d) => !av.preferredDays.includes(d));
      prefs.push({ who: t.name, text: `Concentrar nos dias: ${av.preferredDays.map((d) => data.school.days[d]).join(', ')}`, met: out.length === 0, detail: out.length ? `também trabalha: ${out.map((d) => data.school.days[d]).join(', ')}` : undefined });
    }
    if (av.maxDays != null) prefs.push({ who: t.name, text: `No máximo ${av.maxDays} dia(s) de trabalho`, met: s.days <= av.maxDays, detail: `${s.days} dia(s)` });
    if (av.avoid.length) {
      let hit = 0;
      for (const k of av.avoid) {
        const [p, d, sl] = k.split('|');
        if (occ.get(`${t.id}|${p}|${d}`)?.has(Number(sl))) hit++;
      }
      prefs.push({ who: t.name, text: 'Evitar horários marcados como "prefiro não"', met: hit === 0, detail: `${hit} horário(s) ocupado(s)` });
    }
    if (av.maxDaily && !av.maxDaily.hard) {
      let worst = 0;
      for (let d = 0; d < D; d++) {
        let n = 0;
        for (const pid of t.periodIds) n += lessonsSlots.get(`${t.id}|${pid}|${d}`)?.size ?? 0;
        worst = Math.max(worst, n);
      }
      prefs.push({ who: t.name, text: `Até ${av.maxDaily.value} aulas por dia (preferência)`, met: worst <= av.maxDaily.value, detail: `máximo atingido: ${worst}` });
    }
    if (av.maxConsecutive && !av.maxConsecutive.hard) {
      let worst = 0;
      for (const [k, sl] of lessonsSlots) {
        if (!k.startsWith(t.id + '|')) continue;
        let run = 0;
        const max = Math.max(...sl);
        for (let x = 0; x <= max; x++) { run = sl.has(x) ? run + 1 : 0; worst = Math.max(worst, run); }
      }
      prefs.push({ who: t.name, text: `Até ${av.maxConsecutive.value} aulas consecutivas (preferência)`, met: worst <= av.maxConsecutive.value, detail: `maior sequência: ${worst}` });
    }
  }

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const met = prefs.filter((p) => p.met).length;
  const criteria: Criterion[] = [
    {
      id: 'janelas', label: 'Janelas dos professores',
      score: clamp(100 * (1 - totalGaps / Math.max(1, totalGaps + occupied))),
      explanation: `${totalGaps} janela(s) no total. Nota = parte do tempo de permanência dos professores na escola que não é janela.`,
    },
    {
      id: 'dias', label: 'Concentração da jornada',
      score: clamp(100 * (lbDays / Math.max(1, totalDays))),
      explanation: `${totalDays} dias de comparecimento (${totalShifts} turnos). O mínimo teórico seria ${lbDays} dias. Nota = mínimo teórico ÷ dias utilizados.`,
    },
    {
      id: 'distribuicao', label: 'Distribuição das disciplinas',
      score: clamp(100 * (1 - (excess + triples) / Math.max(1, totalLessons))),
      explanation: `${excess} aula(s) acima do ideal por dia e ${triples} sequência(s) de 3 aulas seguidas da mesma disciplina.`,
    },
    {
      id: 'aproveitamento', label: 'Aproveitamento dos horários',
      score: clamp(100 * (1 - (holes + isolated) / Math.max(1, classDays + totalShifts))),
      explanation: `${holes} horário(s) vago(s) no meio do dia das turmas e ${isolated} turno(s) de professor com uma única aula/atividade.`,
    },
    {
      id: 'preferencias', label: 'Preferências atendidas',
      score: prefs.length ? (100 * met) / prefs.length : 100,
      explanation: prefs.length ? `${met} de ${prefs.length} preferência(s) atendida(s).` : 'Nenhuma preferência individual cadastrada.',
    },
  ];
  const w = CRITERIA_WEIGHTS[strategy] ?? CRITERIA_WEIGHTS.equilibrada;
  const overall = criteria.reduce((a, c) => a + c.score * w[c.id], 0) / 100;
  return {
    teachers: stats, totalGaps, totalDays, totalShifts, isolated, distributionExcess: excess, triples,
    classHoles: holes, freeSlots, preferences: prefs, criteria, overall,
  };
}
