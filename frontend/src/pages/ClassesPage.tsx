import { useState } from 'react';
import { SlotPicker } from '../components/SlotPicker';
import { Badge, Card, confirmDialog, Empty, Field, Modal, NumInput, PageHeader, Tabs, TextInput } from '../components/ui';
import { makeClass } from '../logic/defaults';
import { deleteClasses, deleteCycle, deleteGrade } from '../logic/mutations';
import { className, sortedClasses, uid } from '../logic/util';
import { useData, useStore } from '../store';
import type { FreePolicy, FreePosition, PendingGroup, SchoolClass } from '../types';

const POLICY: Record<FreePolicy, string> = {
  livre: 'Permanecem livres',
  reservado: 'Reservados p/ atividades específicas',
  complementar: 'Podem receber atividades complementares',
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function AddClasses({ initial, onClose }: { initial?: PendingGroup; onClose: () => void }) {
  const data = useData();
  const { update, toast } = useStore();
  const [periodId, setPeriod] = useState(initial?.periodId ?? data.periods[0]?.id ?? '');
  const [gradeId, setGrade] = useState(initial?.gradeId ?? data.grades[0]?.id ?? '');
  const [qty, setQty] = useState<number | null>(1);
  const [weekly, setWeekly] = useState<number | null>(initial?.weeklyLessons ?? null);
  const [startLetter, setStart] = useState('A');
  const p = data.periods.find((x) => x.id === periodId);
  const g = data.grades.find((x) => x.id === gradeId);
  const max = p ? p.slots.length * data.school.days.length : 0;
  const start = Math.max(0, LETTERS.indexOf(startLetter.toUpperCase()));
  const names = g && qty ? Array.from({ length: qty }, (_, i) => `${g.short} ${LETTERS[start + i] ?? start + i + 1}`) : [];
  const dups = names.filter((n) => data.classes.some((c) => c.periodId === periodId && c.name === n));
  const err = !p ? 'Selecione o período.' : !g ? 'Selecione o ano/série.' : !qty ? 'Informe a quantidade.' : weekly == null ? 'Informe as aulas semanais.' : weekly > max ? `O período tem no máximo ${max} horários semanais.` : dups.length ? `Já existem: ${dups.join(', ')}. Escolha outra letra inicial.` : null;
  const save = () => {
    if (err || !g || !p || !qty || weekly == null) return;
    update((d) => {
      for (let i = 0; i < qty; i++) d.classes.push(makeClass(periodId, g, LETTERS[start + i] ?? String(start + i + 1), weekly, d.school.defaultFreePolicy));
      if (initial) d.pending = d.pending.filter((x) => x.id !== initial.id);
    });
    toast(`${qty} turma(s) criada(s).`);
    onClose();
  };
  return (
    <Modal title={initial ? 'Informar turmas pendentes' : 'Adicionar turmas'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!err} onClick={save}>Criar turmas</button></>}>
      <div className="grid2">
        <Field label="Período">
          <select className="input" value={periodId} onChange={(e) => setPeriod(e.target.value)} disabled={!!initial}>
            {data.periods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Ano/série">
          <select className="input" value={gradeId} onChange={(e) => setGrade(e.target.value)} disabled={!!initial}>
            {data.grades.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Quantidade de turmas"><NumInput value={qty} min={1} max={26} onChange={setQty} /></Field>
        <Field label="Aulas semanais por turma" hint={p ? `Máximo: ${max}` : undefined}><NumInput value={weekly} min={0} max={max || 999} allowEmpty onChange={setWeekly} /></Field>
        <Field label="Letra inicial"><input className="input" style={{ width: 70 }} maxLength={1} value={startLetter} onChange={(e) => setStart(e.target.value.toUpperCase())} /></Field>
      </div>
      {names.length > 0 && <p className="small">Serão criadas: <b>{names.join(', ')}</b></p>}
      {err && <p className="field-error">{err}</p>}
    </Modal>
  );
}

function EditClass({ cls, onClose }: { cls: SchoolClass; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [c, setC] = useState<SchoolClass>(structuredClone(cls));
  const p = data.periods.find((x) => x.id === c.periodId);
  const max = p ? p.slots.length * data.school.days.length : 0;
  const dup = data.classes.some((o) => o.id !== c.id && o.periodId === c.periodId && o.name.trim() === c.name.trim());
  const err = !c.name.trim() ? 'Informe o nome.' : dup ? 'Já existe uma turma com esse nome neste período.' : c.weeklyLessons > max ? `O período tem ${max} horários semanais.` : null;
  const blocked = new Set(c.blocked.map(([d, s]) => `${d}|${s}`));
  const toggle = (d: number, s: number) => {
    const k = `${d}|${s}`;
    setC({ ...c, blocked: blocked.has(k) ? c.blocked.filter(([a, b]) => `${a}|${b}` !== k) : [...c.blocked, [d, s]] });
  };
  const save = () => {
    if (err) return;
    update((d) => {
      const i = d.classes.findIndex((x) => x.id === c.id);
      if (d.classes[i].periodId !== c.periodId) c.blocked = [];
      d.classes[i] = { ...c, name: c.name.trim() };
    });
    onClose();
  };
  return (
    <Modal wide title={`Editar turma ${cls.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!err} onClick={save}>Salvar</button></>}>
      <div className="grid3">
        <Field label="Nome da turma"><input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
        <Field label="Identificação (letra)">
          <div className="row">
            <input className="input" style={{ width: 70 }} value={c.letter} onChange={(e) => setC({ ...c, letter: e.target.value })} />
            <button className="btn small" onClick={() => { const g = data.grades.find((x) => x.id === c.gradeId); if (g) setC({ ...c, name: `${g.short} ${c.letter}` }); }}>Gerar nome</button>
          </div>
        </Field>
        <Field label="Período">
          <select className="input" value={c.periodId} onChange={(e) => setC({ ...c, periodId: e.target.value })}>
            {data.periods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Ano/série">
          <select className="input" value={c.gradeId} onChange={(e) => setC({ ...c, gradeId: e.target.value })}>
            {data.grades.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Aulas semanais" hint={`O período tem ${max} horários semanais.`}><NumInput value={c.weeklyLessons} min={0} max={max} onChange={(v) => setC({ ...c, weeklyLessons: v ?? 0 })} /></Field>
        <Field label="Aulas diárias disponíveis" hint="Vazio = todas as aulas do período."><NumInput value={c.dailyMax} min={1} max={p?.slots.length} allowEmpty onChange={(v) => setC({ ...c, dailyMax: v })} placeholder={String(p?.slots.length ?? '')} /></Field>
        <Field label="Horários sem aula">
          <select className="input" value={c.freePolicy} onChange={(e) => setC({ ...c, freePolicy: e.target.value as FreePolicy })}>
            {Object.entries(POLICY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Posição preferida dos horários livres" hint="Preferência (pode ser flexibilizada).">
          <select className="input" value={c.freePosition} onChange={(e) => setC({ ...c, freePosition: e.target.value as FreePosition })}>
            <option value="qualquer">Qualquer posição</option>
            <option value="fim">No final do dia</option>
            <option value="inicio">No início do dia</option>
          </select>
        </Field>
        <Field label="Observações"><input className="input" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
      </div>
      {p && (
        <>
          <h3 style={{ margin: '10px 0 4px' }}>Horários bloqueados para aulas regulares (obrigatório)</h3>
          <p className="muted small">Clique para bloquear/desbloquear. Horários bloqueados nunca recebem aulas regulares.</p>
          <SlotPicker period={p} days={data.school.days} onCell={toggle}
            look={(d, s) => (blocked.has(`${d}|${s}`) ? { cls: 'bad', text: 'Bloq.' } : { cls: 'on' })} />
        </>
      )}
      {err && <p className="field-error">{err}</p>}
    </Modal>
  );
}

function GradesTab() {
  const data = useData();
  const update = useStore((s) => s.update);
  const removeGrade = async (id: string, name: string) => {
    const n = data.classes.filter((c) => c.gradeId === id).length;
    if (await confirmDialog('Excluir ano/série', <>Excluir <b>{name}</b>?{n > 0 && <> As <b>{n} turma(s)</b> vinculadas também serão excluídas.</>}</>, { danger: true, okLabel: 'Excluir' }))
      update((d) => deleteGrade(d, id));
  };
  return (
    <div className="grid2">
      <Card title="Anos / séries" actions={<button className="btn small" onClick={() => update((d) => { const n = d.grades.length + 1; d.grades.push({ id: uid('serie'), name: `Nova série ${n}`, short: `S${n}`, cycleId: null, order: n }); })}>+ Adicionar</button>}>
        <table className="tbl">
          <thead><tr><th>Nome</th><th>Abreviação</th><th>Ciclo</th><th>Ordem</th><th></th></tr></thead>
          <tbody>
            {[...data.grades].sort((a, b) => a.order - b.order).map((g) => (
              <tr key={g.id}>
                <td><TextInput value={g.name} required onChange={(v) => update((d) => { d.grades.find((x) => x.id === g.id)!.name = v; })} /></td>
                <td><TextInput value={g.short} required className="num" onChange={(v) => update((d) => { d.grades.find((x) => x.id === g.id)!.short = v; })} /></td>
                <td>
                  <select className="input" value={g.cycleId ?? ''} onChange={(e) => update((d) => { d.grades.find((x) => x.id === g.id)!.cycleId = e.target.value || null; })}>
                    <option value="">—</option>
                    {data.cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td><NumInput value={g.order} min={0} onChange={(v) => update((d) => { d.grades.find((x) => x.id === g.id)!.order = v ?? 0; })} /></td>
                <td><button className="btn small danger" onClick={() => removeGrade(g.id, g.name)}>Excluir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">A abreviação é usada para gerar os nomes das turmas (ex.: "1º" → 1º A, 1º B).</p>
      </Card>
      <Card title="Ciclos" actions={<button className="btn small" onClick={() => update((d) => { d.cycles.push({ id: uid('ciclo'), name: `Ciclo ${d.cycles.length + 1}` }); })}>+ Adicionar</button>}>
        {data.cycles.length === 0 && <p className="muted small">Nenhum ciclo cadastrado. Cadastre os ciclos e vincule-os aos anos/séries.</p>}
        {data.cycles.map((c) => (
          <div className="row" key={c.id} style={{ marginBottom: 6 }}>
            <TextInput value={c.name} required onChange={(v) => update((d) => { d.cycles.find((x) => x.id === c.id)!.name = v; })} />
            <button className="btn small danger" onClick={() => update((d) => deleteCycle(d, c.id))}>Excluir</button>
          </div>
        ))}
      </Card>
    </div>
  );
}

export default function ClassesPage() {
  const data = useData();
  const { update, toast } = useStore();
  const [tab, setTab] = useState<'turmas' | 'series'>('turmas');
  const [adding, setAdding] = useState<PendingGroup | true | null>(null);
  const [editing, setEditing] = useState<SchoolClass | null>(null);
  const classes = sortedClasses(data);

  const duplicate = (c: SchoolClass) => {
    const used = new Set(data.classes.filter((x) => x.periodId === c.periodId && x.gradeId === c.gradeId).map((x) => x.letter));
    const letter = [...LETTERS].find((l) => !used.has(l)) ?? 'X';
    const g = data.grades.find((x) => x.id === c.gradeId);
    update((d) => {
      const nc = { ...structuredClone(c), id: uid('tur'), letter, name: `${g?.short ?? ''} ${letter}`.trim() };
      d.classes.push(nc);
      for (const a of d.assignments.filter((x) => x.classId === c.id)) d.assignments.push({ ...a, id: uid('atr'), classId: nc.id });
    });
    toast(`Turma duplicada como ${g?.short} ${letter} (com a mesma matriz curricular).`);
  };
  const remove = async (c: SchoolClass) => {
    const n = data.assignments.filter((a) => a.classId === c.id).length;
    if (await confirmDialog('Excluir turma', <>Excluir a turma <b>{className(data, c)}</b>?{n > 0 && <> As {n} linha(s) da matriz curricular dessa turma também serão excluídas.</>}</>, { danger: true, okLabel: 'Excluir' }))
      update((d) => deleteClasses(d, new Set([c.id])));
  };

  return (
    <>
      <PageHeader title="Cadastro de turmas" subtitle="Adicione, edite, duplique e exclua turmas, anos/séries e ciclos. Os nomes (1º A, 1º B…) são gerados automaticamente."
        actions={<button className="btn primary" onClick={() => setAdding(true)}>+ Adicionar turmas</button>} />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'turmas', label: 'Turmas' }, { id: 'series', label: 'Anos/séries e ciclos' }]} />
      {tab === 'series' ? <GradesTab /> : data.periods.map((p) => {
        const list = classes.filter((c) => c.periodId === p.id);
        const pend = data.pending.filter((x) => x.periodId === p.id);
        return (
          <Card key={p.id} title={`${p.name} — ${list.length} turma(s)`}>
            {pend.map((pg) => (
              <div key={pg.id} className="note warn row between">
                <span><b>{data.grades.find((g) => g.id === pg.gradeId)?.name}</b>: quantidade de turmas pendente de informação ({pg.weeklyLessons} aulas semanais por turma).</span>
                <span className="row">
                  <button className="btn small primary" onClick={() => setAdding(pg)}>Informar quantidade</button>
                  <button className="btn small" onClick={async () => { if (await confirmDialog('Remover pendência', 'Remover este aviso de pendência sem criar turmas?')) update((d) => { d.pending = d.pending.filter((x) => x.id !== pg.id); }); }}>Remover pendência</button>
                </span>
              </div>
            ))}
            {list.length === 0 ? <Empty>Nenhuma turma neste período.</Empty> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Turma</th><th>Ano/série</th><th>Ciclo</th><th className="num">Aulas semanais</th><th className="num">Aulas/dia</th><th>Horários sem aula</th><th>Matriz</th><th></th></tr></thead>
                  <tbody>
                    {list.map((c) => {
                      const g = data.grades.find((x) => x.id === c.gradeId);
                      const cyc = data.cycles.find((x) => x.id === g?.cycleId);
                      const sum = data.assignments.filter((a) => a.classId === c.id).reduce((s, a) => s + a.lessons, 0);
                      return (
                        <tr key={c.id}>
                          <td><b>{c.name}</b>{c.notes && <div className="muted small">{c.notes}</div>}</td>
                          <td>{g?.name ?? <span className="err-text">?</span>}</td>
                          <td>{cyc?.name ?? '—'}</td>
                          <td className="num">
                            <NumInput value={c.weeklyLessons} min={0} max={p.slots.length * data.school.days.length} onChange={(v) => update((d) => { d.classes.find((x) => x.id === c.id)!.weeklyLessons = v ?? 0; })} ariaLabel={`Aulas semanais de ${c.name}`} />
                          </td>
                          <td className="num">{c.dailyMax ?? p.slots.length}</td>
                          <td className="small">{POLICY[c.freePolicy]}{c.blocked.length > 0 && <div className="muted">{c.blocked.length} bloqueado(s)</div>}</td>
                          <td>
                            <Badge kind={sum === c.weeklyLessons ? 'ok' : sum > c.weeklyLessons ? 'erro' : 'aviso'}>{sum}/{c.weeklyLessons}</Badge>
                          </td>
                          <td className="row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn small" onClick={() => setEditing(c)}>Editar</button>
                            <button className="btn small" onClick={() => useStore.getState().go('matriz', c.id)}>Matriz</button>
                            <button className="btn small" onClick={() => duplicate(c)}>Duplicar</button>
                            <button className="btn small danger" onClick={() => remove(c)}>Excluir</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
      {adding && <AddClasses initial={adding === true ? undefined : adding} onClose={() => setAdding(null)} />}
      {editing && <EditClass cls={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
