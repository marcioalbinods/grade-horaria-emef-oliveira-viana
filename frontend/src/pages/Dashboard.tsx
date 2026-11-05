import { useMemo } from 'react';
import { Card, IssueList, PageHeader, Stat } from '../components/ui';
import { checkData, isBlocking } from '../logic/checks';
import { validateSchedule } from '../logic/conflicts';
import { computeMetrics } from '../logic/metrics';
import { activeSchedule, useData, useStore } from '../store';

export default function Dashboard() {
  const data = useData();
  const go = useStore((s) => s.go);
  const issues = useMemo(() => checkData(data), [data]);
  const sch = activeSchedule(data);
  const viol = useMemo(() => (sch ? validateSchedule(data, sch.entries) : []), [data, sch]);
  const metrics = useMemo(() => (sch ? computeMetrics(data, sch.entries, sch.strategy) : null), [data, sch]);

  const needed = data.classes.reduce((s, c) => s + c.weeklyLessons, 0);
  const assigned = data.assignments.filter((a) => a.teacherId).reduce((s, a) => s + a.lessons, 0);
  const blocking = issues.filter(isBlocking);
  const pend = issues.filter((i) => i.category === 'pendencia');

  const periodsOk = data.periods.length > 0 && data.periods.every((p) => p.slots.length && p.slots.every((s) => s.start && s.end));
  const steps = [
    { label: 'Configurar a escola (dias letivos, unidade da jornada)', done: !!data.school.name && data.school.days.length > 0, page: 'escola' as const },
    { label: 'Configurar horários reais dos períodos e intervalos', done: periodsOk, page: 'periodos' as const },
    { label: 'Cadastrar turmas (inclusive as pendentes)', done: data.classes.length > 0 && data.pending.length === 0, warn: data.pending.length > 0, page: 'turmas' as const },
    { label: 'Cadastrar disciplinas e matriz curricular', done: data.subjects.length > 0 && data.classes.every((c) => data.assignments.some((a) => a.classId === c.id)), page: 'matriz' as const },
    { label: 'Cadastrar professores e atribuições', done: data.teachers.length > 0 && data.assignments.every((a) => a.teacherId), page: 'professores' as const },
    { label: 'Informar cargas horárias, H.A., CCH e HL', done: data.teachers.length > 0 && data.teachers.every((t) => t.workload.total != null), page: 'cargas' as const },
    { label: 'Registrar disponibilidades e restrições', done: data.teachers.length > 0, page: 'disponibilidade' as const },
    { label: 'Gerar a grade automaticamente', done: !!sch, page: 'montagem' as const },
  ];

  const byPeriod = data.periods.map((p) => ({ p, n: data.classes.filter((c) => c.periodId === p.id).length }));

  return (
    <>
      <PageHeader
        title={`Painel – ${data.school.name || 'Escola'}`}
        subtitle="Visão geral do cadastro e da grade horária."
        actions={<button className="btn primary" onClick={() => go('montagem')}>Montar grade</button>}
      />
      <div className="stats">
        {byPeriod.map(({ p, n }) => <Stat key={p.id} label={`Turmas – ${p.name}`} value={n} hint={`${p.slots.length} aulas por dia`} />)}
        <Stat label="Professores" value={data.teachers.length} />
        <Stat label="Disciplinas" value={data.subjects.length} />
        <Stat label="Aulas atribuídas" value={`${assigned}/${needed}`} hint="com professor / necessárias pelas turmas" kind={assigned === needed && needed > 0 ? 'ok' : 'aviso'} />
        <Stat label="Erros e incompatibilidades" value={blocking.length} kind={blocking.length ? 'erro' : 'ok'} hint={`${pend.length} pendência(s) de informação`} />
      </div>
      <div className="grid2">
        <Card title="Etapas da elaboração">
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i}>
                <span className={'step-dot ' + (s.done ? 'done' : s.warn ? 'warn' : 'todo')}>{s.done ? '✓' : i + 1}</span>
                <span style={{ flex: 1 }}>{s.label}</span>
                <button className="btn small" onClick={() => go(s.page)}>Abrir</button>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Grade ativa">
          {!sch ? (
            <p className="muted">Nenhuma grade foi gerada ainda. Complete o cadastro e use a Montagem automática.</p>
          ) : (
            <>
              <p><b>{sch.name}</b> <span className="muted small">· {new Date(sch.updatedAt).toLocaleString('pt-BR')}{sch.edited ? ' · editada manualmente' : ''}</span></p>
              <div className="row" style={{ margin: '10px 0' }}>
                <div className="score">{metrics ? Math.round(metrics.overall) : '—'}</div>
                <div className="muted small">pontuação comparativa (0–100)<br />não é garantia absoluta de qualidade</div>
              </div>
              <p>
                {viol.filter((v) => v.severity === 'conflito').length === 0 ? <span className="ok-text">✓ Sem conflitos obrigatórios</span> : <span className="err-text">⚠ {viol.filter((v) => v.severity === 'conflito').length} conflito(s)</span>}
                {' · '}
                {viol.filter((v) => v.severity === 'pendencia').length} pendência(s)
              </p>
              {metrics && <p className="muted small">{metrics.totalGaps} janela(s) · {metrics.totalDays} dias de comparecimento · {metrics.preferences.filter((p) => p.met).length}/{metrics.preferences.length} preferências atendidas</p>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => go('grade-turma')}>Ver por turma</button>
                <button className="btn" onClick={() => go('grade-professor')}>Ver por professor</button>
                <button className="btn" onClick={() => go('relatorios')}>Relatórios</button>
              </div>
            </>
          )}
        </Card>
      </div>
      <Card title="Pendências e problemas do cadastro">
        <IssueList issues={issues} limit={12} />
      </Card>
    </>
  );
}
