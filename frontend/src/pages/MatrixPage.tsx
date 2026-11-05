import { useEffect, useState } from 'react';
import { Badge, Card, confirmDialog, Empty, Modal, NumInput, PageHeader, Tabs, TextInput } from '../components/ui';
import { COMMON_SUBJECTS, PALETTE } from '../logic/defaults';
import { deleteAssignments, deleteSubject } from '../logic/mutations';
import { className, sortedClasses, uid } from '../logic/util';
import { useData, useStore } from '../store';
import type { AppData, Assignment } from '../types';

/** Ao vincular um professor a uma disciplina, mantém o cadastro do professor coerente. */
export function linkTeacherSubject(d: AppData, teacherId: string | null, subjectId: string) {
  if (!teacherId) return;
  const t = d.teachers.find((x) => x.id === teacherId);
  if (t && !t.subjectIds.includes(subjectId)) t.subjectIds.push(subjectId);
}

function SubjectsTab() {
  const data = useData();
  const update = useStore((s) => s.update);
  const addCommon = () =>
    update((d) => {
      for (const [name, short] of COMMON_SUBJECTS)
        if (!d.subjects.some((s) => s.name.toLowerCase() === name.toLowerCase()))
          d.subjects.push({ id: uid('disc'), name, short, color: PALETTE[d.subjects.length % PALETTE.length] });
    });
  const remove = async (id: string, name: string) => {
    const n = data.assignments.filter((a) => a.subjectId === id).length;
    if (await confirmDialog('Excluir disciplina', <>Excluir <b>{name}</b>?{n > 0 && <> Ela está em <b>{n}</b> linha(s) de matriz curricular, que também serão excluídas.</>}</>, { danger: true, okLabel: 'Excluir' }))
      update((d) => deleteSubject(d, id));
  };
  return (
    <Card title="Disciplinas" actions={<>
      <button className="btn small" onClick={addCommon} title="Adiciona apenas as que ainda não existem">+ Disciplinas mais comuns</button>
      <button className="btn small primary" onClick={() => update((d) => { d.subjects.push({ id: uid('disc'), name: `Nova disciplina ${d.subjects.length + 1}`, short: 'NOVA', color: PALETTE[d.subjects.length % PALETTE.length] }); })}>+ Nova disciplina</button>
    </>}>
      {data.subjects.length === 0 ? <Empty>Nenhuma disciplina cadastrada.</Empty> : (
        <table className="tbl">
          <thead><tr><th>Cor</th><th>Nome</th><th>Sigla</th><th className="num">Aulas na matriz</th><th className="num">Professores</th><th></th></tr></thead>
          <tbody>
            {data.subjects.map((s) => (
              <tr key={s.id}>
                <td><input type="color" value={s.color} aria-label={`Cor de ${s.name}`} onChange={(e) => update((d) => { d.subjects.find((x) => x.id === s.id)!.color = e.target.value; })} /></td>
                <td><TextInput value={s.name} required onChange={(v) => update((d) => { d.subjects.find((x) => x.id === s.id)!.name = v; })} /></td>
                <td><TextInput value={s.short} required className="num" onChange={(v) => update((d) => { d.subjects.find((x) => x.id === s.id)!.short = v; })} /></td>
                <td className="num">{data.assignments.filter((a) => a.subjectId === s.id).reduce((x, a) => x + a.lessons, 0)}</td>
                <td className="num">{data.teachers.filter((t) => t.subjectIds.includes(s.id)).length}</td>
                <td><button className="btn small danger" onClick={() => remove(s.id, s.name)}>Excluir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CopyMatrix({ targetId, onClose }: { targetId: string; onClose: () => void }) {
  const data = useData();
  const { update, toast } = useStore();
  const [src, setSrc] = useState('');
  const [withTeachers, setWithTeachers] = useState(true);
  const target = data.classes.find((c) => c.id === targetId)!;
  const go = async () => {
    const has = data.assignments.some((a) => a.classId === targetId);
    if (has && !(await confirmDialog('Substituir matriz', 'A matriz atual desta turma será substituída. Continuar?', { danger: true }))) return;
    update((d) => {
      deleteAssignments(d, new Set(d.assignments.filter((a) => a.classId === targetId).map((a) => a.id)));
      for (const a of d.assignments.filter((x) => x.classId === src))
        d.assignments.push({ ...a, id: uid('atr'), classId: targetId, teacherId: withTeachers ? a.teacherId : null });
    });
    toast('Matriz copiada.');
    onClose();
  };
  return (
    <Modal title={`Copiar matriz para ${className(data, target)}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!src} onClick={go}>Copiar</button></>}>
      <select className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
        <option value="">Selecione a turma de origem…</option>
        {sortedClasses(data).filter((c) => c.id !== targetId && data.assignments.some((a) => a.classId === c.id)).map((c) => (
          <option key={c.id} value={c.id}>{className(data, c)} ({data.periods.find((p) => p.id === c.periodId)?.name})</option>
        ))}
      </select>
      <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={withTeachers} onChange={(e) => setWithTeachers(e.target.checked)} /> Copiar também os professores</label>
    </Modal>
  );
}

function ClassMatrix({ classId }: { classId: string }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [copy, setCopy] = useState(false);
  const c = data.classes.find((x) => x.id === classId)!;
  const rows = data.assignments.filter((a) => a.classId === classId);
  const sum = rows.reduce((s, a) => s + a.lessons, 0);
  const period = data.periods.find((p) => p.id === c.periodId);
  const set = (id: string, fn: (a: Assignment) => void) =>
    update((d) => {
      const a = d.assignments.find((x) => x.id === id)!;
      fn(a);
      linkTeacherSubject(d, a.teacherId, a.subjectId);
    });
  const teachers = [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return (
    <Card title={`Matriz curricular – ${className(data, c)} (${period?.name})`} actions={<>
      <button className="btn small" onClick={() => setCopy(true)}>Copiar de outra turma</button>
      <button className="btn small primary" disabled={!data.subjects.length} onClick={() => update((d) => { d.assignments.push({ id: uid('atr'), classId, subjectId: d.subjects[0].id, teacherId: null, lessons: 1, maxPerDay: null, double: 'indiferente' }); })}>+ Adicionar disciplina</button>
    </>}>
      {!data.subjects.length && <div className="note warn">Cadastre as disciplinas primeiro (aba "Disciplinas").</div>}
      <div className="row" style={{ marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div className={'progress ' + (sum === c.weeklyLessons ? 'ok' : sum > c.weeklyLessons ? 'erro' : '')}><div style={{ width: `${Math.min(100, (100 * sum) / Math.max(1, c.weeklyLessons))}%` }} /></div>
        </div>
        <Badge kind={sum === c.weeklyLessons ? 'ok' : sum > c.weeklyLessons ? 'erro' : 'aviso'}>{sum} de {c.weeklyLessons} aulas semanais</Badge>
      </div>
      {sum > c.weeklyLessons && <div className="note err">A matriz ultrapassa a quantidade de aulas semanais da turma.</div>}
      {sum < c.weeklyLessons && rows.length > 0 && <div className="note warn">Faltam {c.weeklyLessons - sum} aula(s) para completar a carga semanal da turma.</div>}
      {rows.length === 0 ? <Empty>Nenhuma disciplina na matriz desta turma.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Disciplina</th><th>Professor</th><th className="num">Aulas semanais</th><th className="num">Máx. por dia</th><th>Aulas geminadas</th><th></th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const t = data.teachers.find((x) => x.id === a.teacherId);
                const wrongPeriod = t && !t.periodIds.includes(c.periodId);
                return (
                  <tr key={a.id}>
                    <td>
                      <select className="input" value={a.subjectId} onChange={(e) => set(a.id, (x) => { x.subjectId = e.target.value; })} aria-label="Disciplina">
                        {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={a.teacherId ?? ''} onChange={(e) => set(a.id, (x) => { x.teacherId = e.target.value || null; })} aria-label="Professor">
                        <option value="">— sem professor —</option>
                        {teachers.map((tt) => (
                          <option key={tt.id} value={tt.id}>
                            {tt.name}{tt.subjectIds.includes(a.subjectId) ? ' ★' : ''}{!tt.periodIds.includes(c.periodId) ? ' (não trabalha neste período)' : ''}
                          </option>
                        ))}
                      </select>
                      {!a.teacherId && <div className="field-error">Selecione o professor.</div>}
                      {wrongPeriod && <div className="field-error">Este professor não está cadastrado para o período {period?.name}.</div>}
                    </td>
                    <td className="num"><NumInput value={a.lessons} min={0} max={period ? period.slots.length * data.school.days.length : 99} onChange={(v) => set(a.id, (x) => { x.lessons = v ?? 0; })} ariaLabel="Aulas semanais" /></td>
                    <td className="num"><NumInput value={a.maxPerDay} min={1} max={period?.slots.length} allowEmpty placeholder="—" onChange={(v) => set(a.id, (x) => { x.maxPerDay = v; })} ariaLabel="Máximo por dia" /></td>
                    <td>
                      <select className="input" value={a.double} onChange={(e) => set(a.id, (x) => { x.double = e.target.value as Assignment['double']; })} aria-label="Aulas geminadas">
                        <option value="indiferente">Indiferente</option>
                        <option value="preferir">Preferir duplas</option>
                      </select>
                    </td>
                    <td><button className="btn small danger" onClick={() => update((d) => deleteAssignments(d, new Set([a.id])))}>Remover</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>★ = o professor tem esta disciplina no cadastro. "Máx. por dia" é uma restrição obrigatória; "preferir duplas" é preferência. Alterações aqui aparecem automaticamente nas atribuições do professor.</p>
      {copy && <CopyMatrix targetId={classId} onClose={() => setCopy(false)} />}
    </Card>
  );
}

export default function MatrixPage() {
  const data = useData();
  const param = useStore((s) => s.pageParam);
  const [tab, setTab] = useState<'matriz' | 'disciplinas'>(data.subjects.length ? 'matriz' : 'disciplinas');
  const classes = sortedClasses(data);
  const [sel, setSel] = useState<string | null>(param && data.classes.some((c) => c.id === param) ? param : classes[0]?.id ?? null);
  useEffect(() => {
    if (param && data.classes.some((c) => c.id === param)) { setSel(param); setTab('matriz'); }
  }, [param, data.classes]);
  const current = sel && data.classes.some((c) => c.id === sel) ? sel : classes[0]?.id ?? null;

  return (
    <>
      <PageHeader title="Matriz curricular" subtitle="Informe, para cada turma, as disciplinas, os professores e a quantidade de aulas semanais. Os dados são os mesmos das atribuições no cadastro de professores." />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'matriz', label: 'Matriz por turma' }, { id: 'disciplinas', label: `Disciplinas (${data.subjects.length})` }]} />
      {tab === 'disciplinas' ? <SubjectsTab /> : !classes.length ? <Empty>Cadastre as turmas primeiro.</Empty> : (
        <div className="split">
          <Card title="Turmas">
            <div className="list-sel">
              {data.periods.map((p) => (
                <div key={p.id}>
                  <div className="nav-group" style={{ color: '#64748b' }}>{p.name}</div>
                  {classes.filter((c) => c.periodId === p.id).map((c) => {
                    const sum = data.assignments.filter((a) => a.classId === c.id).reduce((s, a) => s + a.lessons, 0);
                    const noT = data.assignments.some((a) => a.classId === c.id && !a.teacherId);
                    return (
                      <button key={c.id} className={c.id === current ? 'active' : ''} onClick={() => setSel(c.id)} style={{ width: '100%' }}>
                        <span>{c.name}</span>
                        <Badge kind={sum === c.weeklyLessons && !noT ? 'ok' : sum > c.weeklyLessons ? 'erro' : 'aviso'}>{sum}/{c.weeklyLessons}</Badge>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
          {current && <ClassMatrix classId={current} />}
        </div>
      )}
    </>
  );
}
