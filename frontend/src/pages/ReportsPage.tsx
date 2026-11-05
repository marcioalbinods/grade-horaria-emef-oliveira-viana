import { useMemo, useState } from 'react';
import { Card, PageHeader } from '../components/ui';
import { exportCsv, exportPdf, exportXlsx } from '../logic/exporters';
import { buildReport, REPORTS } from '../logic/reports';
import { contrastText } from '../logic/util';
import { useData } from '../store';
import { useScheduleChoice } from './SchedulePages';

export default function ReportsPage() {
  const data = useData();
  const { sch, setId } = useScheduleChoice(data);
  const [rid, setRid] = useState('grade-turma');
  const meta = REPORTS.find((r) => r.id === rid)!;
  const report = useMemo(() => buildReport(data, sch, rid), [data, sch, rid]);
  const blocked = meta.needsSchedule && !sch;
  const school = data.school.name;

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Relatórios individuais e gerais. Exporte em PDF, Excel ou CSV, ou imprima em formato organizado." />
      <div className="split">
        <Card title="Relatórios" className="no-print">
          <div className="list-sel">
            {REPORTS.map((r) => (
              <button key={r.id} className={r.id === rid ? 'active' : ''} onClick={() => setRid(r.id)} title={r.description}>
                <span>{r.title}</span>
              </button>
            ))}
          </div>
          {data.schedules.length > 0 && (
            <>
              <p className="field-label" style={{ marginTop: 12 }}>Grade usada nos relatórios</p>
              <select className="input" value={sch?.id ?? ''} onChange={(e) => setId(e.target.value)}>
                {data.schedules.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === data.activeScheduleId ? ' (ativa)' : ''}</option>)}
              </select>
            </>
          )}
        </Card>
        <div>
          <Card title={meta.title} actions={!blocked && <div className="no-print row">
            <button className="btn small primary" onClick={() => exportPdf(report, school)}>PDF</button>
            <button className="btn small" onClick={() => exportXlsx(report, school)}>Excel</button>
            <button className="btn small" onClick={() => exportCsv(report, school)}>CSV</button>
            <button className="btn small" onClick={() => window.print()}>Imprimir</button>
          </div>}>
            <p className="muted small no-print">{meta.description}</p>
            <div className="print-only"><h2>{school}</h2><p>{meta.title}{sch ? ` · ${sch.name}` : ''} · emitido em {new Date().toLocaleString('pt-BR')}</p></div>
            {blocked ? <p className="muted">Este relatório depende de uma grade gerada.</p> : report.tables.length === 0 ? <p className="muted">Nada a exibir.</p> : report.tables.map((t, i) => (
              <div key={i} className={t.grid ? 'print-break' : ''} style={{ marginBottom: 18 }}>
                <h3>{t.title}</h3>
                {t.subtitle && <p className="muted small">{t.subtitle}</p>}
                <div className="tbl-wrap">
                  <table className="tbl" style={t.grid ? { tableLayout: 'fixed' } : undefined}>
                    <thead><tr>{t.head.map((h, k) => <th key={k} style={t.grid && k < 2 ? { width: k === 0 ? 50 : 100 } : undefined}>{h}</th>)}</tr></thead>
                    <tbody>
                      {t.rows.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, k) => {
                            const col = t.colors?.[r]?.[k];
                            return (
                              <td key={k} className={typeof cell === 'number' ? 'num' : ''}
                                style={col ? { background: col, color: contrastText(col), whiteSpace: 'pre-line', fontSize: '0.8rem', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } : t.grid ? { whiteSpace: 'pre-line', fontSize: '0.8rem' } : undefined}>
                                {cell}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
