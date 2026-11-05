import { Fragment, useState } from 'react';
import { Card, confirmDialog, Field, Modal, NumInput, PageHeader, TextInput, TimeInput } from '../components/ui';
import { emptySlots } from '../logic/defaults';
import { deletePeriod, trimPeriodSlots } from '../logic/mutations';
import { fromMinutes, toMinutes, uid } from '../logic/util';
import { useData, useStore } from '../store';
import type { Period } from '../types';

function periodProblems(p: Period): string[] {
  const out: string[] = [];
  let last: number | null = null;
  p.slots.forEach((s, i) => {
    const a = toMinutes(s.start), b = toMinutes(s.end);
    if ((s.start && a == null) || (s.end && b == null)) out.push(`${i + 1}ª aula: horário inválido.`);
    if (a != null && b != null && b <= a) out.push(`${i + 1}ª aula: o término deve ser depois do início.`);
    if (a != null && last != null && a < last) out.push(`${i + 1}ª aula começa antes do fim da aula anterior.`);
    if (b != null) last = b;
  });
  for (const br of p.breaks) {
    if (br.afterSlot < 0 || br.afterSlot >= p.slots.length - 1) out.push(`Intervalo "${br.label}": posição inválida.`);
    const a = toMinutes(br.start), b = toMinutes(br.end);
    if (a != null && b != null && b <= a) out.push(`Intervalo "${br.label}": término antes do início.`);
  }
  return out;
}

function AutoTimes({ period, minutes, onClose }: { period: Period; minutes: number; onClose: () => void }) {
  const update = useStore((s) => s.update);
  const [start, setStart] = useState(period.slots[0]?.start || '');
  const [dur, setDur] = useState<number | null>(minutes);
  const [breaks, setBreaks] = useState(period.breaks.map((b) => ({ after: b.afterSlot + 1, len: Math.max(0, (toMinutes(b.end) ?? 0) - (toMinutes(b.start) ?? 0)), label: b.label })));
  const st = toMinutes(start);
  const apply = () => {
    if (st == null || !dur) return;
    update((d) => {
      const p = d.periods.find((x) => x.id === period.id)!;
      let t = st;
      const newBreaks: Period['breaks'] = [];
      p.slots = p.slots.map((_, i) => {
        const s = { start: fromMinutes(t), end: fromMinutes(t + dur) };
        t += dur;
        const br = breaks.find((b) => b.after === i + 1 && b.len > 0);
        if (br && i < p.slots.length - 1) {
          newBreaks.push({ afterSlot: i, start: fromMinutes(t), end: fromMinutes(t + br.len), label: br.label || 'Intervalo' });
          t += br.len;
        }
        return s;
      });
      p.breaks = newBreaks;
    });
    onClose();
  };
  return (
    <Modal title={`Calcular horários – ${period.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={st == null || !dur} onClick={apply}>Aplicar horários</button></>}>
      <p className="muted small">Informe o horário da 1ª aula, a duração e os intervalos. Os horários de todas as aulas serão recalculados (você pode ajustá-los depois, um a um).</p>
      <div className="grid2">
        <Field label="Início da 1ª aula"><TimeInput value={start} onChange={setStart} /></Field>
        <Field label="Duração de cada aula (min)"><NumInput value={dur} min={1} max={240} onChange={setDur} /></Field>
      </div>
      <h3 style={{ margin: '8px 0' }}>Intervalos</h3>
      {breaks.map((b, i) => (
        <div className="row" key={i} style={{ marginBottom: 6 }}>
          <span className="small">Após a</span>
          <NumInput value={b.after} min={1} max={period.slots.length - 1} onChange={(v) => setBreaks(breaks.map((x, k) => (k === i ? { ...x, after: v ?? 1 } : x)))} ariaLabel="Após a aula" />
          <span className="small">ª aula, duração</span>
          <NumInput value={b.len} min={1} max={240} onChange={(v) => setBreaks(breaks.map((x, k) => (k === i ? { ...x, len: v ?? 0 } : x)))} ariaLabel="Duração do intervalo" />
          <span className="small">min</span>
          <input className="input" style={{ width: 140 }} value={b.label} placeholder="Nome" onChange={(e) => setBreaks(breaks.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
          <button className="btn small danger" onClick={() => setBreaks(breaks.filter((_, k) => k !== i))}>Remover</button>
        </div>
      ))}
      <button className="btn small" onClick={() => setBreaks([...breaks, { after: 1, len: 15, label: 'Intervalo' }])}>+ Adicionar intervalo</button>
    </Modal>
  );
}

export default function PeriodsPage() {
  const data = useData();
  const update = useStore((s) => s.update);
  const [auto, setAuto] = useState<Period | null>(null);

  const setCount = async (p: Period, n: number) => {
    if (n === p.slots.length) return;
    if (n < p.slots.length) {
      const ok = await confirmDialog('Reduzir aulas do período',
        <>Reduzir o período <b>{p.name}</b> de {p.slots.length} para {n} aulas diárias? Bloqueios, indisponibilidades e aulas da grade posicionadas nas aulas removidas deixarão de valer.</>, { danger: true, okLabel: 'Reduzir' });
      if (!ok) return;
    }
    update((d) => {
      const per = d.periods.find((x) => x.id === p.id)!;
      if (n < per.slots.length) {
        per.slots = per.slots.slice(0, n);
        per.breaks = per.breaks.filter((b) => b.afterSlot < n - 1);
        trimPeriodSlots(d, p.id, n);
      } else per.slots = [...per.slots, ...emptySlots(n - per.slots.length)];
    });
  };

  const remove = async (p: Period) => {
    const nc = data.classes.filter((c) => c.periodId === p.id).length;
    const ok = await confirmDialog('Excluir período', <>Excluir o período <b>{p.name}</b>? {nc > 0 && <>As <b>{nc} turma(s)</b> desse período e suas matrizes também serão excluídas.</>}</>, { danger: true, okLabel: 'Excluir' });
    if (ok) update((d) => deletePeriod(d, p.id));
  };

  return (
    <>
      <PageHeader
        title="Cadastro de períodos"
        subtitle="Configure a quantidade de aulas, os horários reais de início/término e os intervalos de cada período. Os intervalos não precisam ser iguais entre os períodos."
        actions={<button className="btn primary" onClick={() => update((d) => { d.periods.push({ id: uid('per'), name: `Período ${d.periods.length + 1}`, slots: emptySlots(5), breaks: [] }); })}>+ Novo período</button>}
      />
      {data.periods.map((p) => {
        const probs = periodProblems(p);
        return (
          <Card key={p.id}
            title={<div className="row"><TextInput value={p.name} required onChange={(v) => update((d) => { d.periods.find((x) => x.id === p.id)!.name = v; })} ariaLabel="Nome do período" /></div>}
            actions={<><button className="btn" onClick={() => setAuto(p)}>Calcular horários</button><button className="btn danger" onClick={() => remove(p)}>Excluir</button></>}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span>Aulas por dia:</span>
              <NumInput value={p.slots.length} min={1} max={16} onChange={(v) => v && setCount(p, v)} ariaLabel="Aulas por dia" />
              <span className="muted small">= {p.slots.length * data.school.days.length} horários semanais por turma</span>
            </div>
            <div className="grid2">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Aula</th><th>Início</th><th>Término</th></tr></thead>
                  <tbody>
                    {p.slots.map((s, i) => (
                      <Fragment key={i}>
                        <tr>
                          <td>{i + 1}ª aula</td>
                          <td><TimeInput value={s.start} ariaLabel={`Início da ${i + 1}ª aula`} onChange={(v) => update((d) => { d.periods.find((x) => x.id === p.id)!.slots[i].start = v; })} /></td>
                          <td><TimeInput value={s.end} ariaLabel={`Término da ${i + 1}ª aula`} onChange={(v) => update((d) => { d.periods.find((x) => x.id === p.id)!.slots[i].end = v; })} /></td>
                        </tr>
                        {p.breaks.filter((b) => b.afterSlot === i).map((b, k) => (
                          <tr key={`b${i}-${k}`}><td colSpan={3} className="muted small" style={{ background: '#f8fafc' }}>☕ {b.label}: {b.start || '--:--'} – {b.end || '--:--'}</td></tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 style={{ marginBottom: 8 }}>Intervalos</h3>
                {p.breaks.length === 0 && <p className="muted small">Nenhum intervalo cadastrado.</p>}
                {p.breaks.map((b, k) => (
                  <div key={k} className="row" style={{ marginBottom: 6 }}>
                    <span className="small">Após a</span>
                    <select className="input" style={{ width: 80 }} value={b.afterSlot} onChange={(e) => update((d) => { d.periods.find((x) => x.id === p.id)!.breaks[k].afterSlot = Number(e.target.value); })}>
                      {p.slots.slice(0, -1).map((_, i) => <option key={i} value={i}>{i + 1}ª</option>)}
                    </select>
                    <TimeInput value={b.start} ariaLabel="Início do intervalo" onChange={(v) => update((d) => { d.periods.find((x) => x.id === p.id)!.breaks[k].start = v; })} />
                    <TimeInput value={b.end} ariaLabel="Término do intervalo" onChange={(v) => update((d) => { d.periods.find((x) => x.id === p.id)!.breaks[k].end = v; })} />
                    <input className="input" style={{ width: 120 }} value={b.label} onChange={(e) => update((d) => { d.periods.find((x) => x.id === p.id)!.breaks[k].label = e.target.value; })} aria-label="Nome do intervalo" />
                    <button className="btn small danger" onClick={() => update((d) => { d.periods.find((x) => x.id === p.id)!.breaks.splice(k, 1); })}>✕</button>
                  </div>
                ))}
                <button className="btn small" disabled={p.slots.length < 2} onClick={() => update((d) => { d.periods.find((x) => x.id === p.id)!.breaks.push({ afterSlot: 0, start: '', end: '', label: 'Intervalo' }); })}>+ Adicionar intervalo</button>
                {probs.length > 0 && <div className="note err" style={{ marginTop: 12 }}>{probs.map((x, i) => <div key={i}>⚠ {x}</div>)}</div>}
                {p.slots.some((s) => !s.start || !s.end) && <div className="note warn" style={{ marginTop: 12 }}>Há aulas sem horário configurado. A grade pode ser gerada mesmo assim, mas os relatórios mostrarão apenas a ordem das aulas.</div>}
              </div>
            </div>
          </Card>
        );
      })}
      {auto && <AutoTimes period={auto} minutes={data.school.lessonMinutes} onClose={() => setAuto(null)} />}
    </>
  );
}
