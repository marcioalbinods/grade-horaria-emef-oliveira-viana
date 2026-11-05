import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { describeEntry, newConflicts, swapEntries, validateSchedule, validTargets, type Violation } from '../logic/conflicts';
import { ACTIVITY_LABELS, className, contrastText, entryKey, indexData, slotTime } from '../logic/util';
import { useStore } from '../store';
import type { AppData, Entry, Period, Schedule } from '../types';
import { Badge, Modal } from './ui';

export type GridMode = { kind: 'turma'; classId: string } | { kind: 'professor'; teacherId: string };

interface Props {
  data: AppData;
  schedule: Schedule;
  period: Period;
  mode: GridMode;
  violations: Violation[];
}

function belongs(ix: ReturnType<typeof indexData>, e: Entry, mode: GridMode) {
  if (mode.kind === 'turma') {
    return e.kind === 'aula' ? ix.assignment.get(e.refId)?.classId === mode.classId : ix.activity.get(e.refId)?.classId === mode.classId;
  }
  return e.kind === 'aula' ? ix.assignment.get(e.refId)?.teacherId === mode.teacherId : ix.activity.get(e.refId)?.teacherId === mode.teacherId;
}

/** Aplica uma alteração somente se não criar conflitos; senão explica e oferece alternativas. */
export function useEditor(data: AppData, schedule: Schedule) {
  const { editEntries, toast } = useStore();
  const [problem, setProblem] = useState<{ title: string; conflicts: Violation[]; alternatives: { label: string; run: () => void }[] } | null>(null);
  const tryApply = (after: Entry[], okMsg: string, alternatives: { label: string; run: () => void }[] = [], dataAfter?: AppData): boolean => {
    const conflicts = newConflicts(dataAfter ?? data, schedule.entries, after);
    if (conflicts.length) {
      setProblem({ title: 'A alteração cria conflitos e não foi aplicada', conflicts, alternatives });
      return false;
    }
    editEntries(schedule.id, () => after);
    toast(okMsg);
    return true;
  };
  const modal = problem && (
    <Modal title={problem.title} onClose={() => setProblem(null)} footer={<button className="btn" onClick={() => setProblem(null)}>Fechar</button>}>
      <ul className="issues">
        {problem.conflicts.map((c, i) => <li key={i} className="issue erro"><Badge kind="erro">Conflito</Badge><div className="issue-body">{c.message}</div></li>)}
      </ul>
      {problem.alternatives.length > 0 ? (
        <>
          <h3 style={{ margin: '12px 0 6px' }}>Alternativas sem conflito</h3>
          <div className="row">{problem.alternatives.slice(0, 24).map((a, i) => <button key={i} className="btn small" onClick={() => { a.run(); setProblem(null); }}>{a.label}</button>)}</div>
        </>
      ) : <p className="muted small" style={{ marginTop: 10 }}>Não há outro horário livre de conflitos para esta aula nesta semana. Considere trocar com outra aula ou revisar as restrições.</p>}
    </Modal>
  );
  const showConflicts = (conflicts: Violation[]) => setProblem({ title: 'A alteração cria conflitos e não foi aplicada', conflicts, alternatives: [] });
  return { tryApply, showConflicts, modal };
}

export function ScheduleGrid({ data, schedule, period, mode, violations }: Props) {
  const ix = useMemo(() => indexData(data), [data]);
  const [drag, setDrag] = useState<{ key: string; targets: Set<string> } | null>(null);
  const [cellOpen, setCellOpen] = useState<{ day: number; slot: number } | null>(null);
  const { tryApply, showConflicts, modal } = useEditor(data, schedule);
  const toast = useStore((s) => s.toast);
  const days = data.school.days;
  const entries = schedule.entries;
  const conflictKeys = useMemo(() => new Set(violations.filter((v) => v.severity === 'conflito').flatMap((v) => v.entries)), [violations]);

  const mine = useMemo(() => entries.filter((e) => e.periodId === period.id && belongs(ix, e, mode)), [entries, period.id, ix, mode]);
  const at = (d: number, s: number) => mine.filter((e) => e.day === d && e.slot === s);
  const span = useMemo(() => {
    if (mode.kind !== 'professor') return null;
    return days.map((_, d) => {
      const sl = mine.filter((e) => e.day === d).map((e) => e.slot);
      return sl.length ? [Math.min(...sl), Math.max(...sl)] : null;
    });
  }, [mine, days, mode.kind]);
  const cls = mode.kind === 'turma' ? ix.cls.get(mode.classId) : undefined;

  const alternativesFor = (key: string) =>
    validTargets(data, entries, key).map((t) => ({
      label: `${days[t.day].slice(0, 3)} ${t.slot + 1}ª`,
      run: () => tryApply(entries.map((e) => (entryKey(e) === key ? { ...e, day: t.day, slot: t.slot } : e)), 'Aula movida.'),
    }));

  const moveTo = (key: string, d: number, s: number) => {
    const src = entries.find((e) => entryKey(e) === key);
    if (!src) return;
    if (src.day === d && src.slot === s) return;
    const occupant = at(d, s)[0];
    const after = occupant
      ? swapEntries(entries, key, entryKey(occupant))
      : entries.map((e) => (entryKey(e) === key ? { ...e, day: d, slot: s } : e));
    if (occupant?.locked) {
      toast('O horário de destino tem uma aula bloqueada. Desbloqueie-a para trocar.', 'aviso');
      return;
    }
    tryApply(after, occupant ? 'Aulas trocadas de horário.' : 'Aula movida.', alternativesFor(key));
  };

  const cellView = (d: number, s: number): ReactNode => {
    const here = at(d, s);
    const e = here[0];
    const key = e ? entryKey(e) : '';
    const target = drag ? (drag.targets.has(`${d}|${s}`) ? ' drop-ok' : ' drop-bad') : '';
    const common = {
      onDragOver: (ev: React.DragEvent) => { if (drag) ev.preventDefault(); },
      onDrop: (ev: React.DragEvent) => { ev.preventDefault(); const k = ev.dataTransfer.getData('text/plain'); setDrag(null); if (k) moveTo(k, d, s); },
      onClick: () => setCellOpen({ day: d, slot: s }),
      role: 'button',
      tabIndex: 0,
      onKeyDown: (ev: React.KeyboardEvent) => { if (ev.key === 'Enter') setCellOpen({ day: d, slot: s }); },
    };
    if (!e) {
      if (mode.kind === 'turma' && cls) {
        const blocked = cls.blocked.some(([a, b]) => a === d && b === s);
        const label = blocked ? 'Bloqueado' : cls.freePolicy === 'reservado' ? 'Reservado' : 'Livre';
        return <div className={'cell ' + (blocked ? 'blocked' : 'free ' + cls.freePolicy) + target} {...common}>{label}</div>;
      }
      const sp = span?.[d];
      if (sp && s > sp[0] && s < sp[1]) return <div className={'cell gap' + target} {...common}>Janela</div>;
      return <div className={'cell free' + target} {...common} />;
    }
    const inf = describeEntry(data, ix, e);
    const conflict = conflictKeys.has(key) || here.length > 1;
    const dragProps = {
      draggable: true,
      onDragStart: (ev: React.DragEvent) => {
        if (e.locked) { ev.preventDefault(); toast('Aula bloqueada: desbloqueie-a para mover.', 'aviso'); return; }
        ev.dataTransfer.setData('text/plain', key);
        ev.dataTransfer.effectAllowed = 'move';
        const t = validTargets(data, entries, key).map((x) => `${x.day}|${x.slot}`);
        // trocas também são permitidas quando não criam conflitos
        for (const o of mine) {
          const ko = entryKey(o);
          if (ko === key || o.locked || (o.kind === e.kind && o.refId === e.refId)) continue; // troca sem efeito
          if (!newConflicts(data, entries, swapEntries(entries, key, ko)).length) t.push(`${o.day}|${o.slot}`);
        }
        setTimeout(() => setDrag({ key, targets: new Set(t) }), 0);
      },
      onDragEnd: () => setDrag(null),
    };
    const lockMark = e.locked ? <span className="lock" title="Bloqueada">🔒</span> : null;
    const extra = here.length > 1 ? <span className="c2"><b>+{here.length - 1} sobreposta(s)</b></span> : null;
    if (e.kind === 'aula') {
      const a = ix.assignment.get(e.refId);
      const sub = a ? ix.subject.get(a.subjectId) : undefined;
      const color = sub?.color ?? '#64748b';
      const t = a?.teacherId ? ix.teacher.get(a.teacherId) : undefined;
      return (
        <div className={'cell' + (conflict ? ' conflict' : '') + (e.locked ? ' locked' : '') + (drag?.key === key ? ' dragging' : '') + target}
          style={{ background: color, color: contrastText(color) }} {...common} {...dragProps} title={inf.label}>
          {lockMark}
          <span className="c1">{sub?.name ?? '?'}</span>
          <span className="c2">{mode.kind === 'turma' ? t?.name ?? 'sem professor' : className(data, ix.cls.get(a?.classId ?? ''))}</span>
          {extra}
        </div>
      );
    }
    const r = ix.activity.get(e.refId);
    return (
      <div className={'cell act ' + (r?.type ?? '') + (conflict ? ' conflict' : '') + (e.locked ? ' locked' : '') + target} {...common} {...dragProps}>
        {lockMark}
        <span className="c1">{r?.label || (r ? ACTIVITY_LABELS[r.type] : '?')}</span>
        <span className="c2">{mode.kind === 'turma' ? ix.teacher.get(r?.teacherId ?? '')?.name : ACTIVITY_LABELS[r?.type ?? 'OUTRA']}</span>
        {extra}
      </div>
    );
  };

  return (
    <>
      <div className="sched-wrap">
        <table className="sched">
          <thead>
            <tr>
              <th className="slot-h">{period.name}</th>
              {days.map((d, i) => <th key={i}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {period.slots.map((_, s) => (
              <Fragment key={s}>
                <tr>
                  <th className="slot-h">{s + 1}ª aula<span className="t">{slotTime(period, s)}</span></th>
                  {days.map((_, d) => <td key={d}>{cellView(d, s)}</td>)}
                </tr>
                {period.breaks.filter((b) => b.afterSlot === s).map((b, i) => (
                  <tr key={`b${i}`} className="break-row"><td colSpan={days.length + 1}>{b.label} {b.start && `· ${b.start}–${b.end}`}</td></tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {cellOpen && <CellEditor data={data} schedule={schedule} period={period} mode={mode} day={cellOpen.day} slot={cellOpen.slot} onClose={() => setCellOpen(null)} tryApply={tryApply} showConflicts={showConflicts} alternativesFor={alternativesFor} />}
      {modal}
    </>
  );
}

function CellEditor(props: {
  data: AppData; schedule: Schedule; period: Period; mode: GridMode; day: number; slot: number; onClose: () => void;
  tryApply: (after: Entry[], msg: string, alts?: { label: string; run: () => void }[], dataAfter?: AppData) => boolean;
  showConflicts: (c: Violation[]) => void;
  alternativesFor: (key: string) => { label: string; run: () => void }[];
}) {
  const { data, schedule, period, mode, day, slot, onClose, tryApply, showConflicts, alternativesFor } = props;
  const ix = indexData(data);
  const { update, toast } = useStore();
  const entries = schedule.entries;
  const here = entries.filter((e) => e.periodId === period.id && e.day === day && e.slot === slot && belongs(ix, e, mode));
  const e = here[0];
  const key = e ? entryKey(e) : '';
  const where = `${data.school.days[day]}, ${slot + 1}ª aula${slotTime(period, slot) ? ` (${slotTime(period, slot)})` : ''}`;
  const [newTeacher, setNewTeacher] = useState('');

  // aulas que podem ocupar este horário
  const options = (() => {
    const placed = new Map<string, number>();
    for (const x of entries) placed.set(x.refId, (placed.get(x.refId) ?? 0) + 1);
    if (mode.kind === 'turma') {
      return data.assignments.filter((a) => a.classId === mode.classId).map((a) => ({
        kind: 'aula' as const, refId: a.id, missing: a.lessons - (placed.get(a.id) ?? 0),
        label: `${ix.subject.get(a.subjectId)?.name} – ${a.teacherId ? ix.teacher.get(a.teacherId)?.name : 'sem professor'}`,
      }));
    }
    const t = mode.teacherId;
    return [
      ...data.assignments.filter((a) => a.teacherId === t && ix.cls.get(a.classId)?.periodId === period.id).map((a) => ({
        kind: 'aula' as const, refId: a.id, missing: a.lessons - (placed.get(a.id) ?? 0),
        label: `${className(data, ix.cls.get(a.classId))} – ${ix.subject.get(a.subjectId)?.name}`,
      })),
      ...data.activities.filter((r) => r.teacherId === t && r.inGrid && r.periodId === period.id).map((r) => ({
        kind: 'atividade' as const, refId: r.id, missing: r.qty - (placed.get(r.id) ?? 0), label: r.label || ACTIVITY_LABELS[r.type],
      })),
    ];
  })().sort((a, b) => b.missing - a.missing);

  const replaceWith = (kind: 'aula' | 'atividade', refId: string) => {
    const after = e
      ? entries.map((x) => (entryKey(x) === key ? { ...x, kind, refId, locked: false } : x))
      : [...entries, { kind, refId, periodId: period.id, day, slot }];
    if (tryApply(after, e ? 'Aula substituída. Verifique as pendências de quantidade.' : 'Aula inserida.')) onClose();
  };
  const removeHere = () => {
    if (tryApply(entries.filter((x) => entryKey(x) !== key), 'Aula retirada deste horário (pendência registrada).')) onClose();
  };
  const toggleLock = () => {
    useStore.getState().editEntries(schedule.id, (list) => list.map((x) => (entryKey(x) === key ? { ...x, locked: !x.locked } : x)));
    onClose();
  };
  const changeTeacher = () => {
    if (!e || e.kind !== 'aula' || !newTeacher) return;
    const a = ix.assignment.get(e.refId)!;
    const t = ix.teacher.get(newTeacher)!;
    const c = ix.cls.get(a.classId);
    if (!t.periodIds.includes(c?.periodId ?? '')) { toast(`${t.name} não trabalha no período desta turma.`, 'erro'); return; }
    const dataAfter: AppData = { ...data, assignments: data.assignments.map((x) => (x.id === a.id ? { ...x, teacherId: newTeacher } : x)) };
    const before = new Set(validateSchedule(data, entries).filter((v) => v.severity === 'conflito').map((v) => v.message));
    const fresh = validateSchedule(dataAfter, entries).filter((v) => v.severity === 'conflito' && !before.has(v.message));
    if (fresh.length) {
      showConflicts(fresh);
      return;
    }
    update((d) => {
      const x = d.assignments.find((y) => y.id === a.id)!;
      x.teacherId = newTeacher;
      const tt = d.teachers.find((y) => y.id === newTeacher)!;
      if (!tt.subjectIds.includes(x.subjectId)) tt.subjectIds.push(x.subjectId);
    });
    toast(`Professor da atribuição alterado para ${t.name} (vale para todas as aulas dessa disciplina na turma).`);
    onClose();
  };

  const alts = e ? alternativesFor(key) : [];
  return (
    <Modal wide title={where} onClose={onClose}>
      {here.length > 1 && <div className="note err">Há {here.length} aulas/atividades sobrepostas neste horário. Mova uma delas.</div>}
      {e ? (
        <>
          <p><b>{describeEntry(data, ix, e).label}</b>{e.kind === 'aula' && <> · Professor: {ix.teacher.get(ix.assignment.get(e.refId)?.teacherId ?? '')?.name ?? 'sem professor'}</>}{e.locked && <> · <Badge kind="info">bloqueada</Badge></>}</p>
          <div className="row" style={{ margin: '8px 0 14px' }}>
            <button className="btn" onClick={toggleLock}>{e.locked ? '🔓 Desbloquear' : '🔒 Bloquear (manter nas próximas otimizações)'}</button>
            <button className="btn danger" disabled={e.locked} onClick={removeHere}>Deixar este horário livre</button>
          </div>
          {!e.locked && (
            <>
              <h3>Mover para (horários sem conflito)</h3>
              {alts.length ? <div className="row" style={{ margin: '6px 0 14px' }}>{alts.map((a, i) => <button key={i} className="btn small" onClick={() => { a.run(); onClose(); }}>{a.label}</button>)}</div> : <p className="muted small">Nenhum horário livre sem conflito. Você pode arrastar sobre outra aula para trocá-las.</p>}
              <h3>{mode.kind === 'turma' ? 'Trocar disciplina/professor neste horário' : 'Trocar turma/atividade neste horário'}</h3>
              <div className="row" style={{ margin: '6px 0 14px' }}>
                {options.filter((o) => o.refId !== e.refId).map((o) => (
                  <button key={o.refId} className="btn small" onClick={() => replaceWith(o.kind, o.refId)}>{o.label}{o.missing > 0 && <Badge kind="aviso">faltam {o.missing}</Badge>}</button>
                ))}
              </div>
              {e.kind === 'aula' && (
                <>
                  <h3>Trocar o professor desta disciplina na turma</h3>
                  <div className="row" style={{ marginTop: 6 }}>
                    <select className="input" style={{ maxWidth: 320 }} value={newTeacher} onChange={(ev) => setNewTeacher(ev.target.value)}>
                      <option value="">Selecione o novo professor…</option>
                      {data.teachers.filter((t) => t.id !== ix.assignment.get(e.refId)?.teacherId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button className="btn primary" disabled={!newTeacher} onClick={changeTeacher}>Trocar professor</button>
                  </div>
                  <p className="muted small">A troca vale para todas as aulas desta disciplina nesta turma (mantém a matriz curricular coerente) e só é aplicada se não gerar conflitos.</p>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <p className="muted">Horário livre.</p>
          <h3>Inserir aula/atividade</h3>
          <div className="row" style={{ marginTop: 6 }}>
            {options.map((o) => <button key={o.refId} className="btn small" onClick={() => replaceWith(o.kind, o.refId)}>{o.label}{o.missing > 0 ? <Badge kind="aviso">faltam {o.missing}</Badge> : <Badge>completa</Badge>}</button>)}
            {!options.length && <span className="muted small">Nada disponível para inserir.</span>}
          </div>
        </>
      )}
    </Modal>
  );
}
