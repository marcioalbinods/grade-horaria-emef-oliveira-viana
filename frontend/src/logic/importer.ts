// Importação de planilhas Excel: professores, turmas, disciplinas, cargas e atribuições.
import * as XLSX from 'xlsx';
import type { AppData, Grade } from '../types';
import { makeClass, newTeacher, PALETTE } from './defaults';
import { uid } from './util';

export type RowStatus = 'novo' | 'atualizar' | 'duplicado' | 'erro';

export interface PreviewRow {
  line: number;
  values: Record<string, string>;
  status: RowStatus;
  messages: string[];
}

export interface ImportPreview {
  sheets: { name: SheetName; rows: PreviewRow[] }[];
  missingSheets: string[];
}

export type SheetName = 'Disciplinas' | 'Turmas' | 'Professores' | 'Atribuições';

export const SHEETS: Record<SheetName, string[]> = {
  Disciplinas: ['Nome', 'Sigla', 'Cor'],
  Turmas: ['Período', 'Ano/Série', 'Turma', 'Aulas semanais', 'Aulas diárias (máx.)'],
  Professores: ['Nome', 'Disciplinas', 'Períodos', 'Dias de trabalho', 'Carga total', 'Aulas regulares', 'H.A.', 'CCH', 'HL', 'JEIF'],
  Atribuições: ['Professor', 'Período', 'Turma', 'Disciplina', 'Aulas semanais', 'Máx. por dia'],
};

export const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const DAY_ALIASES = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

const ROMAN: Record<string, string> = { '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v' };
/** Encontra o agrupamento de JEIF pelo nome ("Grupo III", "III", "3"). undefined = não informado; null = não encontrado. */
export function findJeif(data: AppData, s: string): string | null | undefined {
  const v = norm(s);
  if (!v || ['nao', 'não', 'nenhum', 'nao faz', '-'].includes(v)) return undefined;
  const key = (x: string) => {
    const k = norm(x).replace(/^grupo\s*/, '');
    return ROMAN[k] ?? k;
  };
  return data.school.jeifGroups.find((g) => key(g.name) === key(v))?.id ?? null;
}

export function templateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const instr = [
    ['Modelo de importação – Sistema de Grade Horária'],
    [''],
    ['Preencha as abas abaixo (não altere os títulos das colunas). Linhas vazias são ignoradas.'],
    ['Disciplinas: Nome (obrigatório), Sigla, Cor (ex.: #2563eb).'],
    ['Turmas: Período (ex.: Manhã), Ano/Série (ex.: 1º ano), Turma (letra ou nome, ex.: A), Aulas semanais, Aulas diárias (máx., opcional).'],
    ['Professores: Nome, Disciplinas (separadas por ";"), Períodos (ex.: Manhã;Tarde), Dias de trabalho (ex.: Seg;Ter;Qua), Carga total, Aulas regulares, H.A., CCH, HL, JEIF (Grupo I, Grupo II, Grupo III ou vazio).'],
    ['Atribuições: Professor, Período, Turma (ex.: 1º A), Disciplina, Aulas semanais, Máx. por dia (opcional).'],
    [''],
    ['Registros já existentes (mesmo nome) são atualizados. A prévia mostra tudo antes de confirmar.'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instr), 'Instruções');
  for (const [name, head] of Object.entries(SHEETS)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head]), name);
  return wb;
}

function readSheet(wb: XLSX.WorkBook, name: string): Record<string, string>[] | null {
  const key = wb.SheetNames.find((n) => norm(n) === norm(name));
  if (!key) return null;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[key], { defval: '', raw: false });
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[norm(k)] = String(v ?? '').trim();
    return out;
  });
}

const get = (r: Record<string, string>, col: string) => r[norm(col)] ?? '';
const numOrNull = (s: string): number | null | 'erro' => {
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 'erro';
};

function findPeriod(data: AppData, s: string) {
  return data.periods.find((p) => norm(p.name) === norm(s));
}
const gradeKey = (s: string) =>
  norm(s).replace(/(\d+)\s*[º°ªo]/g, '$1').replace(/\b(ano|serie|series|anos)\b/g, '').replace(/\s+/g, '');
function findGrade(data: AppData, s: string): Grade | undefined {
  const k = gradeKey(s);
  return data.grades.find((g) => gradeKey(g.name) === k || gradeKey(g.short) === k);
}
function classLabel(grade: Grade | undefined, turma: string) {
  if (!grade) return turma;
  return turma.length <= 2 ? `${grade.short} ${turma.toUpperCase()}` : turma;
}

export function previewImport(data: AppData, buf: ArrayBuffer): ImportPreview {
  const wb = XLSX.read(buf, { type: 'array' });
  const preview: ImportPreview = { sheets: [], missingSheets: [] };
  const subjFile = new Set<string>();
  const teacherFile = new Set<string>();
  const classFile = new Set<string>();

  // Disciplinas
  const ds = readSheet(wb, 'Disciplinas');
  if (!ds) preview.missingSheets.push('Disciplinas');
  else {
    const rows: PreviewRow[] = [];
    ds.forEach((r, i) => {
      const nome = get(r, 'Nome');
      if (!nome && !get(r, 'Sigla')) return;
      const pr: PreviewRow = { line: i + 2, values: { Nome: nome, Sigla: get(r, 'Sigla'), Cor: get(r, 'Cor') }, status: 'novo', messages: [] };
      if (!nome) { pr.status = 'erro'; pr.messages.push('Nome obrigatório.'); }
      else if (subjFile.has(norm(nome))) { pr.status = 'duplicado'; pr.messages.push('Repetida na planilha (será ignorada).'); }
      else if (data.subjects.some((s) => norm(s.name) === norm(nome))) { pr.status = 'atualizar'; pr.messages.push('Já cadastrada: será atualizada.'); }
      const cor = get(r, 'Cor');
      if (cor && !/^#[0-9a-f]{6}$/i.test(cor)) { pr.status = 'erro'; pr.messages.push('Cor inválida (use o formato #RRGGBB).'); }
      if (nome) subjFile.add(norm(nome));
      rows.push(pr);
    });
    preview.sheets.push({ name: 'Disciplinas', rows });
  }

  // Turmas
  const ts = readSheet(wb, 'Turmas');
  if (!ts) preview.missingSheets.push('Turmas');
  else {
    const rows: PreviewRow[] = [];
    ts.forEach((r, i) => {
      const per = get(r, 'Período'), serie = get(r, 'Ano/Série'), turma = get(r, 'Turma');
      if (!per && !serie && !turma) return;
      const pr: PreviewRow = { line: i + 2, values: { Período: per, 'Ano/Série': serie, Turma: turma, 'Aulas semanais': get(r, 'Aulas semanais'), 'Aulas diárias (máx.)': get(r, 'Aulas diárias (máx.)') }, status: 'novo', messages: [] };
      const p = findPeriod(data, per);
      const g = findGrade(data, serie);
      if (!p) { pr.status = 'erro'; pr.messages.push(`Período "${per}" não cadastrado.`); }
      if (!g) pr.messages.push(`Ano/série "${serie}" não existe: será criado.`);
      if (!turma) { pr.status = 'erro'; pr.messages.push('Informe a turma (ex.: A).'); }
      const weekly = numOrNull(get(r, 'Aulas semanais'));
      if (weekly === 'erro' || weekly == null || !Number.isInteger(weekly)) { pr.status = 'erro'; pr.messages.push('Aulas semanais inválidas.'); }
      else if (p && weekly > p.slots.length * data.school.days.length) { pr.status = 'erro'; pr.messages.push(`O período ${p.name} só tem ${p.slots.length * data.school.days.length} horários semanais.`); }
      const dm = numOrNull(get(r, 'Aulas diárias (máx.)'));
      if (dm === 'erro') { pr.status = 'erro'; pr.messages.push('Aulas diárias inválidas.'); }
      const name = classLabel(g ?? { short: serie.replace(/\s*ano\s*/i, '') } as Grade, turma);
      const key = `${norm(per)}|${norm(name)}`;
      if (pr.status !== 'erro') {
        if (classFile.has(key)) { pr.status = 'duplicado'; pr.messages.push('Repetida na planilha (será ignorada).'); }
        else if (p && data.classes.some((c) => c.periodId === p.id && norm(c.name) === norm(name))) { pr.status = 'atualizar'; pr.messages.push('Já cadastrada: será atualizada.'); }
      }
      classFile.add(key);
      rows.push(pr);
    });
    preview.sheets.push({ name: 'Turmas', rows });
  }

  // Professores
  const ps = readSheet(wb, 'Professores');
  if (!ps) preview.missingSheets.push('Professores');
  else {
    const rows: PreviewRow[] = [];
    ps.forEach((r, i) => {
      const nome = get(r, 'Nome');
      if (!nome) return;
      const values: Record<string, string> = {};
      for (const c of SHEETS.Professores) values[c] = get(r, c);
      const pr: PreviewRow = { line: i + 2, values, status: 'novo', messages: [] };
      const pers = values['Períodos'].split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      if (!pers.length) { pr.status = 'erro'; pr.messages.push('Informe o(s) período(s) de trabalho.'); }
      for (const pn of pers) if (!findPeriod(data, pn)) { pr.status = 'erro'; pr.messages.push(`Período "${pn}" não cadastrado.`); }
      for (const dn of values['Dias de trabalho'].split(/[;,]/).map((x) => x.trim()).filter(Boolean))
        if (!DAY_ALIASES.includes(norm(dn).slice(0, 3)) || DAY_ALIASES.indexOf(norm(dn).slice(0, 3)) >= data.school.days.length) { pr.status = 'erro'; pr.messages.push(`Dia "${dn}" inválido.`); }
      for (const sn of values['Disciplinas'].split(/[;,]/).map((x) => x.trim()).filter(Boolean))
        if (!subjFile.has(norm(sn)) && !data.subjects.some((s) => norm(s.name) === norm(sn) || norm(s.short) === norm(sn))) pr.messages.push(`Disciplina "${sn}" não existe: será criada.`);
      if (findJeif(data, values.JEIF ?? '') === null) { pr.status = 'erro'; pr.messages.push(`Agrupamento de JEIF "${values.JEIF}" não existe (use Grupo I, Grupo II ou Grupo III).`); }
      for (const c of ['Carga total', 'Aulas regulares', 'H.A.', 'CCH', 'HL'])
        if (numOrNull(values[c]) === 'erro') { pr.status = 'erro'; pr.messages.push(`${c}: valor inválido.`); }
      if (pr.status !== 'erro') {
        if (teacherFile.has(norm(nome))) { pr.status = 'duplicado'; pr.messages.push('Repetido na planilha (será ignorado).'); }
        else if (data.teachers.some((t) => norm(t.name) === norm(nome))) { pr.status = 'atualizar'; pr.messages.push('Já cadastrado: será atualizado.'); }
      }
      teacherFile.add(norm(nome));
      rows.push(pr);
    });
    preview.sheets.push({ name: 'Professores', rows });
  }

  // Atribuições
  const as = readSheet(wb, 'Atribuições') ?? readSheet(wb, 'Atribuicoes');
  if (!as) preview.missingSheets.push('Atribuições');
  else {
    const rows: PreviewRow[] = [];
    const seen = new Set<string>();
    as.forEach((r, i) => {
      const values: Record<string, string> = {};
      for (const c of SHEETS['Atribuições']) values[c] = get(r, c);
      if (!values.Professor && !values.Turma) return;
      const pr: PreviewRow = { line: i + 2, values, status: 'novo', messages: [] };
      const p = findPeriod(data, values['Período']);
      if (!p) { pr.status = 'erro'; pr.messages.push(`Período "${values['Período']}" não cadastrado.`); }
      const tExists = teacherFile.has(norm(values.Professor)) || data.teachers.some((t) => norm(t.name) === norm(values.Professor));
      if (!tExists) { pr.status = 'erro'; pr.messages.push(`Professor "${values.Professor}" não encontrado (cadastre-o ou inclua na aba Professores).`); }
      const cExists = p && (classFile.has(`${norm(p.name)}|${norm(values.Turma)}`) || data.classes.some((c) => c.periodId === p.id && norm(c.name) === norm(values.Turma)));
      if (p && !cExists) { pr.status = 'erro'; pr.messages.push(`Turma "${values.Turma}" não encontrada no período ${p.name}.`); }
      if (!values.Disciplina) { pr.status = 'erro'; pr.messages.push('Informe a disciplina.'); }
      else if (!subjFile.has(norm(values.Disciplina)) && !data.subjects.some((s) => norm(s.name) === norm(values.Disciplina) || norm(s.short) === norm(values.Disciplina))) pr.messages.push(`Disciplina "${values.Disciplina}" não existe: será criada.`);
      const n = numOrNull(values['Aulas semanais']);
      if (n === 'erro' || n == null || n <= 0 || !Number.isInteger(n)) { pr.status = 'erro'; pr.messages.push('Aulas semanais inválidas.'); }
      if (numOrNull(values['Máx. por dia']) === 'erro') { pr.status = 'erro'; pr.messages.push('Máx. por dia inválido.'); }
      const key = `${norm(values['Período'])}|${norm(values.Turma)}|${norm(values.Disciplina)}|${norm(values.Professor)}`;
      if (pr.status !== 'erro') {
        if (seen.has(key)) { pr.status = 'duplicado'; pr.messages.push('Repetida na planilha (será ignorada).'); }
        else if (p) {
          const c = data.classes.find((c) => c.periodId === p.id && norm(c.name) === norm(values.Turma));
          const s = data.subjects.find((s) => norm(s.name) === norm(values.Disciplina) || norm(s.short) === norm(values.Disciplina));
          const t = data.teachers.find((t) => norm(t.name) === norm(values.Professor));
          if (c && s && t && data.assignments.some((a) => a.classId === c.id && a.subjectId === s.id && a.teacherId === t.id)) {
            pr.status = 'atualizar'; pr.messages.push('Atribuição já existe: a quantidade de aulas será atualizada.');
          }
        }
      }
      seen.add(key);
      rows.push(pr);
    });
    preview.sheets.push({ name: 'Atribuições', rows });
  }
  return preview;
}

/** Aplica as linhas válidas da prévia aos dados (dentro de um update do store). */
export function applyImport(d: AppData, preview: ImportPreview): { created: number; updated: number } {
  let created = 0, updated = 0;
  const ok = (r: PreviewRow) => r.status === 'novo' || r.status === 'atualizar';
  const ensureSubject = (name: string) => {
    let s = d.subjects.find((x) => norm(x.name) === norm(name) || norm(x.short) === norm(name));
    if (!s) {
      s = { id: uid('disc'), name, short: name.slice(0, 4).toUpperCase(), color: PALETTE[d.subjects.length % PALETTE.length] };
      d.subjects.push(s);
      created++;
    }
    return s;
  };
  for (const sh of preview.sheets) {
    for (const r of sh.rows.filter(ok)) {
      const v = r.values;
      if (sh.name === 'Disciplinas') {
        const ex = d.subjects.find((s) => norm(s.name) === norm(v.Nome));
        if (ex) {
          if (v.Sigla) ex.short = v.Sigla;
          if (v.Cor) ex.color = v.Cor;
          updated++;
        } else {
          d.subjects.push({ id: uid('disc'), name: v.Nome, short: v.Sigla || v.Nome.slice(0, 4).toUpperCase(), color: v.Cor || PALETTE[d.subjects.length % PALETTE.length] });
          created++;
        }
      } else if (sh.name === 'Turmas') {
        const p = findPeriod(d, v['Período'])!;
        let g = findGrade(d, v['Ano/Série']);
        if (!g) {
          const short = v['Ano/Série'].replace(/\s*ano\s*/i, '').trim() || v['Ano/Série'];
          g = { id: uid('serie'), name: v['Ano/Série'], short, cycleId: null, order: d.grades.length + 1 };
          d.grades.push(g);
        }
        const name = classLabel(g, v.Turma);
        const weekly = Number(v['Aulas semanais']);
        const dm = v['Aulas diárias (máx.)'] ? Number(v['Aulas diárias (máx.)']) : null;
        const ex = d.classes.find((c) => c.periodId === p.id && norm(c.name) === norm(name));
        if (ex) {
          ex.weeklyLessons = weekly;
          ex.dailyMax = dm;
          updated++;
        } else {
          const c = makeClass(p.id, g, v.Turma.length <= 2 ? v.Turma.toUpperCase() : v.Turma, weekly, d.school.defaultFreePolicy);
          c.name = name;
          c.dailyMax = dm;
          d.classes.push(c);
          d.pending = d.pending.filter((pg) => !(pg.periodId === p.id && pg.gradeId === g!.id));
          created++;
        }
      } else if (sh.name === 'Professores') {
        let t = d.teachers.find((x) => norm(x.name) === norm(v.Nome));
        const periods = v['Períodos'].split(/[;,]/).map((x) => findPeriod(d, x.trim())?.id).filter(Boolean) as string[];
        if (!t) {
          t = newTeacher(v.Nome, periods, d.school.days.length);
          d.teachers.push(t);
          created++;
        } else {
          t.periodIds = periods;
          updated++;
        }
        const subs = v.Disciplinas.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
        t.subjectIds = [...new Set([...t.subjectIds, ...subs.map((s) => ensureSubject(s).id)])];
        const days = v['Dias de trabalho'].split(/[;,]/).map((x) => DAY_ALIASES.indexOf(norm(x.trim()).slice(0, 3))).filter((x) => x >= 0);
        if (days.length) t.availability.workDays = [...new Set(days)].sort();
        const n = (s: string) => (s === '' ? null : Number(s.replace(',', '.')));
        if (v['Carga total'] !== '') t.workload.total = n(v['Carga total']);
        if (v['Aulas regulares'] !== '') t.workload.regular = n(v['Aulas regulares']);
        if (v['H.A.'] !== '') t.workload.ha = n(v['H.A.']);
        if (v.CCH !== '') t.workload.cch = n(v.CCH);
        if (v.HL !== '') t.workload.hl = n(v.HL);
        if ((v.JEIF ?? '') !== '') t.jeifGroupId = findJeif(d, v.JEIF) ?? null;
      } else {
        const p = findPeriod(d, v['Período'])!;
        const c = d.classes.find((c) => c.periodId === p.id && norm(c.name) === norm(v.Turma));
        const t = d.teachers.find((x) => norm(x.name) === norm(v.Professor));
        if (!c || !t) continue;
        const s = ensureSubject(v.Disciplina);
        if (!t.subjectIds.includes(s.id)) t.subjectIds.push(s.id);
        const lessons = Number(v['Aulas semanais']);
        const mpd = v['Máx. por dia'] ? Number(v['Máx. por dia']) : null;
        const ex = d.assignments.find((a) => a.classId === c.id && a.subjectId === s.id && a.teacherId === t.id);
        if (ex) {
          ex.lessons = lessons;
          ex.maxPerDay = mpd;
          updated++;
        } else {
          d.assignments.push({ id: uid('atr'), classId: c.id, subjectId: s.id, teacherId: t.id, lessons, maxPerDay: mpd, double: 'indiferente' });
          created++;
        }
      }
    }
  }
  return { created, updated };
}
