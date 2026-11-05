import { Fragment, useState } from 'react';
import { Badge, Card, Empty, NumInput, PageHeader } from '../components/ui';
import { fmtNumber, workloadReport } from '../logic/workload';
import { useData, useStore } from '../store';
import type { Teacher, Workload } from '../types';

function Demonstrativo({ t }: { t: Teacher }) {
  const data = useData();
  const update = useStore((s) => s.update);
  const r = workloadReport(data, t);
  const setOthers = (fn: (o: Workload['others']) => void) => update((d) => fn(d.teachers.find((x) => x.id === t.id)!.workload.others));
  return (
    <div style={{ padding: '8px 4px 14px' }}>
      <table className="tbl">
        <thead><tr><th>Componente</th><th className="num">Declarado</th><th className="num">Cadastrado / atribuído</th><th>Contabiliza?</th><th className="num">Peso</th><th className="num">Valor na jornada ({r.unit})</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.component}>
              <td>{l.label}</td>
              <td className="num">{l.declared ?? '—'}</td>
              <td className="num">{l.configured}</td>
              <td>{l.counts ? 'Sim' : 'Não'}</td>
              <td className="num">{fmtNumber(l.weight)}</td>
              <td className="num">{fmtNumber(l.value)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5}>Total contabilizado {r.declaredTotal != null && `(declarado: ${fmtNumber(r.declaredTotal)})`}</td><td className="num">{fmtNumber(r.computedTotal)}</td></tr></tfoot>
      </table>
      {r.divergences.length > 0 ? <div className="note warn" style={{ marginTop: 8 }}>{r.divergences.map((x, i) => <div key={i}>⚠ {x}</div>)}</div> : <p className="ok-text small">✓ Sem divergências.</p>}
      <p className="muted small">Aulas = soma das atribuições nas turmas. H.A./CCH/HL/Outras = soma das regras cadastradas no módulo "H.A., CCH e HL" (quando não houver regra, usa-se o valor declarado). Pesos e unidade: "Configuração da escola".</p>
      <h3 style={{ margin: '8px 0' }}>Outras atividades da jornada</h3>
      {t.workload.others.map((o, i) => (
        <div className="row" key={i} style={{ marginBottom: 4 }}>
          <input className="input" style={{ maxWidth: 260 }} value={o.label} placeholder="Descrição" onChange={(e) => setOthers((arr) => { arr[i].label = e.target.value; })} aria-label="Descrição da atividade" />
          <NumInput value={o.qty} min={0} integer={false} onChange={(v) => setOthers((arr) => { arr[i].qty = v ?? 0; })} ariaLabel="Quantidade" />
          <button className="btn small danger" onClick={() => setOthers((arr) => { arr.splice(i, 1); })}>Remover</button>
        </div>
      ))}
      <button className="btn small" onClick={() => setOthers((arr) => { arr.push({ label: '', qty: 0 }); })}>+ Outra atividade</button>
    </div>
  );
}

export default function WorkloadPage() {
  const data = useData();
  const { update, pageParam, go } = useStore();
  const [open, setOpen] = useState<string | null>(pageParam);
  const unit = data.school.workload.unit;
  const set = (id: string, k: keyof Omit<Workload, 'others'>, v: number | null) => update((d) => { d.teachers.find((x) => x.id === id)!.workload[k] = v; });
  const teachers = [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return (
    <>
      <PageHeader title="Cargas horárias" subtitle={<>Informe a composição da jornada de cada professor. A carga total não é presumida como soma das aulas: veja o demonstrativo e as divergências. Unidade: <b>{unit}</b> (<button className="btn link" onClick={() => go('escola')}>alterar regras de contabilização</button>).</>} />
      {!teachers.length ? <Empty>Nenhum professor cadastrado.</Empty> : (
        <Card>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Professor</th><th className="num">Carga total</th><th className="num">Aulas regulares</th><th className="num">Aulas atribuídas</th>
                  <th className="num">H.A.</th><th className="num">CCH</th><th className="num">HL</th><th className="num">Total contabilizado</th><th>Situação</th><th></th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => {
                  const r = workloadReport(data, t);
                  return (
                    <Fragment key={t.id}>
                      <tr style={open === t.id ? { background: '#f8fafc' } : undefined}>
                        <td><b>{t.name}</b></td>
                        <td className="num"><NumInput value={t.workload.total} min={0} integer={false} allowEmpty placeholder="—" onChange={(v) => set(t.id, 'total', v)} ariaLabel="Carga total" /></td>
                        <td className="num"><NumInput value={t.workload.regular} min={0} allowEmpty placeholder="—" onChange={(v) => set(t.id, 'regular', v)} ariaLabel="Aulas regulares" /></td>
                        <td className="num">{r.assignedLessons}</td>
                        <td className="num"><NumInput value={t.workload.ha} min={0} integer={false} allowEmpty placeholder="—" onChange={(v) => set(t.id, 'ha', v)} ariaLabel="H.A." /></td>
                        <td className="num"><NumInput value={t.workload.cch} min={0} integer={false} allowEmpty placeholder="—" onChange={(v) => set(t.id, 'cch', v)} ariaLabel="CCH" /></td>
                        <td className="num"><NumInput value={t.workload.hl} min={0} integer={false} allowEmpty placeholder="—" onChange={(v) => set(t.id, 'hl', v)} ariaLabel="HL" /></td>
                        <td className="num">{fmtNumber(r.computedTotal)}</td>
                        <td>{t.workload.total == null ? <Badge kind="aviso">Carga não informada</Badge> : r.divergences.length ? <Badge kind="aviso" title={r.divergences.join('\n')}>{r.divergences.length} divergência(s)</Badge> : <Badge kind="ok">OK</Badge>}</td>
                        <td><button className="btn small" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Fechar' : 'Demonstrativo'}</button></td>
                      </tr>
                      {open === t.id && <tr><td colSpan={10}><Demonstrativo t={t} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
