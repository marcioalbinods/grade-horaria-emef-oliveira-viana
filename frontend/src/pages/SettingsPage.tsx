import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Badge, Card, confirmDialog, Field, PageHeader, Tabs, TextInput } from '../components/ui';
import { validateSchedule } from '../logic/conflicts';
import { kvGet, kvSet, normalizeData } from '../logic/db';
import { initialData } from '../logic/defaults';
import { demoData } from '../logic/demo';
import { applyImport, previewImport, templateWorkbook, type ImportPreview } from '../logic/importer';
import { ACTIVITY_LABELS, className, downloadBlob, POSITION_LABELS, safeFile, uid } from '../logic/util';
import { useData, useStore } from '../store';
import type { AppData } from '../types';

const REAL_KEY = 'appdata_real_backup';

function BackupTab() {
  const data = useData();
  const { update, replaceData, toast } = useStore();
  const [est, setEst] = useState<string>('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setEst(`${((e.usage ?? 0) / 1024 / 1024).toFixed(2)} MB usados`)).catch(() => {});
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  }, []);
  const backup = () => {
    const now = new Date();
    const payload = { ...data, lastBackup: now.toISOString() };
    downloadBlob(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }),
      safeFile(`backup-grade-${data.school.name}-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`));
    update((d) => { d.lastBackup = now.toISOString(); });
    toast('Backup salvo no seu computador.');
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = normalizeData(JSON.parse(await f.text()));
      const ok = await confirmDialog('Restaurar backup',
        <>Substituir TODOS os dados atuais pelo backup <b>{f.name}</b>?<br />Escola: <b>{parsed.school.name}</b> · {parsed.classes.length} turmas · {parsed.teachers.length} professores · {parsed.schedules.length} grade(s).<br />Recomenda-se fazer um backup dos dados atuais antes.</>, { danger: true, okLabel: 'Restaurar' });
      if (!ok) return;
      replaceData(parsed);
      toast('Backup restaurado.');
    } catch (e) {
      toast('Não foi possível restaurar: ' + String((e as Error).message ?? e), 'erro');
    }
  };
  return (
    <div className="grid2">
      <Card title="Backup completo (arquivo JSON)">
        <div className="note warn">Os dados ficam armazenados <b>somente neste navegador, neste computador</b> (IndexedDB). Limpar os dados do navegador, usar outro navegador ou outro computador fará com que eles não apareçam. Faça backups regularmente e guarde o arquivo em local seguro.</div>
        <p>Último backup: <b>{data.lastBackup ? new Date(data.lastBackup).toLocaleString('pt-BR') : 'nunca'}</b></p>
        <button className="btn primary" onClick={backup}>⬇ Baixar backup completo</button>
        <h3 style={{ margin: '16px 0 6px' }}>Restaurar backup</h3>
        <input type="file" accept=".json,application/json" onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} aria-label="Arquivo de backup" />
      </Card>
      <Card title="Armazenamento">
        <p>Salvamento automático: <b>ativado</b> (a cada alteração).</p>
        <p>Espaço: {est || 'não informado pelo navegador'}</p>
        <p>Proteção contra limpeza automática do navegador: {persisted == null ? 'não informado' : persisted ? <Badge kind="ok">ativada</Badge> : <Badge kind="aviso">não concedida</Badge>}</p>
        <p className="muted small">Nenhum dado é enviado a serviços externos. Ao gerar a grade, os dados de professores, turmas e restrições são enviados apenas ao motor de otimização que roda no seu próprio computador. O sistema não coleta nomes de estudantes.</p>
      </Card>
    </div>
  );
}

function ImportTab() {
  const data = useData();
  const { update, toast } = useStore();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const load = async (f: File | undefined) => {
    if (!f) return;
    try {
      setFileName(f.name);
      setPreview(previewImport(data, await f.arrayBuffer()));
    } catch (e) {
      toast('Não foi possível ler a planilha: ' + String((e as Error).message ?? e), 'erro');
    }
  };
  const valid = preview?.sheets.reduce((s, sh) => s + sh.rows.filter((r) => r.status === 'novo' || r.status === 'atualizar').length, 0) ?? 0;
  const errors = preview?.sheets.reduce((s, sh) => s + sh.rows.filter((r) => r.status === 'erro').length, 0) ?? 0;
  const apply = async () => {
    if (!preview) return;
    if (errors && !(await confirmDialog('Importar com erros', `${errors} linha(s) com erro serão ignoradas. Importar as ${valid} linhas válidas?`))) return;
    let res = { created: 0, updated: 0 };
    update((d) => { res = applyImport(d, preview); });
    toast(`Importação concluída: ${res.created} criado(s), ${res.updated} atualizado(s).`);
    setPreview(null);
  };
  return (
    <Card title="Importar planilha Excel">
      <p>Importe professores, turmas, disciplinas, cargas horárias e atribuições de aulas. Use o modelo para preencher os dados.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => XLSX.writeFile(templateWorkbook(), 'modelo-importacao-grade-horaria.xlsx')}>⬇ Baixar modelo de planilha</button>
        <input type="file" accept=".xlsx,.xls,.ods,.csv" onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} aria-label="Planilha para importar" />
      </div>
      {preview && (
        <>
          <div className="note">Prévia de <b>{fileName}</b>: {valid} linha(s) válida(s), {errors} com erro. Nada foi importado ainda.</div>
          {preview.missingSheets.length > 0 && <p className="muted small">Abas não encontradas (ignoradas): {preview.missingSheets.join(', ')}.</p>}
          {preview.sheets.map((sh) => (
            <details key={sh.name} open={sh.rows.some((r) => r.status === 'erro')}>
              <summary>{sh.name} — {sh.rows.length} linha(s)</summary>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Linha</th>{Object.keys(sh.rows[0]?.values ?? {}).map((k) => <th key={k}>{k}</th>)}<th>Situação</th></tr></thead>
                  <tbody>
                    {sh.rows.map((r) => (
                      <tr key={r.line}>
                        <td>{r.line}</td>
                        {Object.values(r.values).map((v, i) => <td key={i}>{v}</td>)}
                        <td>
                          <Badge kind={r.status === 'erro' ? 'erro' : r.status === 'duplicado' ? 'aviso' : r.status === 'atualizar' ? 'info' : 'ok'}>{r.status}</Badge>
                          {r.messages.map((m, i) => <div key={i} className="small muted">{m}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!valid} onClick={apply}>Importar {valid} linha(s) válida(s)</button>
            <button className="btn" onClick={() => setPreview(null)}>Cancelar</button>
          </div>
        </>
      )}
    </Card>
  );
}

function exportAll(data: AppData) {
  const wb = XLSX.utils.book_new();
  const per = (id: string) => data.periods.find((p) => p.id === id)?.name ?? '';
  const sub = (id: string) => data.subjects.find((s) => s.id === id)?.name ?? '';
  const tea = (id: string | null) => data.teachers.find((t) => t.id === id)?.name ?? '';
  const add = (name: string, rows: (string | number | null)[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add('Disciplinas', [['Nome', 'Sigla', 'Cor'], ...data.subjects.map((s) => [s.name, s.short, s.color])]);
  add('Turmas', [['Período', 'Ano/Série', 'Turma', 'Aulas semanais', 'Aulas diárias (máx.)', 'Nome'], ...data.classes.map((c) => [per(c.periodId), data.grades.find((g) => g.id === c.gradeId)?.name ?? '', c.letter, c.weeklyLessons, c.dailyMax, c.name])]);
  add('Professores', [['Nome', 'Disciplinas', 'Períodos', 'Dias de trabalho', 'Carga total', 'Aulas regulares', 'H.A.', 'CCH', 'HL', 'JEIF'], ...data.teachers.map((t) => [
    t.name, t.subjectIds.map(sub).join(';'), t.periodIds.map(per).join(';'), t.availability.workDays.map((d) => data.school.days[d]?.slice(0, 3)).join(';'),
    t.workload.total, t.workload.regular, t.workload.ha, t.workload.cch, t.workload.hl,
    data.school.jeifGroups.find((g) => g.id === t.jeifGroupId)?.name ?? ''])]);
  add('Atribuições', [['Professor', 'Período', 'Turma', 'Disciplina', 'Aulas semanais', 'Máx. por dia'], ...data.assignments.map((a) => {
    const c = data.classes.find((x) => x.id === a.classId);
    return [tea(a.teacherId), per(c?.periodId ?? ''), c?.name ?? '', sub(a.subjectId), a.lessons, a.maxPerDay];
  })]);
  add('Atividades', [['Professor', 'Tipo', 'Descrição', 'Período', 'Quantidade', 'Na grade', 'Posição', 'Turma'], ...data.activities.map((r) => [
    tea(r.teacherId), ACTIVITY_LABELS[r.type], r.label, per(r.periodId), r.qty, r.inGrid ? 'Sim' : 'Não', POSITION_LABELS[r.position], className(data, data.classes.find((c) => c.id === r.classId))])]);
  XLSX.writeFile(wb, safeFile(`${data.school.name} - dados cadastrados.xlsx`));
}

function HistoryTab() {
  const data = useData();
  const { update, toast } = useStore();
  const list = [...data.schedules].reverse();
  return (
    <Card title="Histórico de versões da grade">
      {!list.length ? <p className="muted">Nenhuma grade gerada ainda.</p> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Nome</th><th>Criada</th><th>Alterada</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => {
                const v = validateSchedule(data, s.entries);
                const c = v.filter((x) => x.severity === 'conflito').length;
                return (
                  <tr key={s.id}>
                    <td><TextInput value={s.name} required onChange={(nv) => update((d) => { d.schedules.find((x) => x.id === s.id)!.name = nv; })} />{s.edited && <span className="muted small">editada manualmente</span>}</td>
                    <td className="small">{new Date(s.createdAt).toLocaleString('pt-BR')}</td>
                    <td className="small">{new Date(s.updatedAt).toLocaleString('pt-BR')}</td>
                    <td>{c ? <Badge kind="erro">{c} conflito(s)</Badge> : <Badge kind="ok">sem conflitos</Badge>} {v.length - c > 0 && <Badge kind="aviso">{v.length - c} pendência(s)</Badge>}</td>
                    <td className="row" style={{ justifyContent: 'flex-end' }}>
                      {data.activeScheduleId === s.id ? <Badge kind="info">Ativa</Badge> : <button className="btn small" onClick={() => update((d) => { d.activeScheduleId = s.id; })}>Tornar ativa</button>}
                      <button className="btn small" onClick={() => { update((d) => { const now = new Date().toISOString(); d.schedules.push({ ...structuredClone(s), id: uid('grade'), name: `${s.name} (cópia)`, createdAt: now, updatedAt: now }); }); toast('Nova versão criada a partir desta grade.'); }}>Duplicar</button>
                      <button className="btn small danger" onClick={async () => { if (await confirmDialog('Excluir grade', `Excluir "${s.name}"?`, { danger: true, okLabel: 'Excluir' })) update((d) => { d.schedules = d.schedules.filter((x) => x.id !== s.id); if (d.activeScheduleId === s.id) d.activeScheduleId = d.schedules[d.schedules.length - 1]?.id ?? null; }); }}>Excluir</button>
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
}

function AdvancedTab() {
  const data = useData();
  const { update, replaceData, toast } = useStore();
  const [hasReal, setHasReal] = useState(false);
  useEffect(() => { kvGet(REAL_KEY).then((v) => setHasReal(!!v)).catch(() => {}); }, [data.isDemo]);
  const loadDemo = async () => {
    if (!(await confirmDialog('Carregar dados de demonstração',
      <>Os dados atuais serão guardados com segurança neste navegador e substituídos por uma escola <b>FICTÍCIA</b> com 30 turmas e professores fictícios, para você conhecer o sistema. Depois, use "Voltar aos dados reais".</>, { okLabel: 'Carregar demonstração' }))) return;
    if (!data.isDemo) await kvSet(REAL_KEY, data);
    replaceData(demoData());
    toast('Dados fictícios de demonstração carregados.', 'aviso');
  };
  const backToReal = async () => {
    const real = await kvGet<AppData>(REAL_KEY);
    if (!real) { toast('Não há dados reais guardados.', 'erro'); return; }
    replaceData(normalizeData(real));
    await kvSet(REAL_KEY, null);
    toast('Dados reais restaurados.');
  };
  const reset = async () => {
    if (!(await confirmDialog('Apagar todos os dados', 'Todos os cadastros e grades serão apagados e a estrutura inicial da escola será recriada. Faça um backup antes. Continuar?', { danger: true, okLabel: 'Apagar tudo' }))) return;
    if (!(await confirmDialog('Confirmação final', 'Esta ação não pode ser desfeita. Apagar todos os dados?', { danger: true, okLabel: 'Sim, apagar' }))) return;
    replaceData(initialData());
    toast('Dados apagados. Estrutura inicial recriada.');
  };
  return (
    <div className="grid2">
      <Card title="Dados de demonstração (fictícios)">
        <p className="small">Carrega uma escola fictícia completa para testar a montagem automática sem misturar com os dados reais.</p>
        <div className="row">
          {!data.isDemo && <button className="btn" onClick={loadDemo}>Carregar demonstração</button>}
          {(data.isDemo || hasReal) && <button className="btn primary" onClick={backToReal} disabled={!hasReal}>Voltar aos dados reais</button>}
        </div>
      </Card>
      <Card title="Motor de otimização">
        <Field label="Endereço do servidor" hint="Deixe em branco para usar o mesmo endereço desta página (padrão).">
          <TextInput value={data.school.solver.serverUrl} placeholder="(mesmo endereço)" onChange={(v) => update((d) => { d.school.solver.serverUrl = v; })} />
        </Field>
      </Card>
      <Card title="Exportar dados cadastrados">
        <p className="small">Gera uma planilha Excel com disciplinas, turmas, professores, atribuições e atividades (no mesmo formato da importação).</p>
        <button className="btn" onClick={() => exportAll(data)}>⬇ Exportar dados (Excel)</button>
      </Card>
      <Card title="Apagar dados">
        <p className="small">Remove todos os dados deste navegador e recria a estrutura inicial informada pela escola.</p>
        <button className="btn danger" onClick={reset}>Apagar todos os dados</button>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  type T = 'backup' | 'importar' | 'historico' | 'avancado';
  const param = useStore((s) => s.pageParam);
  const [tab, setTab] = useState<T>((['backup', 'importar', 'historico', 'avancado'] as T[]).includes(param as T) ? (param as T) : 'backup');
  useEffect(() => { if (param && ['backup', 'importar', 'historico', 'avancado'].includes(param)) setTab(param as T); }, [param]);
  return (
    <>
      <PageHeader title="Configurações e backups" subtitle="Backup e restauração, importação de planilhas, histórico de versões da grade e dados de demonstração." />
      <Tabs value={tab} onChange={setTab} items={[
        { id: 'backup', label: 'Backup e armazenamento' }, { id: 'importar', label: 'Importar planilha' },
        { id: 'historico', label: 'Histórico de versões' }, { id: 'avancado', label: 'Outras opções' },
      ]} />
      {tab === 'backup' && <BackupTab />}
      {tab === 'importar' && <ImportTab />}
      {tab === 'historico' && <HistoryTab />}
      {tab === 'avancado' && <AdvancedTab />}
    </>
  );
}
