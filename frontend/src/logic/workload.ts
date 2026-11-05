// Demonstrativo da composição da jornada de cada professor.
import type { AppData, Teacher, WorkComponent } from '../types';

export interface WorkloadLine {
  component: WorkComponent;
  label: string;
  declared: number | null; // informado no cadastro
  configured: number; // atribuído (aulas) ou cadastrado em regras (atividades)
  counts: boolean;
  weight: number;
  value: number; // contribuição para a jornada, na unidade da escola
}

export interface WorkloadReport {
  lines: WorkloadLine[];
  computedTotal: number;
  declaredTotal: number | null;
  unit: string;
  divergences: string[];
  assignedLessons: number;
}

const LABELS: Record<WorkComponent, string> = {
  aula: 'Aulas regulares',
  HA: 'H.A. (Hora-Atividade)',
  CCH: 'CCH (Complementação de Carga Horária)',
  HL: 'HL',
  OUTRA: 'Outras atividades',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

export function workloadReport(data: AppData, t: Teacher): WorkloadReport {
  const cfg = data.school.workload;
  const assigned = data.assignments.filter((a) => a.teacherId === t.id).reduce((s, a) => s + a.lessons, 0);
  const acts = data.activities.filter((r) => r.teacherId === t.id);
  const sumType = (type: string) => acts.filter((r) => r.type === type).reduce((s, r) => s + r.qty, 0);
  const othersDeclared = t.workload.others.reduce((s, o) => s + (Number(o.qty) || 0), 0);
  const raw: [WorkComponent, number | null, number][] = [
    ['aula', t.workload.regular, assigned],
    ['HA', t.workload.ha, sumType('HA')],
    ['CCH', t.workload.cch, sumType('CCH')],
    ['HL', t.workload.hl, sumType('HL')],
    ['OUTRA', t.workload.others.length ? othersDeclared : null, sumType('OUTRA')],
  ];
  const lines: WorkloadLine[] = raw.map(([component, declared, configured]) => {
    const c = cfg.components[component];
    // a jornada é calculada pelo que está efetivamente cadastrado/atribuído;
    // se nada estiver cadastrado, usa o valor declarado
    const base = configured > 0 ? configured : declared ?? 0;
    return {
      component, label: LABELS[component], declared, configured, counts: c.counts, weight: c.weight,
      value: c.counts ? base * c.weight : 0,
    };
  });
  const computedTotal = lines.reduce((s, l) => s + l.value, 0);
  const divergences: string[] = [];
  for (const l of lines) {
    if (l.declared != null && l.declared !== l.configured) {
      const what = l.component === 'aula' ? 'atribuídas nas turmas' : 'cadastradas no módulo H.A./CCH/HL';
      divergences.push(`${l.label}: declarado ${fmt(l.declared)}, mas há ${fmt(l.configured)} ${what}.`);
    }
  }
  if (t.workload.total != null && Math.abs(t.workload.total - computedTotal) > 1e-9) {
    divergences.push(
      `Carga horária total declarada (${fmt(t.workload.total)} ${cfg.unit}) difere da soma dos componentes ` +
        `contabilizados (${fmt(computedTotal)} ${cfg.unit}).`,
    );
  }
  return { lines, computedTotal, declaredTotal: t.workload.total, unit: cfg.unit, divergences, assignedLessons: assigned };
}

export { fmt as fmtNumber };
