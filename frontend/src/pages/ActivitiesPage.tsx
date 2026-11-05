import { useEffect, useState } from 'react';
import { SlotPicker } from '../components/SlotPicker';
import { Badge, Card, Check, confirmDialog, Empty, Field, Modal, NumInput, PageHeader } from '../components/ui';
import { deleteActivities } from '../logic/mutations';
import { ACTIVITY_LABELS, className, POSITION_LABELS, uid } from '../logic/util';
import { useData, useStore } from '../store';
import type { Activity, ActivityType, Position, Teacher } from '../types';

const DEFAULT_POS: Record<ActivityType, Position> = { HA: 'qualquer', CCH: 'qualquer', HL: 'inicio_ou_fim_periodo', OUTRA: 'qualquer' };

function RuleEditor({ rule, teacher, onClose }: { rule: Activity; teacher: Teacher; onClose: () => void }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const [r, setR] = useState<Activity>(structuredClone(rule));
  const p = data.periods.find((x) => x.id === r.periodId);
  const isNew = !data.activities.some((x) => x.id === rule.id);
  const n = p?.slots.length ?? 0;
  const fixedSet = new Set(r.fixed.map(([d, s]) => `${d}|${s}`));
  const err = !p ? 'Selecione o período.' : !teacher.periodIds.includes(r.periodId) ? 'O professor não trabalha neste período.'
    : r.qty <= 0 ? 'Informe a quantidade semanal.' : r.mode === 'fixo' && r.inGrid && r.fixed.length !== r.qty ? `Marque exatamente ${r.qty} horário(s) fixo(s) (marcados: ${r.fixed.length}).` : null;
  const save = () => {
    if (err) return;
    update((d) => {
      const i = d.activities.findIndex((x) => x.id === r.id);
      const clean = { ...r, label: r.label.trim() || ACTIVITY_LABELS[r.type], slots: r.slots.filter((s) => s < n), fixed: r.fixed.filter(([, s]) => s < n) };
      if (i >= 0) d.activities[i] = clean;
      else d.activities.push(clean);
    });
    onClose();
  };
  const toggleArr = (arr: number[], v: number) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort((a, b) => a - b));
  return (
    <Modal wide title={`${isNew ? 'Nova' : 'Editar'} atividade – ${teacher.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!err} onClick={save}>Salvar</button></>}>
      <div className="grid3">
        <Field label="Tipo">
          <select className="input" value={r.type} onChange={(e) => { const type = e.target.value as ActivityType; setR({ ...r, type, label: r.label === ACTIVITY_LABELS[r.type] || !r.label ? ACTIVITY_LABELS[type] : r.label, position: isNew ? DEFAULT_POS[type] : r.position }); }}>
            {Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Descrição"><input className="input" value={r.label} onChange={(e) => setR({ ...r, label: e.target.value })} /></Field>
        <Field label="Período">
          <select className="input" value={r.periodId} onChange={(e) => setR({ ...r, periodId: e.target.value, slots: [], fixed: [], classId: null })}>
            {data.periods.filter((x) => teacher.periodIds.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Quantidade semanal"><NumInput value={r.qty} min={0} max={60} onChange={(v) => setR({ ...r, qty: v ?? 0 })} /></Field>
        <Field label="Ocupa horário na grade?" hint="Se não ocupar, é apenas contabilizada na jornada.">
          <select className="input" value={r.inGrid ? 's' : 'n'} onChange={(e) => setR({ ...r, inGrid: e.target.value === 's' })}>
            <option value="s">Sim, deve ser alocada na grade</option>
            <option value="n">Não, apenas contabilizar</option>
          </select>
        </Field>
        <Field label="Horário">
          <select className="input" value={r.mode} disabled={!r.inGrid} onChange={(e) => setR({ ...r, mode: e.target.value as Activity['mode'] })}>
            <option value="flexivel">Flexível (o sistema escolhe)</option>
            <option value="fixo">Fixo (horários definidos)</option>
          </select>
        </Field>
      </div>
      {r.inGrid && p && r.mode === 'fixo' && (
        <>
          <h3 style={{ margin: '6px 0' }}>Horários fixos ({r.fixed.length}/{r.qty})</h3>
          <SlotPicker period={p} days={data.school.days} disabledDays={data.school.days.map((_, i) => i).filter((d) => !teacher.availability.workDays.includes(d))}
            look={(d, s) => (fixedSet.has(`${d}|${s}`) ? { cls: 'sel', text: r.type } : { cls: 'on' })}
            onCell={(d, s) => setR({ ...r, fixed: fixedSet.has(`${d}|${s}`) ? r.fixed.filter(([a, b]) => !(a === d && b === s)) : [...r.fixed, [d, s]] })} />
        </>
      )}
      {r.inGrid && p && r.mode === 'flexivel' && (
        <>
          <Field label="Posição no período">
            <select className="input" value={r.position} onChange={(e) => setR({ ...r, position: e.target.value as Position })}>
              {Object.entries(POSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {r.position !== 'qualquer' && r.position !== 'meio' && <p className="muted small">Com esta regra, a atividade nunca é colocada no meio da jornada. Ex.: "início do período" ⇒ as unidades do dia formam um bloco que começa na 1ª aula.</p>}
          <div className="grid2">
            <Field label="Dias possíveis" hint="Nenhum marcado = qualquer dia de trabalho do professor.">
              <div className="row">{data.school.days.map((dn, d) => <Check key={d} label={dn.slice(0, 3)} checked={r.days.includes(d)} onChange={() => setR({ ...r, days: toggleArr(r.days, d) })} />)}</div>
            </Field>
            <Field label="Aulas (horários) possíveis" hint="Nenhuma marcada = qualquer aula do período.">
              <div className="row">{p.slots.map((_, s) => <Check key={s} label={`${s + 1}ª`} checked={r.slots.includes(s)} onChange={() => setR({ ...r, slots: toggleArr(r.slots, s) })} />)}</div>
            </Field>
            <Field label="Máximo por dia" hint="Vazio = sem limite."><NumInput value={r.maxPerDay} min={1} max={n} allowEmpty placeholder="—" onChange={(v) => setR({ ...r, maxPerDay: v })} /></Field>
          </div>
        </>
      )}
      {r.inGrid && p && (
        <Field label="Turma relacionada (opcional)" hint='A atividade ocupará um horário livre desta turma (a turma precisa estar configurada para receber atividades complementares nos horários livres).'>
          <select className="input" value={r.classId ?? ''} onChange={(e) => setR({ ...r, classId: e.target.value || null })}>
            <option value="">Nenhuma</option>
            {data.classes.filter((c) => c.periodId === r.periodId).map((c) => <option key={c.id} value={c.id}>{className(data, c)}</option>)}
          </select>
        </Field>
      )}
      <Field label="Observações / outras restrições / atividades relacionadas">
        <textarea className="input" value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })} />
      </Field>
      {err && <p className="field-error">{err}</p>}
    </Modal>
  );
}

function describe(r: Activity, days: string[]) {
  if (!r.inGrid) return 'Somente contabilizada (não ocupa horário na grade)';
  if (r.mode === 'fixo') return `Fixa: ${r.fixed.map(([d, s]) => `${days[d]?.slice(0, 3)} ${s + 1}ª`).join(', ')}`;
  const parts = [POSITION_LABELS[r.position]];
  if (r.days.length) parts.push(`dias: ${r.days.map((d) => days[d]?.slice(0, 3)).join(', ')}`);
  if (r.slots.length) parts.push(`aulas: ${r.slots.map((s) => s + 1 + 'ª').join(', ')}`);
  if (r.maxPerDay != null) parts.push(`máx. ${r.maxPerDay}/dia`);
  return parts.join(' · ');
}

export default function ActivitiesPage() {
  const data = useData();
  const { update, pageParam, toast } = useStore();
  const teachers = [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const [sel, setSel] = useState<string | null>(pageParam ?? teachers[0]?.id ?? null);
  useEffect(() => { if (pageParam && data.teachers.some((t) => t.id === pageParam)) setSel(pageParam); }, [pageParam, data.teachers]);
  const [editing, setEditing] = useState<Activity | null>(null);
  const t = data.teachers.find((x) => x.id === sel);
  const rules = data.activities.filter((r) => r.teacherId === sel);

  const newRule = (type: ActivityType) => t && setEditing({
    id: uid('ativ'), teacherId: t.id, type, label: ACTIVITY_LABELS[type], periodId: t.periodIds[0] ?? '', qty: 1, inGrid: true,
    days: [], slots: [], position: DEFAULT_POS[type], mode: 'flexivel', fixed: [], maxPerDay: null, classId: null, notes: '',
  });
  const fromDeclared = () => {
    let n = 0;
    update((d) => {
      for (const tt of d.teachers) {
        if (!tt.periodIds.length) continue;
        for (const [type, field] of [['HA', 'ha'], ['CCH', 'cch'], ['HL', 'hl']] as const) {
          const qty = tt.workload[field];
          if (!qty || !Number.isInteger(qty) || d.activities.some((r) => r.teacherId === tt.id && r.type === type)) continue;
          d.activities.push({ id: uid('ativ'), teacherId: tt.id, type, label: ACTIVITY_LABELS[type], periodId: tt.periodIds[0], qty, inGrid: true, days: [], slots: [], position: DEFAULT_POS[type], mode: 'flexivel', fixed: [], maxPerDay: null, classId: null, notes: '' });
          n++;
        }
      }
    });
    toast(n ? `${n} regra(s) criada(s) a partir das quantidades declaradas. Revise as regras de cada uma.` : 'Nenhuma regra nova: não há quantidades declaradas sem regra correspondente.', n ? 'ok' : 'aviso');
  };

  return (
    <>
      <PageHeader title="H.A., CCH e HL" subtitle="Cadastre as atividades que compõem a jornada e como devem ser posicionadas. Nenhuma regra legal ou administrativa é presumida: todas são configuráveis."
        actions={<button className="btn" onClick={fromDeclared} title="Para cada professor com H.A./CCH/HL declarada em Cargas horárias e sem regra cadastrada">Criar regras a partir da carga declarada</button>} />
      {!teachers.length ? <Empty>Nenhum professor cadastrado.</Empty> : (
        <div className="split">
          <Card title="Professores">
            <div className="list-sel">
              {teachers.map((x) => {
                const rs = data.activities.filter((r) => r.teacherId === x.id);
                return (
                  <button key={x.id} className={x.id === sel ? 'active' : ''} onClick={() => setSel(x.id)}>
                    <span>{x.name}</span><span className="muted small">{rs.length ? rs.map((r) => `${r.qty} ${ACTIVITY_LABELS[r.type]}`).join(', ') : '—'}</span>
                  </button>
                );
              })}
            </div>
          </Card>
          {t && (
            <Card title={`Atividades de ${t.name}`} actions={<>
              {(['HA', 'CCH', 'HL', 'OUTRA'] as ActivityType[]).map((ty) => <button key={ty} className="btn small" disabled={!t.periodIds.length} onClick={() => newRule(ty)}>+ {ACTIVITY_LABELS[ty]}</button>)}
            </>}>
              {!t.periodIds.length && <div className="note warn">Informe o período de trabalho do professor no cadastro antes de criar atividades.</div>}
              <p className="muted small">Declarado em Cargas horárias: H.A. {t.workload.ha ?? '—'} · CCH {t.workload.cch ?? '—'} · HL {t.workload.hl ?? '—'}</p>
              {!rules.length ? <Empty>Nenhuma atividade cadastrada para este professor.</Empty> : (
                <table className="tbl">
                  <thead><tr><th>Tipo</th><th>Descrição</th><th>Período</th><th className="num">Qtd.</th><th>Regras</th><th></th></tr></thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id}>
                        <td><Badge kind="info">{ACTIVITY_LABELS[r.type]}</Badge></td>
                        <td>{r.label}{r.classId && <div className="muted small">Turma: {className(data, data.classes.find((c) => c.id === r.classId))}</div>}{r.notes && <div className="muted small">{r.notes}</div>}</td>
                        <td>{data.periods.find((p) => p.id === r.periodId)?.name ?? '?'}</td>
                        <td className="num">{r.qty}</td>
                        <td className="small">{describe(r, data.school.days)}</td>
                        <td className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn small" onClick={() => setEditing(r)}>Editar</button>
                          <button className="btn small danger" onClick={async () => { if (await confirmDialog('Excluir atividade', `Excluir ${r.label}?`, { danger: true, okLabel: 'Excluir' })) update((d) => deleteActivities(d, new Set([r.id]))); }}>Excluir</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>
      )}
      {editing && t && <RuleEditor rule={editing} teacher={t} onClose={() => setEditing(null)} />}
    </>
  );
}
