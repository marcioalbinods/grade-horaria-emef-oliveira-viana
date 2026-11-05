import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, Check, confirmDialog, Empty, Field, NumInput, PageHeader, TextInput } from '../components/ui';
import { newTeacher } from '../logic/defaults';
import { deleteAssignments, deleteTeacher } from '../logic/mutations';
import { className, sortedClasses, uid } from '../logic/util';
import { useData, useStore } from '../store';
import type { Teacher } from '../types';
import { linkTeacherSubject } from './MatrixPage';

function PeriodQuestion({ t }: { t: Teacher }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const setPeriods = async (ids: string[]) => {
    const removed = t.periodIds.filter((p) => !ids.includes(p));
    const affected = data.assignments.filter((a) => a.teacherId === t.id && removed.includes(data.classes.find((c) => c.id === a.classId)?.periodId ?? ''));
    if (affected.length && !(await confirmDialog('Alterar período de trabalho',
      <>{t.name} tem <b>{affected.length}</b> atribuição(ões) no(s) período(s) removido(s). Elas ficarão sem professor. Continuar?</>, { danger: true }))) return;
    update((d) => {
      const tt = d.teachers.find((x) => x.id === t.id)!;
      tt.periodIds = ids;
      for (const a of d.assignments) if (affected.some((x) => x.id === a.id)) a.teacherId = null;
    });
  };
  const presets = [
    ...data.periods.map((p) => ({ label: `Somente ${p.name.toLowerCase()}`, ids: [p.id] })),
    ...(data.periods.length > 1 ? [{ label: data.periods.map((p) => p.name).join(' e '), ids: data.periods.map((p) => p.id) }] : []),
  ];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    <Field label="Em qual período o professor trabalha? (obrigatório)" error={t.periodIds.length ? null : 'Selecione ao menos um período.'}>
      <div className="row">
        {presets.map((p) => (
          <label key={p.label} className="check"><input type="radio" name={`per-${t.id}`} checked={same(p.ids, t.periodIds)} onChange={() => setPeriods(p.ids)} /> {p.label}</label>
        ))}
      </div>
      {data.periods.length > 2 && (
        <div className="row small muted">Outra combinação:
          {data.periods.map((p) => (
            <Check key={p.id} label={p.name} checked={t.periodIds.includes(p.id)} onChange={(v) => setPeriods(v ? [...t.periodIds, p.id] : t.periodIds.filter((x) => x !== p.id))} />
          ))}
        </div>
      )}
    </Field>
  );
}

function Assignments({ t }: { t: Teacher }) {
  const data = useData();
  const { update, toast } = useStore();
  const mine = data.assignments.filter((a) => a.teacherId === t.id);
  const [periodId, setPeriod] = useState(t.periodIds[0] ?? '');
  const [gradeId, setGrade] = useState('');
  const [classId, setClass] = useState('');
  const [subjectId, setSubject] = useState(t.subjectIds[0] ?? '');
  const [lessons, setLessons] = useState<number | null>(null);
  useEffect(() => { setPeriod(t.periodIds[0] ?? ''); setSubject(t.subjectIds[0] ?? ''); setClass(''); setGrade(''); }, [t.id, t.periodIds, t.subjectIds]);
  const classes = sortedClasses(data).filter((c) => c.periodId === periodId && (!gradeId || c.gradeId === gradeId));
  const existing = data.assignments.find((a) => a.classId === classId && a.subjectId === subjectId);
  const add = async () => {
    if (!classId || !subjectId || !lessons) return;
    if (existing && existing.teacherId !== t.id) {
      const other = data.teachers.find((x) => x.id === existing.teacherId);
      const ok = await confirmDialog('Disciplina já atribuída',
        <>Na matriz da turma, esta disciplina está {other ? <>com <b>{other.name}</b></> : 'sem professor'} ({existing.lessons} aulas). Deseja atribuí-la a <b>{t.name}</b> com {lessons} aulas? (Para dividir a disciplina entre dois professores, cancele e adicione outra linha na Matriz curricular.)</>);
      if (!ok) return;
      update((d) => { const a = d.assignments.find((x) => x.id === existing.id)!; a.teacherId = t.id; a.lessons = lessons; linkTeacherSubject(d, t.id, subjectId); });
    } else if (existing) {
      update((d) => { d.assignments.find((x) => x.id === existing.id)!.lessons = lessons; });
      toast('Atribuição já existia: quantidade de aulas atualizada.');
    } else {
      update((d) => { d.assignments.push({ id: uid('atr'), classId, subjectId, teacherId: t.id, lessons, maxPerDay: null, double: 'indiferente' }); linkTeacherSubject(d, t.id, subjectId); });
    }
    setLessons(null);
  };
  const total = mine.reduce((s, a) => s + a.lessons, 0);
  return (
    <Card title={`Atribuição de aulas — total: ${total} aula(s) semanais`}>
      {mine.length === 0 ? <p className="muted">Nenhuma aula atribuída a este professor.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Período</th><th>Turma</th><th>Disciplina</th><th className="num">Aulas semanais</th><th></th></tr></thead>
            <tbody>
              {mine.map((a) => {
                const c = data.classes.find((x) => x.id === a.classId);
                const p = data.periods.find((x) => x.id === c?.periodId);
                return (
                  <tr key={a.id}>
                    <td>{p?.name}{p && !t.periodIds.includes(p.id) && <Badge kind="erro">fora do período</Badge>}</td>
                    <td>{className(data, c)}</td>
                    <td>{data.subjects.find((s) => s.id === a.subjectId)?.name}</td>
                    <td className="num"><NumInput value={a.lessons} min={0} onChange={(v) => update((d) => { d.assignments.find((x) => x.id === a.id)!.lessons = v ?? 0; })} ariaLabel="Aulas" /></td>
                    <td className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn small" onClick={() => update((d) => { d.assignments.find((x) => x.id === a.id)!.teacherId = null; })} title="A linha continua na matriz da turma, sem professor">Desvincular</button>
                      <button className="btn small danger" onClick={() => update((d) => deleteAssignments(d, new Set([a.id])))}>Excluir</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{total}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
      <h3 style={{ margin: '14px 0 8px' }}>Adicionar atribuição</h3>
      {!t.periodIds.length ? <p className="muted small">Informe o período de trabalho do professor primeiro.</p> : !data.subjects.length ? <p className="muted small">Cadastre disciplinas na Matriz curricular.</p> : (
        <div className="row top">
          <Field label="1. Disciplina">
            <select className="input" value={subjectId} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Selecione…</option>
              {[...data.subjects].sort((a, b) => Number(t.subjectIds.includes(b.id)) - Number(t.subjectIds.includes(a.id))).map((s) => <option key={s.id} value={s.id}>{s.name}{t.subjectIds.includes(s.id) ? ' ★' : ''}</option>)}
            </select>
          </Field>
          <Field label="2. Período">
            <select className="input" value={periodId} onChange={(e) => { setPeriod(e.target.value); setClass(''); }}>
              {data.periods.filter((p) => t.periodIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="3. Ano/série">
            <select className="input" value={gradeId} onChange={(e) => { setGrade(e.target.value); setClass(''); }}>
              <option value="">Todos</option>
              {data.grades.filter((g) => data.classes.some((c) => c.gradeId === g.id && c.periodId === periodId)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="4. Turma">
            <select className="input" value={classId} onChange={(e) => setClass(e.target.value)}>
              <option value="">Selecione…</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="5. Aulas semanais"><NumInput value={lessons} min={1} max={60} allowEmpty onChange={setLessons} /></Field>
          <div style={{ alignSelf: 'center' }}><button className="btn primary" disabled={!classId || !subjectId || !lessons} onClick={add}>Adicionar</button></div>
        </div>
      )}
    </Card>
  );
}

export default function TeachersPage() {
  const data = useData();
  const { update, pageParam } = useStore();
  const [q, setQ] = useState('');
  const teachers = useMemo(() => [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [data.teachers]);
  const [sel, setSel] = useState<string | null>(pageParam ?? teachers[0]?.id ?? null);
  useEffect(() => { if (pageParam && data.teachers.some((t) => t.id === pageParam)) setSel(pageParam); }, [pageParam, data.teachers]);
  const t = data.teachers.find((x) => x.id === sel) ?? null;
  const filtered = teachers.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));

  const add = () => {
    const nt = newTeacher(`Novo professor ${data.teachers.length + 1}`, data.periods.length === 1 ? [data.periods[0].id] : [], data.school.days.length);
    update((d) => { d.teachers.push(nt); });
    setSel(nt.id);
  };
  const remove = async () => {
    if (!t) return;
    const n = data.assignments.filter((a) => a.teacherId === t.id).length;
    if (await confirmDialog('Excluir professor', <>Excluir <b>{t.name}</b>?{n > 0 && <> Suas <b>{n}</b> atribuição(ões) continuarão nas matrizes, porém <b>sem professor</b>.</>} As atividades (H.A., CCH, HL) dele serão excluídas.</>, { danger: true, okLabel: 'Excluir' })) {
      update((d) => deleteTeacher(d, t.id));
      setSel(null);
    }
  };
  const nameDup = t && data.teachers.some((o) => o.id !== t.id && o.name.trim().toLowerCase() === t.name.trim().toLowerCase());

  return (
    <>
      <PageHeader title="Cadastro de professores" subtitle="Ficha individual com disciplinas, período de trabalho e atribuição de aulas." actions={<button className="btn primary" onClick={add}>+ Novo professor</button>} />
      <div className="split">
        <Card title={`Professores (${data.teachers.length})`}>
          <input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} aria-label="Buscar professor" />
          <div className="list-sel">
            {filtered.map((x) => {
              const n = data.assignments.filter((a) => a.teacherId === x.id).reduce((s, a) => s + a.lessons, 0);
              return (
                <button key={x.id} className={x.id === sel ? 'active' : ''} onClick={() => setSel(x.id)}>
                  <span>{x.name}</span><span className="muted small">{n} aulas</span>
                </button>
              );
            })}
            {!filtered.length && <p className="muted small">Nenhum professor.</p>}
          </div>
        </Card>
        {!t ? <Empty action={<button className="btn primary" onClick={add}>+ Cadastrar professor</button>}>Selecione ou cadastre um professor.</Empty> : (
          <div>
            <Card title="Identificação" actions={<>
              <button className="btn small" onClick={() => useStore.getState().go('disponibilidade', t.id)}>Disponibilidade</button>
              <button className="btn small" onClick={() => useStore.getState().go('cargas', t.id)}>Carga horária</button>
              <button className="btn small danger" onClick={remove}>Excluir</button>
            </>}>
              <Field label="Nome completo" error={nameDup ? 'Já existe outro professor com este nome.' : null}>
                <TextInput value={t.name} required onChange={(v) => update((d) => { d.teachers.find((x) => x.id === t.id)!.name = v; })} />
              </Field>
              <PeriodQuestion t={t} />
              <Field label="Disciplina(s) que leciona">
                <div className="row">
                  {data.subjects.length === 0 && <span className="muted small">Nenhuma disciplina cadastrada.</span>}
                  {data.subjects.map((s) => (
                    <Check key={s.id} label={s.name} checked={t.subjectIds.includes(s.id)}
                      onChange={(v) => update((d) => { const tt = d.teachers.find((x) => x.id === t.id)!; tt.subjectIds = v ? [...tt.subjectIds, s.id] : tt.subjectIds.filter((x) => x !== s.id); })} />
                  ))}
                </div>
              </Field>
              <Field label="Turmas atendidas" hint="Calculado a partir das atribuições.">
                <div>{[...new Set(data.assignments.filter((a) => a.teacherId === t.id).map((a) => className(data, data.classes.find((c) => c.id === a.classId))))].join(', ') || '—'}</div>
              </Field>
              <Field label="Observações">
                <textarea className="input" defaultValue={t.notes} key={t.id} onBlur={(e) => update((d) => { d.teachers.find((x) => x.id === t.id)!.notes = e.target.value; })} />
              </Field>
            </Card>
            <Assignments t={t} />
          </div>
        )}
      </div>
    </>
  );
}
