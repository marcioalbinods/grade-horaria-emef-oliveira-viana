import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import type { AppData, Entry } from '../types';
import { checkData, isBlocking } from './checks';
import { newConflicts, swapEntries, validateSchedule, validTargets } from './conflicts';
import { normalizeData } from './db';
import { initialData } from './defaults';
import { demoData } from './demo';
import { reportToCsv, reportToPdf, reportToWorkbook } from './exporters';
import { applyImport, previewImport, templateWorkbook } from './importer';
import { computeMetrics } from './metrics';
import { deleteClasses, deletePeriod, deleteSubject, deleteTeacher, trimPeriodSlots } from './mutations';
import { buildProblem } from './payload';
import { buildReport, REPORTS } from './reports';
import { entryKey } from './util';
import { workloadReport } from './workload';
import { jeifInfo } from './jeif';
import { findJeif } from './importer';

const here = dirname(fileURLToPath(import.meta.url));

/** Pequena escola montada à mão, com grade conhecida. */
function tiny(): { data: AppData; entries: Entry[] } {
  const d = initialData();
  d.classes = d.classes.filter((c) => c.periodId === 'per_tarde').slice(0, 2); // 1º A e 1º B (tarde)
  d.pending = [];
  const [c1, c2] = d.classes;
  c1.weeklyLessons = 2;
  c2.weeklyLessons = 2;
  d.subjects = [{ id: 's1', name: 'Matemática', short: 'MAT', color: '#2563eb' }];
  d.teachers = [
    { id: 't1', name: 'Ana', subjectIds: ['s1'], periodIds: ['per_tarde'], notes: '', jeifGroupId: null, workload: { total: 4, regular: 4, ha: null, cch: null, hl: 1, others: [] },
      availability: { workDays: [0, 1, 2, 3, 4], unavailable: ['per_tarde|1|0'], avoid: [], entry: {}, exit: {}, maxDaily: null, maxConsecutive: null, preferredDays: [], maxDays: null, preferConsecutive: false, avoidGaps: true } },
  ];
  d.assignments = [
    { id: 'a1', classId: c1.id, subjectId: 's1', teacherId: 't1', lessons: 2, maxPerDay: 1, double: 'indiferente' },
    { id: 'a2', classId: c2.id, subjectId: 's1', teacherId: 't1', lessons: 2, maxPerDay: null, double: 'indiferente' },
  ];
  d.activities = [{ id: 'r1', teacherId: 't1', type: 'HL', label: 'HL', periodId: 'per_tarde', qty: 1, inGrid: true, days: [], slots: [], position: 'inicio_ou_fim_periodo', mode: 'flexivel', fixed: [], maxPerDay: null, classId: null, notes: '' }];
  const E = (kind: Entry['kind'], refId: string, day: number, slot: number): Entry => ({ kind, refId, periodId: 'per_tarde', day, slot });
  const entries = [E('aula', 'a1', 0, 1), E('aula', 'a1', 2, 1), E('aula', 'a2', 0, 2), E('aula', 'a2', 0, 3), E('atividade', 'r1', 0, 0)];
  return { data: d, entries };
}

describe('estrutura inicial', () => {
  it('cadastra exatamente as turmas informadas pela escola, sem preencher pendências', () => {
    const d = initialData();
    const m = d.classes.filter((c) => c.periodId === 'per_manha');
    const t = d.classes.filter((c) => c.periodId === 'per_tarde');
    expect(m).toHaveLength(15);
    expect(t).toHaveLength(15);
    expect(m.filter((c) => c.weeklyLessons === 40)).toHaveLength(13);
    expect(m.filter((c) => c.weeklyLessons === 27).map((c) => c.name)).toEqual(['4º A', '4º B']);
    expect(t.find((c) => c.weeklyLessons === 24)?.name).toBe('4º A');
    expect(d.pending).toHaveLength(2);
    expect(d.periods[0].slots).toHaveLength(8);
    expect(d.periods[1].slots).toHaveLength(6);
    expect(d.periods.every((p) => p.slots.every((s) => s.start === '' && s.end === ''))).toBe(true);
    expect(d.subjects).toHaveLength(0);
    expect(d.teachers).toHaveLength(0);
    expect(d.school.days).toHaveLength(5);
  });
});

describe('validação da grade', () => {
  it('grade correta não tem conflitos', () => {
    const { data, entries } = tiny();
    expect(validateSchedule(data, entries).filter((v) => v.severity === 'conflito')).toEqual([]);
  });
  it('detecta professor em dois lugares e turma com duas aulas', () => {
    const { data, entries } = tiny();
    const bad = [...entries, { kind: 'aula', refId: 'a2', periodId: 'per_tarde', day: 0, slot: 1 } as Entry];
    const msgs = validateSchedule(data, bad).map((v) => v.message).join('\n');
    expect(msgs).toMatch(/Ana está em 2 lugares/);
    expect(msgs).toMatch(/3 aulas alocadas, mas a matriz prevê 2/);
  });
  it('detecta indisponibilidade, máximo por dia e posição da HL', () => {
    const { data, entries } = tiny();
    const moved = entries.map((e) => (e.refId === 'a1' && e.day === 2 ? { ...e, day: 1, slot: 0 } : e));
    expect(validateSchedule(data, moved).some((v) => /indisponível/.test(v.message))).toBe(true);
    const twice = entries.map((e) => (e.refId === 'a1' && e.day === 2 ? { ...e, day: 0, slot: 4 } : e));
    expect(validateSchedule(data, twice).some((v) => /acima do máximo de 1 por dia/.test(v.message))).toBe(true);
    const hlMiddle = entries.map((e) => (e.kind === 'atividade' ? { ...e, day: 3, slot: 2 } : e));
    expect(validateSchedule(data, hlMiddle).some((v) => /regra de posição/.test(v.message))).toBe(true);
  });
  it('detecta sobreposição de relógio entre períodos', () => {
    const { data, entries } = tiny();
    data.periods[0].slots = [{ start: '13:00', end: '13:45' }, ...data.periods[0].slots.slice(1)];
    data.periods[1].slots = [{ start: '13:30', end: '14:15' }, ...data.periods[1].slots.slice(1)];
    data.teachers[0].periodIds = ['per_manha', 'per_tarde'];
    const c = { ...data.classes[0], id: 'cm', periodId: 'per_manha', name: 'M' };
    data.classes.push(c);
    data.assignments.push({ id: 'a3', classId: 'cm', subjectId: 's1', teacherId: 't1', lessons: 1, maxPerDay: null, double: 'indiferente' });
    const e2 = [...entries, { kind: 'aula', refId: 'a3', periodId: 'per_manha', day: 0, slot: 0 } as Entry];
    expect(validateSchedule(data, e2).some((v) => /horários sobrepostos/.test(v.message))).toBe(true);
  });
  it('pendência quando faltam aulas, e entrada de atribuição removida vira conflito', () => {
    const { data, entries } = tiny();
    const less = entries.filter((e) => !(e.refId === 'a1' && e.day === 2));
    expect(validateSchedule(data, less).some((v) => v.severity === 'pendencia' && /1 de 2 aulas/.test(v.message))).toBe(true);
    data.assignments = data.assignments.filter((a) => a.id !== 'a2');
    expect(validateSchedule(data, entries).some((v) => /não existe mais/.test(v.message))).toBe(true);
  });
  it('alvos válidos e trocas não criam conflitos', () => {
    const { data, entries } = tiny();
    const key = entryKey(entries[0]);
    const targets = validTargets(data, entries, key);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      const after = entries.map((e) => (entryKey(e) === key ? { ...e, day: t.day, slot: t.slot } : e));
      expect(newConflicts(data, entries, after)).toEqual([]);
    }
    // segunda-feira 1ª aula (dia 1, aula 0) está indisponível: não pode ser alvo
    expect(targets.some((t) => t.day === 1 && t.slot === 0)).toBe(false);
    const swapped = swapEntries(entries, entryKey(entries[2]), entryKey(entries[3]));
    expect(newConflicts(data, entries, swapped)).toEqual([]);
  });
});

describe('métricas', () => {
  it('conta janelas, dias e preferências', () => {
    const { data, entries } = tiny();
    const m = computeMetrics(data, entries);
    const s = m.teachers.get('t1')!;
    expect(s.lessons).toBe(4);
    expect(s.activities.HL).toBe(1);
    expect(s.gaps).toBe(0); // seg: 0,1,2,3 contíguos; qua: só 1
    expect(s.days).toBe(2);
    expect(s.isolated).toBe(1);
    const withGap = entries.map((e) => (e.refId === 'a2' && e.slot === 3 ? { ...e, slot: 5 } : e));
    const m2 = computeMetrics(data, withGap);
    expect(m2.teachers.get('t1')!.gaps).toBe(2);
    expect(m2.preferences.find((p) => p.text === 'Evitar janelas')?.met).toBe(false);
    expect(m.overall).toBeGreaterThan(0);
    expect(m.overall).toBeLessThanOrEqual(100);
  });
});

describe('carga horária', () => {
  it('não presume total = soma das aulas e aponta divergências', () => {
    const { data } = tiny();
    const r = workloadReport(data, data.teachers[0]);
    expect(r.assignedLessons).toBe(4);
    expect(r.computedTotal).toBe(5); // 4 aulas + 1 HL (pesos 1)
    expect(r.divergences.some((d) => /total declarada/.test(d))).toBe(true);
    data.school.workload.components.HL.counts = false;
    expect(workloadReport(data, data.teachers[0]).computedTotal).toBe(4);
    data.school.workload.components.aula.weight = 0.75;
    expect(workloadReport(data, data.teachers[0]).computedTotal).toBe(3);
  });
});

describe('verificações prévias', () => {
  it('estrutura inicial: só pendências, nenhum erro impeditivo inventado', () => {
    const issues = checkData(initialData());
    expect(issues.filter(isBlocking)).toEqual([]);
    expect(issues.some((i) => /quantidade de turmas pendente/.test(i.message))).toBe(true);
  });
  it('detecta professor fora do período, matriz excedente e aulas que não cabem', () => {
    const { data } = tiny();
    data.teachers[0].periodIds = ['per_manha'];
    expect(checkData(data).some((i) => i.category === 'cadastro' && /não está cadastrado\(a\) para trabalhar/.test(i.message))).toBe(true);
    const { data: d2 } = tiny();
    d2.assignments[0].lessons = 3;
    expect(checkData(d2).some((i) => /acima das 2 aulas semanais/.test(i.message))).toBe(true);
    const { data: d3 } = tiny();
    d3.teachers[0].availability.workDays = [0];
    d3.assignments[0].maxPerDay = 1;
    expect(checkData(d3).some((i) => i.category === 'matematica')).toBe(true);
  });
  it('dados de demonstração não têm erros impeditivos', () => {
    expect(checkData(demoData()).filter(isBlocking)).toEqual([]);
  });
});

describe('consistência entre módulos', () => {
  it('exclusões em cascata limpam referências e grades', () => {
    const { data, entries } = tiny();
    data.schedules = [{ id: 'g', name: 'g', createdAt: '', updatedAt: '', strategy: 'equilibrada', label: '', entries, edited: false, notes: '' }];
    deleteTeacher(data, 't1');
    expect(data.assignments.every((a) => a.teacherId === null)).toBe(true);
    expect(data.activities).toHaveLength(0);
    expect(data.schedules[0].entries.some((e) => e.kind === 'atividade')).toBe(false);
    deleteSubject(data, 's1');
    expect(data.assignments).toHaveLength(0);
    expect(data.schedules[0].entries).toHaveLength(0);
    const d2 = initialData();
    deleteClasses(d2, new Set([d2.classes[0].id]));
    expect(d2.classes).toHaveLength(29);
    deletePeriod(d2, 'per_manha');
    expect(d2.classes.every((c) => c.periodId === 'per_tarde')).toBe(true);
  });
  it('reduzir aulas do período ajusta bloqueios e indisponibilidades', () => {
    const { data } = tiny();
    data.classes[0].blocked = [[0, 5], [0, 1]];
    data.teachers[0].availability.unavailable.push('per_tarde|2|5');
    trimPeriodSlots(data, 'per_tarde', 5);
    expect(data.classes[0].blocked).toEqual([[0, 1]]);
    expect(data.teachers[0].availability.unavailable).not.toContain('per_tarde|2|5');
  });
});

describe('payload para o motor', () => {
  it('converte dados no formato da API e ignora atribuições sem professor', () => {
    const { data, entries } = tiny();
    data.assignments.push({ id: 'ax', classId: data.classes[0].id, subjectId: 's1', teacherId: null, lessons: 1, maxPerDay: null, double: 'indiferente' });
    const p = buildProblem(data, { strategies: ['janelas'], timeLimit: 10, locks: [{ ...entries[0], locked: true }] });
    expect(p.assignments.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(p.teachers[0].unavailable).toEqual([['per_tarde', 1, 0]]);
    expect(p.locks).toHaveLength(1);
    expect(p.periods[1].slots[0]).toEqual({ start: null, end: null });
  });
  it('gera o problema da demonstração para o teste integrado do backend', () => {
    const p = buildProblem(demoData(), { strategies: ['equilibrada'], timeLimit: 30, locks: [] });
    expect(p.classes).toHaveLength(30);
    const out = resolve(here, '../../../backend/tests/data/demo_problem.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(p));
  });
});

describe('backup', () => {
  it('normaliza backups e rejeita arquivos inválidos', () => {
    const d = demoData();
    const back = normalizeData(JSON.parse(JSON.stringify(d)));
    expect(back.teachers).toHaveLength(d.teachers.length);
    expect(() => normalizeData({ foo: 1 })).toThrow(/inválido/);
    const partial = normalizeData({ school: { name: 'X' }, periods: [], classes: [{ id: 'c', name: 'A', periodId: 'p', gradeId: 'g', weeklyLessons: 5 }] });
    expect(partial.classes[0].blocked).toEqual([]);
    expect(partial.school.days).toHaveLength(5);
  });
});

describe('importação de planilhas', () => {
  it('prévia identifica novos, duplicados e erros; importação aplica somente válidos', () => {
    const data = initialData();
    const wb = templateWorkbook();
    const put = (name: string, rows: (string | number)[][]) => {
      wb.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
    };
    put('Disciplinas', [['Nome', 'Sigla', 'Cor'], ['Matemática', 'MAT', '#123456'], ['Matemática', 'MAT', ''], ['Arte', 'ART', 'azul']]);
    put('Turmas', [['Período', 'Ano/Série', 'Turma', 'Aulas semanais', 'Aulas diárias (máx.)'], ['Tarde', '2º ano', 'A', 30, ''], ['Tarde', '1º ano', 'A', 30, ''], ['Noite', '1º ano', 'A', 30, '']]);
    put('Professores', [['Nome', 'Disciplinas', 'Períodos', 'Dias de trabalho', 'Carga total', 'Aulas regulares', 'H.A.', 'CCH', 'HL'], ['Prof. Teste', 'Matemática', 'Tarde', 'Seg;Ter;Qua', 20, 18, 2, '', ''], ['Sem Período', 'Arte', '', '', '', '', '', '', '']]);
    put('Atribuições', [['Professor', 'Período', 'Turma', 'Disciplina', 'Aulas semanais', 'Máx. por dia'], ['Prof. Teste', 'Tarde', '2º A', 'Matemática', 5, 2], ['Desconhecido', 'Tarde', '1º A', 'Matemática', 5, '']]);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const pv = previewImport(data, buf);
    const st = (sheet: string) => pv.sheets.find((s) => s.name === sheet)!.rows.map((r) => r.status);
    expect(st('Disciplinas')).toEqual(['novo', 'duplicado', 'erro']);
    expect(st('Turmas')).toEqual(['novo', 'atualizar', 'erro']);
    expect(st('Professores')).toEqual(['novo', 'erro']);
    expect(st('Atribuições')).toEqual(['novo', 'erro']);
    applyImport(data, pv);
    const t = data.teachers.find((x) => x.name === 'Prof. Teste')!;
    expect(t.availability.workDays).toEqual([0, 1, 2]);
    expect(t.workload.regular).toBe(18);
    const c = data.classes.find((x) => x.name === '2º A' && x.periodId === 'per_tarde')!;
    expect(c).toBeTruthy();
    expect(data.pending.some((p) => p.gradeId === 'serie_2')).toBe(false);
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0]).toMatchObject({ classId: c.id, teacherId: t.id, lessons: 5, maxPerDay: 2 });
  });
});

describe('relatórios e exportação', () => {
  it('gera todos os relatórios e exporta CSV, Excel e PDF', () => {
    const { data, entries } = tiny();
    const sch = { id: 'g', name: 'Grade', createdAt: '', updatedAt: '', strategy: 'equilibrada', label: '', entries, edited: false, notes: '' };
    for (const r of REPORTS) {
      const rep = buildReport(data, sch, r.id);
      expect(rep.tables.length).toBeGreaterThan(0);
      expect(reportToCsv(rep).length).toBeGreaterThan(10);
      expect(reportToWorkbook(rep).SheetNames.length).toBeGreaterThan(0);
    }
    const grade = buildReport(data, sch, 'grade-turma');
    expect(grade.tables[0].rows[1][2]).toContain('Matemática');
    const pdf = reportToPdf(grade, 'Escola');
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000);
    const csv = reportToCsv(buildReport(data, sch, 'livres'));
    expect(csv).toMatch(/Horários livres por turma/);
  });
});

describe('JEIF', () => {
  /** Tarde: 6 aulas de 13:30 a 18:20 (intervalo 15:45–16:05). */
  function comHorarios() {
    const { data, entries } = tiny();
    data.periods[1].slots = demoData().periods[1].slots;
    data.periods[0].slots = demoData().periods[0].slots;
    return { data, entries };
  }

  it('estrutura inicial tem os três agrupamentos informados e professores começam sem JEIF', () => {
    const d = initialData();
    expect(d.school.jeifGroups.map((g) => [g.name, g.start, g.end, g.days.join(',')])).toEqual([
      ['Grupo I', '10:30', '12:00', '0,1,2,3'], ['Grupo II', '14:00', '15:30', '0,1,2,3'], ['Grupo III', '19:00', '20:30', '0,1,2,3'],
    ]);
    expect(d.school.jeifGroups.filter((g) => g.noGapBefore).map((g) => g.name)).toEqual(['Grupo III']);
  });

  it('dados já salvos (sem JEIF) são mantidos e recebem os campos novos', () => {
    const antigo = JSON.parse(JSON.stringify(initialData()));
    delete antigo.school.jeifGroups;
    antigo.classes[0].weeklyLessons = 33; // edição feita pelo usuário
    antigo.classes = antigo.classes.slice(0, 20);
    antigo.teachers = [{ id: 'x', name: 'Prof', periodIds: ['per_manha'], subjectIds: [], workload: {}, availability: {} }];
    const n = normalizeData(antigo);
    expect(n.classes).toHaveLength(20);
    expect(n.classes[0].weeklyLessons).toBe(33);
    expect(n.school.jeifGroups).toHaveLength(3);
    expect(n.teachers[0].jeifGroupId).toBeNull();
  });

  it('Grupo II bloqueia as aulas da tarde que coincidem com 14h–15h30, só de segunda a quinta', () => {
    const { data } = comHorarios();
    data.teachers[0].jeifGroupId = 'jeif_2';
    const info = jeifInfo(data, data.teachers[0]);
    // 13:30–14:15, 14:15–15:00 e 15:00–15:45 coincidem; seg a qui = 4 dias
    expect(info.blocked.size).toBe(12);
    expect(info.blocked.has('per_tarde|0|0')).toBe(true);
    expect(info.blocked.has('per_tarde|3|2')).toBe(true);
    expect(info.blocked.has('per_tarde|0|3')).toBe(false);
    expect(info.blocked.has('per_tarde|4|0')).toBe(false); // sexta livre
    expect(info.noGap).toEqual([]);
  });

  it('Grupo III não bloqueia aulas da tarde, mas exige aulas até a última aula de seg a qui', () => {
    const { data } = comHorarios();
    data.teachers[0].jeifGroupId = 'jeif_3';
    const info = jeifInfo(data, data.teachers[0]);
    expect(info.blocked.size).toBe(0);
    expect(info.noGap).toEqual([0, 1, 2, 3].map((day) => ({ periodId: 'per_tarde', day })));
    // professor só da manhã no Grupo III: a regra não se aplica (a manhã não é o período anterior à JEIF)
    data.teachers[0].periodIds = ['per_manha'];
    expect(jeifInfo(data, data.teachers[0]).noGap).toEqual([]);
  });

  it('sem horários cadastrados, a JEIF vira erro de cadastro (não dá para saber o que coincide)', () => {
    const { data } = tiny();
    data.teachers[0].jeifGroupId = 'jeif_2';
    expect(checkData(data).some((i) => i.category === 'cadastro' && /JEIF/.test(i.message))).toBe(true);
  });

  it('validação acusa aula em horário de JEIF e horário vago antes da JEIF do Grupo III', () => {
    const { data, entries } = comHorarios();
    data.teachers[0].jeifGroupId = 'jeif_2';
    // a1 está na segunda 2ª aula (14:15–15:00) → coincide com a JEIF
    expect(validateSchedule(data, entries).some((v) => v.severity === 'conflito' && /está em JEIF/.test(v.message))).toBe(true);
    data.teachers[0].jeifGroupId = 'jeif_3';
    // segunda: ocupa 0..3, mas as aulas 5ª e 6ª ficam vagas antes da JEIF
    const viol = validateSchedule(data, entries).filter((v) => /horário vago entre suas aulas/.test(v.message));
    expect(viol).toHaveLength(2); // segunda e quarta
    // levando as aulas até a última aula, o conflito desaparece
    const ok: Entry[] = [
      { kind: 'atividade', refId: 'r1', periodId: 'per_tarde', day: 0, slot: 5 },
      { kind: 'aula', refId: 'a1', periodId: 'per_tarde', day: 0, slot: 4 },
      { kind: 'aula', refId: 'a2', periodId: 'per_tarde', day: 0, slot: 3 },
      { kind: 'aula', refId: 'a2', periodId: 'per_tarde', day: 0, slot: 2 },
      { kind: 'aula', refId: 'a1', periodId: 'per_tarde', day: 4, slot: 1 }, // sexta: sem JEIF
    ];
    expect(validateSchedule(data, ok).filter((v) => /JEIF/.test(v.message))).toEqual([]);
  });

  it('JEIF segue para o motor e é reconhecida na importação de planilhas', () => {
    const { data } = comHorarios();
    data.teachers[0].jeifGroupId = 'jeif_2';
    const p = buildProblem(data, { strategies: ['janelas'], timeLimit: 10, locks: [] });
    expect(p.teachers[0].jeifName).toBe('Grupo II');
    expect(p.teachers[0].jeifBlocked).toHaveLength(12);
    expect(findJeif(data, 'Grupo III')).toBe('jeif_3');
    expect(findJeif(data, 'iii')).toBe('jeif_3');
    expect(findJeif(data, '2')).toBe('jeif_2');
    expect(findJeif(data, '')).toBeUndefined();
    expect(findJeif(data, 'Grupo IX')).toBeNull();
  });
});
