import { useEffect, useMemo, useState } from 'react';
import { ScheduleGrid } from '../components/ScheduleGrid';
import { Badge, Card, Empty, PageHeader, Stat } from '../components/ui';
import { validateSchedule, type Violation } from '../logic/conflicts';
import { exportPdf, exportXlsx } from '../logic/exporters';
import { computeMetrics } from '../logic/metrics';
import { buildReport } from '../logic/reports';
import { ACTIVITY_LABELS, className, entryKey, indexData, sortedClasses } from '../logic/util';
import { fmtNumber, workloadReport } from '../logic/workload';
import { activeSchedule, useData, useStore } from '../store';
import type { AppData, Schedule } from '../types';

export function useScheduleChoice(data: AppData) {
  const [id, setId] = useState<string | null>(null);
  const sch = data.schedules.find((s) => s.id === id) ?? activeSchedule(data) ?? data.schedules[data.schedules.length - 1] ?? null;
  return { sch, setId };
}

function Toolbar({ data, sch, setId, children, lockKeys }: { data: AppData; sch: Schedule; setId: (id: string) => void; children?: React.ReactNode; lockKeys: string[] }) {
  const { undoEdit, redoEdit, undo, redo, editEntries, update } = useStore();
  const canUndo = (undo[sch.id] ?? []).length > 0;
  const canRedo = (redo[sch.id] ?? []).length > 0;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoEdit(sch.id); }
      if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redoEdit(sch.id); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sch.id, undoEdit, redoEdit]);
  const allLocked = lockKeys.length > 0 && sch.entries.filter((e) => lockKeys.includes(entryKey(e))).every((e) => e.locked);
  return (
    <div className="sched-toolbar">
      <select className="input" style={{ maxWidth: 300 }} value={sch.id} onChange={(e) => setId(e.target.value)} aria-label="Grade exibida">
        {data.schedules.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === data.activeScheduleId ? ' (ativa)' : ''}</option>)}
      </select>
      {sch.id !== data.activeScheduleId && <button className="btn small" onClick={() => update((d) => { d.activeScheduleId = sch.id; })}>Tornar ativa</button>}
      {children}
      <span className="grow" />
      <button className="btn small" disabled={!canUndo} onClick={() => undoEdit(sch.id)} title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
      <button className="btn small" disabled={!canRedo} onClick={() => redoEdit(sch.id)} title="Refazer (Ctrl+Y)">↷ Refazer</button>
      <button className="btn small" disabled={!lockKeys.length} onClick={() => editEntries(sch.id, (list) => list.map((e) => (lockKeys.includes(entryKey(e)) ? { ...e, locked: !allLocked } : e)))}>
        {allLocked ? '🔓 Desbloquear todas' : '🔒 Bloquear todas'}
      </button>
      <button className="btn small" onClick={() => window.print()}>Imprimir</button>
    </div>
  );
}

function ViolationPanel({ list, total }: { list: Violation[]; total: Violation[] }) {
  const conf = list.filter((v) => v.severity === 'conflito');
  const pend = list.filter((v) => v.severity === 'pendencia');
  const totalConf = total.filter((v) => v.severity === 'conflito').length;
  return (
    <Card title="Conferência" className="no-print">
      <p>
        {conf.length ? <span className="err-text">⚠ {conf.length} conflito(s) aqui</span> : <span className="ok-text">✓ Sem conflitos aqui</span>}
        {' · '}{pend.length} pendência(s){' · '}
        <span className="muted small">Grade inteira: {totalConf} conflito(s), {total.length - totalConf} pendência(s)</span>
      </p>
      {list.length > 0 && (
        <ul className="issues">
          {list.slice(0, 30).map((v, i) => <li key={i} className={'issue ' + (v.severity === 'conflito' ? 'erro' : 'aviso')}><Badge kind={v.severity === 'conflito' ? 'erro' : 'aviso'}>{v.severity === 'conflito' ? 'Conflito' : 'Pendência'}</Badge><div className="issue-body">{v.message}</div></li>)}
        </ul>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>Arraste uma aula para outro horário (verde = sem conflito) ou sobre outra aula para trocá-las. Clique em um horário para trocar disciplina, professor, turma, bloquear ou inserir aulas. Toda alteração é verificada antes de ser aplicada.</p>
    </Card>
  );
}

function NoSchedule() {
  const go = useStore((s) => s.go);
  return <Empty action={<button className="btn primary" onClick={() => go('montagem')}>Ir para a montagem automática</button>}>Nenhuma grade gerada ainda.</Empty>;
}

export function ClassSchedulePage() {
  const data = useData();
  const { pageParam } = useStore();
  const { sch, setId } = useScheduleChoice(data);
  const classes = sortedClasses(data);
  const [cid, setCid] = useState<string | null>(pageParam && data.classes.some((c) => c.id === pageParam) ? pageParam : classes[0]?.id ?? null);
  const c = data.classes.find((x) => x.id === cid) ?? classes[0];
  const ix = useMemo(() => indexData(data), [data]);
  const all = useMemo(() => (sch ? validateSchedule(data, sch.entries) : []), [data, sch]);
  if (!sch) return <><PageHeader title="Grade por turma" /><NoSchedule /></>;
  if (!c) return <><PageHeader title="Grade por turma" /><Empty>Nenhuma turma cadastrada.</Empty></>;
  const p = data.periods.find((x) => x.id === c.periodId);
  const mineKeys = sch.entries.filter((e) => (e.kind === 'aula' ? ix.assignment.get(e.refId)?.classId : ix.activity.get(e.refId)?.classId) === c.id).map(entryKey);
  const keySet = new Set(mineKeys);
  const asgIds = new Set(data.assignments.filter((a) => a.classId === c.id).map((a) => a.id));
  const cname = className(data, c);
  const local = all.filter((v) => v.entries.some((k) => keySet.has(k)) || (v.entries.length === 0 && v.message.includes(`– ${cname}:`)));
  const g = data.grades.find((x) => x.id === c.gradeId);
  const lessonsHere = sch.entries.filter((e) => e.kind === 'aula' && asgIds.has(e.refId)).length;
  const exportThis = (kind: 'pdf' | 'xlsx') => {
    const r = buildReport(data, sch, 'grade-turma');
    const one = { ...r, title: `Grade ${className(data, c)}`, tables: r.tables.filter((t) => t.title === `Turma ${className(data, c)}`) };
    (kind === 'pdf' ? exportPdf : exportXlsx)(one, data.school.name);
  };
  return (
    <>
      <PageHeader title={`Grade da turma ${className(data, c)}`} subtitle={`${p?.name ?? ''} · ${g?.name ?? ''} · ${lessonsHere} de ${c.weeklyLessons} aulas semanais · ${sch.name}`}
        actions={<><button className="btn" onClick={() => exportThis('pdf')}>PDF</button><button className="btn" onClick={() => exportThis('xlsx')}>Excel</button></>} />
      <Card>
        <Toolbar data={data} sch={sch} setId={setId} lockKeys={mineKeys}>
          <select className="input" style={{ maxWidth: 220 }} value={c.id} onChange={(e) => setCid(e.target.value)} aria-label="Turma">
            {data.periods.map((per) => (
              <optgroup key={per.id} label={per.name}>
                {classes.filter((x) => x.periodId === per.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Toolbar>
        {p && <ScheduleGrid data={data} schedule={sch} period={p} mode={{ kind: 'turma', classId: c.id }} violations={all} />}
        <div className="row" style={{ marginTop: 10 }}>
          {data.assignments.filter((a) => a.classId === c.id).map((a) => {
            const s = ix.subject.get(a.subjectId);
            const n = sch.entries.filter((e) => e.kind === 'aula' && e.refId === a.id).length;
            return <span key={a.id} className="color-chip" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}><span className="swatch" style={{ background: s?.color }} />{s?.name}: {n}/{a.lessons}</span>;
          })}
        </div>
      </Card>
      <ViolationPanel list={local} total={all} />
    </>
  );
}

export function TeacherSchedulePage() {
  const data = useData();
  const { pageParam } = useStore();
  const { sch, setId } = useScheduleChoice(data);
  const teachers = [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const [tid, setTid] = useState<string | null>(pageParam && data.teachers.some((t) => t.id === pageParam) ? pageParam : teachers[0]?.id ?? null);
  const t = data.teachers.find((x) => x.id === tid) ?? teachers[0];
  const ix = useMemo(() => indexData(data), [data]);
  const all = useMemo(() => (sch ? validateSchedule(data, sch.entries) : []), [data, sch]);
  const metrics = useMemo(() => (sch ? computeMetrics(data, sch.entries, sch.strategy) : null), [data, sch]);
  if (!sch) return <><PageHeader title="Grade por professor" /><NoSchedule /></>;
  if (!t) return <><PageHeader title="Grade por professor" /><Empty>Nenhum professor cadastrado.</Empty></>;
  const mineKeys = sch.entries.filter((e) => (e.kind === 'aula' ? ix.assignment.get(e.refId)?.teacherId : ix.activity.get(e.refId)?.teacherId) === t.id).map(entryKey);
  const keySet = new Set(mineKeys);
  const local = all.filter((v) => v.entries.some((k) => keySet.has(k)) || v.message.startsWith(t.name) || v.message.includes(`de ${t.name}`));
  const st = metrics?.teachers.get(t.id);
  const wr = workloadReport(data, t);
  const mine = data.assignments.filter((a) => a.teacherId === t.id);
  const exportThis = (kind: 'pdf' | 'xlsx') => {
    const r = buildReport(data, sch, 'grade-professor');
    const one = { ...r, title: `Grade ${t.name}`, tables: r.tables.filter((x) => x.title.startsWith(`${t.name} — `)) };
    (kind === 'pdf' ? exportPdf : exportXlsx)(one, data.school.name);
  };
  const notInGrid = data.activities.filter((r) => r.teacherId === t.id && !r.inGrid);
  return (
    <>
      <PageHeader title={`Grade de ${t.name}`} subtitle={sch.name} actions={<><button className="btn" onClick={() => exportThis('pdf')}>PDF</button><button className="btn" onClick={() => exportThis('xlsx')}>Excel</button></>} />
      <div className="stats">
        <Stat label="Total de aulas" value={st?.lessons ?? 0} hint={`atribuídas: ${mine.reduce((s, a) => s + a.lessons, 0)}`} />
        <Stat label="H.A." value={st?.activities.HA ?? 0} />
        <Stat label="CCH" value={st?.activities.CCH ?? 0} />
        <Stat label="HL" value={st?.activities.HL ?? 0} />
        <Stat label="Janelas" value={st?.gaps ?? 0} kind={(st?.gaps ?? 0) > 0 ? 'aviso' : 'ok'} />
        <Stat label="Dias trabalhados" value={st?.days ?? 0} hint={(st?.daysList ?? []).map((d) => data.school.days[d]?.slice(0, 3)).join(', ')} />
        <Stat label={`Carga contabilizada (${wr.unit})`} value={fmtNumber(wr.computedTotal)} hint={wr.declaredTotal != null ? `declarada: ${fmtNumber(wr.declaredTotal)}` : 'carga total não declarada'} kind={wr.divergences.length ? 'aviso' : undefined} />
      </div>
      <Card>
        <Toolbar data={data} sch={sch} setId={setId} lockKeys={mineKeys}>
          <select className="input" style={{ maxWidth: 260 }} value={t.id} onChange={(e) => setTid(e.target.value)} aria-label="Professor">
            {teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Toolbar>
        <p className="small"><b>Turmas atendidas:</b> {[...new Set(mine.map((a) => className(data, ix.cls.get(a.classId))))].join(', ') || '—'} · <b>Disciplinas:</b> {[...new Set(mine.map((a) => ix.subject.get(a.subjectId)?.name))].join(', ') || '—'}</p>
        {t.periodIds.map((pid) => {
          const p = data.periods.find((x) => x.id === pid);
          return p ? <div key={pid} style={{ marginBottom: 14 }}><ScheduleGrid data={data} schedule={sch} period={p} mode={{ kind: 'professor', teacherId: t.id }} violations={all} /></div> : null;
        })}
        {notInGrid.length > 0 && <p className="muted small">Atividades contabilizadas fora da grade: {notInGrid.map((r) => `${r.qty} ${r.label || ACTIVITY_LABELS[r.type]}`).join(', ')}.</p>}
        <div className="legend"><span className="l-pref">Janela = horário vago entre compromissos no mesmo turno</span></div>
      </Card>
      <ViolationPanel list={local} total={all} />
    </>
  );
}
