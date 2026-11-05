import { useEffect, useState } from 'react';
import { SlotPicker } from '../components/SlotPicker';
import { Card, Check, Empty, Field, NumInput, PageHeader } from '../components/ui';
import { useData, useStore } from '../store';
import type { Availability, Limit } from '../types';

function LimitEditor(props: { label: string; value: Limit | null; max: number; onChange: (l: Limit | null) => void }) {
  const v = props.value;
  return (
    <Field label={props.label}>
      <div className="row">
        <select className="input" style={{ width: 120 }} value={v ? 'sim' : 'nao'} onChange={(e) => props.onChange(e.target.value === 'sim' ? { value: Math.min(props.max, 5), hard: true } : null)}>
          <option value="nao">Não há</option>
          <option value="sim">Sim</option>
        </select>
        {v && (
          <>
            <span className="small">até</span>
            <NumInput value={v.value} min={1} max={props.max} onChange={(n) => props.onChange({ ...v, value: n ?? 1 })} ariaLabel={props.label} />
            <select className="input" style={{ width: 170 }} value={v.hard ? 'h' : 's'} onChange={(e) => props.onChange({ ...v, hard: e.target.value === 'h' })}>
              <option value="h">Restrição obrigatória</option>
              <option value="s">Apenas preferência</option>
            </select>
          </>
        )}
      </div>
    </Field>
  );
}

export default function AvailabilityPage() {
  const data = useData();
  const { update, pageParam, go } = useStore();
  const teachers = [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const [sel, setSel] = useState<string | null>(pageParam ?? teachers[0]?.id ?? null);
  useEffect(() => { if (pageParam && data.teachers.some((t) => t.id === pageParam)) setSel(pageParam); }, [pageParam, data.teachers]);
  const t = data.teachers.find((x) => x.id === sel);
  if (!teachers.length) return <><PageHeader title="Disponibilidade dos professores" /><Empty>Nenhum professor cadastrado.</Empty></>;
  const av = t?.availability;
  const set = (fn: (a: Availability) => void) => t && update((d) => fn(d.teachers.find((x) => x.id === t.id)!.availability));
  const days = data.school.days;
  const maxSlots = t ? t.periodIds.reduce((s, pid) => s + (data.periods.find((p) => p.id === pid)?.slots.length ?? 0), 0) : 0;

  return (
    <>
      <PageHeader title="Disponibilidade dos professores" subtitle="Restrições obrigatórias nunca são violadas. Preferências são atendidas sempre que possível, mas podem ser flexibilizadas para encontrar uma solução." />
      <div className="split">
        <Card title="Professores">
          <div className="list-sel">
            {teachers.map((x) => (
              <button key={x.id} className={x.id === sel ? 'active' : ''} onClick={() => setSel(x.id)}>
                <span>{x.name}</span>
                <span className="muted small">{x.availability.unavailable.length ? `${x.availability.unavailable.length} indisp.` : ''}</span>
              </button>
            ))}
          </div>
        </Card>
        {t && av && (
          <div>
            <Card title={<>Restrições obrigatórias <span className="badge erro">não podem ser violadas</span></>}>
              <Field label="Quais dias da semana trabalha? (dias desmarcados = não pode comparecer)">
                <div className="row">
                  {days.map((dn, d) => (
                    <Check key={d} label={dn} checked={av.workDays.includes(d)}
                      onChange={(v) => set((a) => { a.workDays = v ? [...a.workDays, d].sort() : a.workDays.filter((x) => x !== d); })} />
                  ))}
                </div>
              </Field>
              <Field label="Em quais períodos está disponível?">
                <div>{t.periodIds.map((pid) => data.periods.find((p) => p.id === pid)?.name).join(', ') || <span className="err-text">nenhum</span>} <button className="btn link" onClick={() => go('professores', t.id)}>alterar no cadastro</button></div>
              </Field>
              {t.periodIds.map((pid) => {
                const p = data.periods.find((x) => x.id === pid);
                if (!p) return null;
                const lo = av.entry[pid] ?? null, hi = av.exit[pid] ?? null;
                const cycle = (d: number, s: number) => set((a) => {
                  const k = `${pid}|${d}|${s}`;
                  if (a.unavailable.includes(k)) { a.unavailable = a.unavailable.filter((x) => x !== k); a.avoid.push(k); }
                  else if (a.avoid.includes(k)) a.avoid = a.avoid.filter((x) => x !== k);
                  else a.unavailable.push(k);
                });
                const toggleMany = (keys: string[]) => set((a) => {
                  const allUn = keys.every((k) => a.unavailable.includes(k));
                  a.avoid = a.avoid.filter((k) => !keys.includes(k));
                  a.unavailable = allUn ? a.unavailable.filter((k) => !keys.includes(k)) : [...new Set([...a.unavailable, ...keys])];
                });
                return (
                  <div key={pid} style={{ marginBottom: 14 }}>
                    <h3 style={{ margin: '8px 0 4px' }}>{p.name} — horários que não pode ocupar</h3>
                    <p className="muted small">Clique em um horário para alternar: disponível → <b>indisponível (obrigatório)</b> → <b>prefere evitar (preferência)</b> → disponível. Clique no dia ou na aula para marcar/desmarcar a linha ou coluna inteira.</p>
                    <SlotPicker period={p} days={days} disabledDays={days.map((_, i) => i).filter((d) => !av.workDays.includes(d))}
                      onCell={cycle}
                      onDay={(d) => toggleMany(p.slots.map((_, s) => `${pid}|${d}|${s}`))}
                      onSlot={(s) => toggleMany(days.map((_, d) => `${pid}|${d}|${s}`))}
                      look={(d, s) => {
                        const k = `${pid}|${d}|${s}`;
                        if ((lo != null && s < lo) || (hi != null && s > hi)) return { cls: 'off', text: '—', title: 'Fora do horário de entrada/saída' };
                        if (av.unavailable.includes(k)) return { cls: 'bad', text: 'Indisp.' };
                        if (av.avoid.includes(k)) return { cls: 'pref', text: 'Evitar' };
                        return { cls: 'on' };
                      }} />
                    <div className="legend"><span className="l-on">Disponível</span><span className="l-bad">Indisponível (obrigatório)</span><span className="l-pref">Prefere evitar (preferência)</span><span className="l-off">Fora da entrada/saída</span></div>
                    <div className="row">
                      <Field label="Horário de entrada obrigatório (não pode ter aulas antes da…)">
                        <select className="input" value={lo ?? ''} onChange={(e) => set((a) => { a.entry[pid] = e.target.value === '' ? null : Number(e.target.value); })}>
                          <option value="">Sem restrição</option>
                          {p.slots.map((sl, s) => <option key={s} value={s}>{s + 1}ª aula {sl.start && `(${sl.start})`}</option>)}
                        </select>
                      </Field>
                      <Field label="Horário de saída obrigatório (não pode ter aulas depois da…)">
                        <select className="input" value={hi ?? ''} onChange={(e) => set((a) => { a.exit[pid] = e.target.value === '' ? null : Number(e.target.value); })}>
                          <option value="">Sem restrição</option>
                          {p.slots.map((sl, s) => <option key={s} value={s}>{s + 1}ª aula {sl.end && `(até ${sl.end})`}</option>)}
                        </select>
                      </Field>
                    </div>
                    {lo != null && hi != null && hi < lo && <p className="field-error">A saída não pode ser antes da entrada.</p>}
                  </div>
                );
              })}
              <div className="grid2">
                <LimitEditor label="Existe limite de aulas diárias?" value={av.maxDaily} max={maxSlots || 16} onChange={(l) => set((a) => { a.maxDaily = l; })} />
                <LimitEditor label="Existe limite de aulas consecutivas?" value={av.maxConsecutive} max={16} onChange={(l) => set((a) => { a.maxConsecutive = l; })} />
              </div>
            </Card>
            <Card title={<>Preferências <span className="badge aviso">atendidas sempre que possível</span></>}>
              <Field label="Há necessidade de concentrar as aulas em determinados dias? (marque os dias preferidos)">
                <div className="row">
                  {days.map((dn, d) => (
                    <Check key={d} label={dn} disabled={!av.workDays.includes(d)} checked={av.preferredDays.includes(d)}
                      onChange={(v) => set((a) => { a.preferredDays = v ? [...a.preferredDays, d].sort() : a.preferredDays.filter((x) => x !== d); })} />
                  ))}
                </div>
              </Field>
              <Field label="Preferência por trabalhar no máximo quantos dias?" hint="Vazio = sem preferência.">
                <NumInput value={av.maxDays} min={1} max={days.length} allowEmpty placeholder="—" onChange={(v) => set((a) => { a.maxDays = v; })} />
              </Field>
              <Check label="Prefere aulas consecutivas (evitar aulas isoladas)" checked={av.preferConsecutive} onChange={(v) => set((a) => { a.preferConsecutive = v; })} />
              <Check label="Prefere evitar janelas (horários vagos entre aulas)" checked={av.avoidGaps} onChange={(v) => set((a) => { a.avoidGaps = v; })} />
              <Field label="Observações individuais" className="mt">
                <textarea className="input" key={t.id} defaultValue={t.notes} onBlur={(e) => update((d) => { d.teachers.find((x) => x.id === t.id)!.notes = e.target.value; })} />
              </Field>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
