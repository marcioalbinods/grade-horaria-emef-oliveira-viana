import { Fragment, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { Badge, Card, Check, confirmDialog, IssueList, NumInput, PageHeader } from '../components/ui';
import { cancelJob, getJob, health, LOCAL_SERVER, servedLocally, startSolve, type Diagnosis, type Job } from '../logic/api';
import { checkData, isBlocking } from '../logic/checks';
import { validateSchedule } from '../logic/conflicts';
import { computeMetrics, CRITERIA_WEIGHTS, STRATEGIES, type Metrics } from '../logic/metrics';
import { buildProblem } from '../logic/payload';
import { className, uid } from '../logic/util';
import { activeSchedule, useData, useStore } from '../store';
import type { AppData, Schedule, StrategyId } from '../types';

interface SolveState {
  job: Job | null;
  jobId: string | null;
  startedAt: number | null;
  error: string | null;
  createdIds: string[];
}
const useSolve = create<SolveState>(() => ({ job: null, jobId: null, startedAt: null, error: null, createdIds: [] }));

async function poll(serverUrl: string, id: string) {
  for (;;) {
    if (useSolve.getState().jobId !== id) return;
    try {
      const job = await getJob(serverUrl, id);
      useSolve.setState({ job });
      if (job.state !== 'running') {
        handleFinished(job);
        return;
      }
    } catch (e) {
      useSolve.setState({ error: String((e as Error).message ?? e), jobId: null });
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function handleFinished(job: Job) {
  const { update, toast } = useStore.getState();
  const ids: string[] = [];
  if (job.state === 'done' && job.outcome === 'ok' && job.results) {
    update((d) => {
      let n = d.schedules.length;
      const now = new Date();
      for (const r of job.results!) {
        if (!r.entries.length) continue;
        n++;
        const sch: Schedule = {
          id: uid('grade'),
          name: `Grade ${n} – ${STRATEGIES.find((s) => s.id === r.strategy)?.label ?? r.label}`,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          strategy: r.strategy,
          label: r.label,
          entries: r.entries.map((e) => ({ ...e })),
          edited: false,
          solver: { status: r.status, wallTime: r.wallTime, objective: r.objective, bound: r.bound },
          notes: '',
        };
        d.schedules.push(sch);
        ids.push(sch.id);
      }
      if (ids.length && !d.activeScheduleId) d.activeScheduleId = ids[ids.length - 1];
    });
    toast(`${ids.length} grade(s) gerada(s). Compare e selecione a melhor.`);
  }
  useSolve.setState({ createdIds: ids, jobId: null });
}

function ScoreBars({ m }: { m: Metrics }) {
  return (
    <div>
      {m.criteria.map((c) => (
        <div key={c.id} className="score-bar" title={c.explanation}>
          <span>{c.label}</span>
          <div className="progress"><div style={{ width: `${c.score}%` }} /></div>
          <b>{Math.round(c.score)}</b>
        </div>
      ))}
    </div>
  );
}

function Diagnose({ data, diag, outcome }: { data: AppData; diag: Diagnosis | null | undefined; outcome?: string }) {
  const asg = new Map(data.assignments.map((a) => [a.id, a]));
  const byClass = new Map<string, { label: string; missing: number }[]>();
  for (const u of diag?.unplaced ?? []) {
    const a = asg.get(u.assignmentId);
    if (!a) continue;
    const c = data.classes.find((x) => x.id === a.classId);
    const key = className(data, c);
    const s = data.subjects.find((x) => x.id === a.subjectId)?.name;
    const t = data.teachers.find((x) => x.id === a.teacherId)?.name;
    byClass.set(key, [...(byClass.get(key) ?? []), { label: `${s} (${t})`, missing: u.missing }]);
  }
  const teachersInCore = new Set<string>();
  for (const g of diag?.core ?? []) for (const r of g.refs) if (data.teachers.some((t) => t.id === r)) teachersInCore.add(r);
  return (
    <Card title={outcome === 'timeout' ? '⏱ Nenhuma grade encontrada no tempo limite' : '✕ Não é possível montar uma grade completa'} className="diag">
      <div className="note err">
        Nenhuma grade foi gerada, para não apresentar uma grade aparentemente válida que viole restrições obrigatórias.
        {outcome === 'timeout' && ' O motor não conseguiu provar se existe solução no tempo disponível: aumente o tempo por grade ou revise as restrições indicadas abaixo.'}
      </div>
      {!diag ? <p className="muted">Diagnóstico indisponível.</p> : (
        <>
          {diag.structural && (
            <>
              <h3>Incompatibilidade matemática</h3>
              <p>O problema é impossível mesmo sem as restrições configuráveis (indisponibilidades, limites, regras de atividades). Normalmente isso indica excesso de aulas para os horários existentes (por exemplo, um professor com mais aulas do que horários no período, ou uma turma com mais aulas do que horários).</p>
            </>
          )}
          {diag.core.length > 0 && (
            <>
              <h3 style={{ marginTop: 10 }}>Restrições excessivas — estas restrições, juntas, impedem a montagem</h3>
              <ul className="issues">
                {diag.core.map((g) => (
                  <li key={g.key} className="issue erro">
                    <Badge kind="erro">Restrição</Badge>
                    <div className="issue-body"><div>{g.message}</div><div className="muted small">Sugestão: {g.suggestion}</div></div>
                  </li>
                ))}
              </ul>
              {!diag.complete && <p className="muted small">A análise foi interrompida pelo tempo: a lista pode conter restrições que não são estritamente necessárias.</p>}
            </>
          )}
          {diag.relax.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Menor flexibilização encontrada</h3>
              <p className="small">Flexibilizar apenas as restrições abaixo já permitiria montar a grade{diag.relaxOptimal ? ' (menor conjunto possível)' : ''}:</p>
              <ul>{diag.relax.map((g) => <li key={g.key}>{g.message}</li>)}</ul>
            </>
          )}
          {byClass.size > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Turmas e disciplinas que não conseguem ser alocadas</h3>
              <p className="small muted">Mesmo na melhor distribuição possível com as restrições atuais, faltariam estas aulas:</p>
              <table className="tbl">
                <thead><tr><th>Turma</th><th>Disciplina (professor)</th><th className="num">Aulas sem horário</th></tr></thead>
                <tbody>
                  {[...byClass.entries()].map(([cls, list]) => list.map((x, i) => (
                    <tr key={cls + i}><td>{i === 0 ? cls : ''}</td><td>{x.label}</td><td className="num">{x.missing}</td></tr>
                  )))}
                </tbody>
              </table>
            </>
          )}
          {teachersInCore.size > 0 && <p className="small" style={{ marginTop: 10 }}>Professores envolvidos: <b>{[...teachersInCore].map((id) => data.teachers.find((t) => t.id === id)?.name).join(', ')}</b></p>}
          {!diag.core.length && !diag.structural && !byClass.size && <p className="muted">Não foi possível isolar a causa no tempo disponível. Tente aumentar o tempo por grade.</p>}
        </>
      )}
    </Card>
  );
}

export default function SolvePage() {
  const data = useData();
  const { update, go, toast } = useStore();
  const solve = useSolve();
  const issues = useMemo(() => checkData(data), [data]);
  const blocking = issues.filter(isBlocking);
  const [server, setServer] = useState<{ ok: boolean; text: string } | null>(null);
  const [keepLocks, setKeepLocks] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const opts = data.school.solver;
  const active = activeSchedule(data);
  const locks = active ? active.entries.filter((e) => e.locked) : [];

  const checkServer = () => {
    setServer(null);
    health(opts.serverUrl)
      .then((h) => setServer({ ok: true, text: `Motor de otimização conectado (Google OR-Tools ${h.ortools}, ${h.solver}).` }))
      .catch((e) => setServer({ ok: false, text: String(e.message ?? e) }));
  };
  useEffect(checkServer, [opts.serverUrl]);
  useEffect(() => {
    if (!solve.jobId || !solve.startedAt) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - solve.startedAt!) / 1000)), 500);
    return () => clearInterval(t);
  }, [solve.jobId, solve.startedAt]);

  const generate = async () => {
    if (blocking.length) return;
    const pend = issues.filter((i) => i.category === 'pendencia');
    if (pend.length && !(await confirmDialog('Existem informações pendentes',
      <><p>Há <b>{pend.length}</b> informação(ões) pendente(s), por exemplo:</p><ul>{pend.slice(0, 4).map((p, i) => <li key={i}>{p.message}</li>)}</ul><p>A grade será gerada apenas com os dados já cadastrados. Deseja continuar?</p></>, { okLabel: 'Gerar mesmo assim' }))) return;
    if (!opts.strategies.length) { toast('Selecione ao menos uma prioridade.', 'aviso'); return; }
    const problem = buildProblem(data, { strategies: opts.strategies, timeLimit: opts.timeLimit, locks: keepLocks ? locks : [] });
    useSolve.setState({ error: null, job: null, createdIds: [] });
    try {
      const { jobId } = await startSolve(opts.serverUrl, problem);
      useSolve.setState({ jobId, startedAt: Date.now() });
      poll(opts.serverUrl, jobId);
    } catch (e) {
      useSolve.setState({ error: String((e as Error).message ?? e) });
    }
  };
  const cancel = async () => {
    if (!solve.jobId) return;
    try { await cancelJob(opts.serverUrl, solve.jobId); } catch { /* ignore */ }
  };

  const job = solve.job;
  const results = (job?.results ?? []).filter((r) => r.entries.length);
  const created = data.schedules.filter((s) => solve.createdIds.includes(s.id));
  const compared = created.map((s) => ({ s, m: computeMetrics(data, s.entries, s.strategy), v: validateSchedule(data, s.entries) }));
  const bestId = compared.length ? compared.reduce((a, b) => (computeMetrics(data, b.s.entries).overall > computeMetrics(data, a.s.entries).overall ? b : a)).s.id : null;
  const totalTime = opts.strategies.length * opts.timeLimit;

  return (
    <>
      <PageHeader title="Montagem automática" subtitle="O motor de otimização combinatória (Google OR-Tools CP-SAT) monta grades que respeitam todas as restrições obrigatórias e otimiza as preferências conforme a prioridade escolhida." />
      <div className="grid2">
        <Card title="1. Verificação dos dados">
          {blocking.length > 0 ? (
            <div className="note err">Existem <b>{blocking.length}</b> erro(s) de cadastro ou incompatibilidade(s) que impedem a montagem. Corrija-os abaixo.</div>
          ) : (
            <div className="note">Nenhum erro impeditivo. {issues.length > 0 && `${issues.length} pendência(s)/aviso(s) — revise abaixo.`}</div>
          )}
          <IssueList issues={issues} limit={6} empty="✓ Todos os dados necessários estão preenchidos." />
        </Card>
        <Card title="2. Opções da montagem">
          <div className={'note ' + (server ? (server.ok ? '' : 'err') : '')}>
            {server ? server.text : 'Verificando o motor de otimização…'}{' '}
            {server && !server.ok && <button className="btn small" onClick={checkServer}>Tentar novamente</button>}
          </div>
          {server && !server.ok && !servedLocally() && (
            <div className="note warn">
              <b>Como gerar a grade a partir desta versão online:</b>
              <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li>Baixe o sistema em <a href="https://github.com/marcioalbinods/grade-horaria-emef-oliveira-viana/archive/refs/heads/main.zip">github.com/marcioalbinods/grade-horaria-emef-oliveira-viana</a> (arquivo ZIP) e descompacte.</li>
                <li>Instale o Python 3.10+ (no Windows, marque "Add Python to PATH").</li>
                <li>Abra <b>iniciar.bat</b> (Windows) ou <b>iniciar.sh</b> (Linux/macOS) e deixe a janela aberta.</li>
                <li>Volte aqui e clique em "Tentar novamente". Se o navegador perguntar, permita o acesso à rede local ({LOCAL_SERVER}).</li>
              </ol>
              <p className="small" style={{ marginTop: 6 }}>Use Chrome, Edge ou Firefox (o Safari bloqueia essa conexão). Alternativa: use diretamente o endereço {LOCAL_SERVER} aberto pelo "iniciar" — mas lembre que os dados de cada endereço ficam separados (use backup e restauração para levá-los de um para o outro).</p>
            </div>
          )}
          <p className="field-label">Gerar uma grade para cada prioridade marcada:</p>
          {STRATEGIES.map((s) => (
            <div key={s.id}>
              <Check label={<><b>{s.label}</b> <span className="muted small">— {s.description}</span></>} checked={opts.strategies.includes(s.id)}
                onChange={(v) => update((d) => { const st = d.school.solver; st.strategies = v ? [...st.strategies, s.id as StrategyId] : st.strategies.filter((x) => x !== s.id); })} />
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <span>Tempo máximo de otimização por grade:</span>
            <NumInput value={opts.timeLimit} min={5} max={1800} onChange={(v) => update((d) => { d.school.solver.timeLimit = v ?? 30; })} ariaLabel="Tempo por grade (segundos)" />
            <span className="muted small">segundos (total estimado: até {Math.ceil(totalTime / 60)} min)</span>
          </div>
          <p className="muted small">Mais tempo tende a produzir grades melhores. Todas as restrições obrigatórias são sempre respeitadas, qualquer que seja o tempo.</p>
          {locks.length > 0 && <Check label={<>Manter as <b>{locks.length}</b> aula(s) bloqueada(s) da grade ativa ({active?.name})</>} checked={keepLocks} onChange={setKeepLocks} />}
          <div className="row" style={{ marginTop: 12 }}>
            {!solve.jobId ? (
              <button className="btn primary big" disabled={!!blocking.length || !server?.ok || !opts.strategies.length} onClick={generate}>⚙ Gerar grade(s)</button>
            ) : (
              <button className="btn danger" onClick={cancel}>Interromper</button>
            )}
          </div>
        </Card>
      </div>

      {solve.error && <div className="note err">{solve.error}</div>}
      {solve.jobId && (
        <Card title="Processando…">
          <p>
            {job?.progress?.strategy === 'diagnostico' ? 'Analisando por que não há solução…' : `Gerando grade ${job?.progress?.current ?? 1} de ${job?.progress?.total ?? opts.strategies.length}: ${STRATEGIES.find((s) => s.id === job?.progress?.strategy)?.label ?? '…'}`}
            {' '}· {elapsed}s
          </p>
          <div className="progress"><div style={{ width: `${Math.min(100, (100 * elapsed) / Math.max(1, totalTime))}%` }} /></div>
          <p className="muted small">O processamento acontece no motor de otimização. Você pode navegar por outras telas enquanto aguarda.</p>
        </Card>
      )}
      {job?.state === 'error' && <div className="note err">Erro no motor de otimização: {job.error}</div>}
      {job?.state === 'done' && job.outcome === 'precheck' && (
        <Card title="O motor encontrou problemas nos dados">
          <IssueList issues={(job.issues ?? []).map((i) => ({ category: i.category === 'cadastro' ? 'cadastro' : i.category === 'matematica' ? 'matematica' : 'aviso', message: i.message, suggestion: i.suggestion ?? undefined }))} />
        </Card>
      )}
      {job?.state === 'done' && job.outcome === 'cancelled' && <div className="note warn">Montagem interrompida. Nenhuma grade foi gerada.</div>}
      {job?.state === 'done' && (job.outcome === 'infeasible' || job.outcome === 'timeout') && <Diagnose data={data} diag={job.diagnosis} outcome={job.outcome} />}

      {compared.length > 0 && (
        <Card title="3. Comparação das grades geradas">
          <p className="muted small">
            Todas as grades abaixo respeitam 100% das restrições obrigatórias. A pontuação (0–100) serve apenas para comparar grades entre si e não é garantia
            absoluta de qualidade. Cada critério é explicado ao passar o mouse; a lista de preferências atendidas e não atendidas aparece em "Detalhes".
          </p>
          <div className="tbl-wrap">
            <table className="tbl compare">
              <thead>
                <tr><th>Grade</th><th>Situação</th><th>Janelas</th><th>Dias de comparecimento</th><th>Distribuição (excessos)</th><th>Preferências</th><th>Nota (prioridade)</th><th>Nota equilibrada</th><th></th></tr>
              </thead>
              <tbody>
                {compared.map(({ s, m, v }) => {
                  const balanced = computeMetrics(data, s.entries, 'equilibrada').overall;
                  const conf = v.filter((x) => x.severity === 'conflito').length;
                  return (
                    <tr key={s.id} className={s.id === bestId ? 'best' : ''}>
                      <td><b>{s.name}</b><div className="muted small">{s.solver?.status === 'otima' ? 'ótima para a prioridade' : 'melhor encontrada no tempo'} · {s.solver?.wallTime}s</div></td>
                      <td>{conf ? <Badge kind="erro">{conf} conflito(s)</Badge> : <Badge kind="ok">Sem conflitos</Badge>}</td>
                      <td>{m.totalGaps}</td>
                      <td>{m.totalDays} <span className="muted small">({m.totalShifts} turnos)</span></td>
                      <td>{m.distributionExcess + m.triples}</td>
                      <td>{m.preferences.filter((p) => p.met).length}/{m.preferences.length}</td>
                      <td><b>{Math.round(m.overall)}</b></td>
                      <td>{Math.round(balanced)}{s.id === bestId && <div><Badge kind="ok">melhor geral</Badge></div>}</td>
                      <td>
                        {data.activeScheduleId === s.id ? <Badge kind="info">Ativa</Badge> : <button className="btn small primary" onClick={() => update((d) => { d.activeScheduleId = s.id; })}>Selecionar</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {compared.map(({ s, m }) => (
            <details key={s.id} style={{ marginTop: 8 }}>
              <summary>Detalhes – {s.name}</summary>
              <div className="grid2" style={{ marginTop: 8 }}>
                <div>
                  <p className="small">Pesos da nota nesta prioridade: {Object.entries(CRITERIA_WEIGHTS[s.strategy] ?? {}).map(([k, w]) => `${k} ${w}%`).join(' · ')}</p>
                  <ScoreBars m={m} />
                  <ul className="small">{m.criteria.map((c) => <li key={c.id}><b>{c.label}:</b> {c.explanation}</li>)}</ul>
                </div>
                <div>
                  <h3 style={{ marginBottom: 6 }}>Preferências</h3>
                  {!m.preferences.length ? <p className="muted small">Nenhuma preferência individual cadastrada.</p> : (
                    <table className="tbl">
                      <tbody>
                        {m.preferences.map((p, i) => (
                          <Fragment key={i}>
                            <tr><td>{p.met ? <Badge kind="ok">atendida</Badge> : <Badge kind="aviso">não atendida</Badge>}</td><td className="small"><b>{p.who}</b>: {p.text}{p.detail && <span className="muted"> ({p.detail})</span>}</td></tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </details>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => go('grade-turma')}>Ver grade ativa por turma</button>
            <button className="btn" onClick={() => go('grade-professor')}>Ver por professor</button>
            <button className="btn" onClick={() => go('grade-geral')}>Grade geral</button>
          </div>
        </Card>
      )}
      {job?.state === 'done' && job.outcome === 'ok' && results.length < (job.results?.length ?? 0) && (
        <div className="note warn">Algumas prioridades não produziram grade no tempo limite: {job.results!.filter((r) => !r.entries.length).map((r) => r.label).join(', ')}.</div>
      )}
    </>
  );
}
