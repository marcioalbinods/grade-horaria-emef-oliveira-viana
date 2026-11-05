import { Fragment, useMemo, useState } from 'react';
import { Card, Empty, PageHeader, Tabs } from '../components/ui';
import { validateSchedule } from '../logic/conflicts';
import { ACTIVITY_LABELS, contrastText, entryKey, indexData, sortedClasses } from '../logic/util';
import { useData, useStore } from '../store';
import { useScheduleChoice } from './SchedulePages';

const initials = (name: string) => name.split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

export default function OverviewPage() {
  const data = useData();
  const { update, go } = useStore();
  const { sch, setId } = useScheduleChoice(data);
  const [view, setView] = useState<'turmas' | 'professores'>('turmas');
  const [pid, setPid] = useState(data.periods[0]?.id ?? '');
  const ix = useMemo(() => indexData(data), [data]);
  const conflictKeys = useMemo(() => new Set(sch ? validateSchedule(data, sch.entries).filter((v) => v.severity === 'conflito').flatMap((v) => v.entries) : []), [data, sch]);
  if (!sch) return <><PageHeader title="Grade geral" /><Empty action={<button className="btn primary" onClick={() => go('montagem')}>Montagem automática</button>}>Nenhuma grade gerada ainda.</Empty></>;
  const p = data.periods.find((x) => x.id === pid) ?? data.periods[0];
  if (!p) return <Empty>Nenhum período cadastrado.</Empty>;
  const days = data.school.days;
  const byCell = new Map<string, typeof sch.entries>();
  for (const e of sch.entries) {
    if (e.periodId !== p.id) continue;
    const owner = view === 'turmas'
      ? (e.kind === 'aula' ? ix.assignment.get(e.refId)?.classId : ix.activity.get(e.refId)?.classId)
      : (e.kind === 'aula' ? ix.assignment.get(e.refId)?.teacherId : ix.activity.get(e.refId)?.teacherId);
    if (!owner) continue;
    const k = `${owner}|${e.day}|${e.slot}`;
    byCell.set(k, [...(byCell.get(k) ?? []), e]);
  }
  const rows = view === 'turmas'
    ? sortedClasses(data).filter((c) => c.periodId === p.id).map((c) => ({ id: c.id, name: c.name, page: 'grade-turma' as const }))
    : [...data.teachers].filter((t) => t.periodIds.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((t) => ({ id: t.id, name: t.name, page: 'grade-professor' as const }));

  return (
    <>
      <PageHeader title="Grade geral" subtitle="Organização de todas as turmas ou de todos os professores. Clique no nome para abrir a grade detalhada (e editar)." />
      <Card>
        <div className="sched-toolbar">
          <select className="input" style={{ maxWidth: 300 }} value={sch.id} onChange={(e) => setId(e.target.value)} aria-label="Grade">
            {data.schedules.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === data.activeScheduleId ? ' (ativa)' : ''}</option>)}
          </select>
          <select className="input" style={{ maxWidth: 160 }} value={p.id} onChange={(e) => setPid(e.target.value)} aria-label="Período">
            {data.periods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <span className="grow" />
          <button className="btn small" onClick={() => window.print()}>Imprimir</button>
        </div>
        <Tabs value={view} onChange={setView} items={[{ id: 'turmas', label: 'Por turma' }, { id: 'professores', label: 'Por professor' }]} />
        {!rows.length ? <Empty>Nada para exibir neste período.</Empty> : (
          <div className="overview-wrap">
            <table className="overview">
              <thead>
                <tr>
                  <th className="rowh" rowSpan={2}>{view === 'turmas' ? 'Turma' : 'Professor'}</th>
                  {days.map((d, i) => <th key={i} colSpan={p.slots.length} className="day-sep">{d}</th>)}
                </tr>
                <tr>
                  {days.map((_, d) => p.slots.map((_, s) => <th key={`${d}-${s}`} className={s === 0 ? 'day-sep' : ''}>{s + 1}ª</th>))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th className="rowh"><button className="btn link" onClick={() => go(r.page, r.id)}>{r.name}</button></th>
                    {days.map((_, d) => p.slots.map((_, s) => {
                      const list = byCell.get(`${r.id}|${d}|${s}`) ?? [];
                      const e = list[0];
                      const cls = s === 0 ? 'day-sep' : '';
                      if (!e) return <td key={`${d}-${s}`} className={cls}><div className="oc" /></td>;
                      const conflict = list.length > 1 || conflictKeys.has(entryKey(e));
                      if (e.kind === 'atividade') {
                        const a = ix.activity.get(e.refId);
                        return <td key={`${d}-${s}`} className={cls}><div className="oc" style={{ background: '#e2e8f0', outline: conflict ? '2px solid #ef4444' : undefined }} title={a?.label}>{a ? ACTIVITY_LABELS[a.type] : '?'}</div></td>;
                      }
                      const a = ix.assignment.get(e.refId);
                      const sub = a ? ix.subject.get(a.subjectId) : undefined;
                      const color = sub?.color ?? '#64748b';
                      const t = a?.teacherId ? ix.teacher.get(a.teacherId) : undefined;
                      const second = view === 'turmas' ? initials(t?.name ?? '') : ix.cls.get(a?.classId ?? '')?.name ?? '';
                      return (
                        <td key={`${d}-${s}`} className={cls}>
                          <div className="oc" style={{ background: color, color: contrastText(color), outline: conflict ? '2px solid #ef4444' : undefined }}
                            title={`${sub?.name} – ${t?.name ?? 'sem professor'} – ${ix.cls.get(a?.classId ?? '')?.name}`}>
                            <b>{sub?.short}</b><span>{second}</span>
                          </div>
                        </td>
                      );
                    }))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Cores das disciplinas (clique para personalizar)">
        <div>
          {data.subjects.map((s) => (
            <Fragment key={s.id}>
              <label className="color-chip" style={{ background: s.color, color: contrastText(s.color) }}>
                <input type="color" value={s.color} onChange={(e) => update((d) => { d.subjects.find((x) => x.id === s.id)!.color = e.target.value; })} aria-label={`Cor de ${s.name}`} />
                {s.short} – {s.name}
              </label>
            </Fragment>
          ))}
        </div>
      </Card>
    </>
  );
}
