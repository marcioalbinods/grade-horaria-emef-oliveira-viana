import { Card, Check, confirmDialog, Field, NumInput, PageHeader, TextInput, TimeInput } from '../components/ui';
import { periodBeforeJeif } from '../logic/jeif';
import { toMinutes, uid } from '../logic/util';
import { WEEK_DAYS } from '../logic/defaults';
import { trimDays } from '../logic/mutations';
import { useData, useStore } from '../store';
import type { FreePolicy, WorkComponent } from '../types';

const COMPONENTS: [WorkComponent, string][] = [
  ['aula', 'Aula regular'],
  ['HA', 'H.A. (Hora-Atividade)'],
  ['CCH', 'CCH (Complementação de Carga Horária)'],
  ['HL', 'HL'],
  ['OUTRA', 'Outras atividades'],
];

function JeifGroupsCard() {
  const data = useData();
  const update = useStore((s) => s.update);
  const days = data.school.days;
  const remove = async (id: string, name: string) => {
    const n = data.teachers.filter((t) => t.jeifGroupId === id).length;
    if (!(await confirmDialog('Excluir agrupamento de JEIF', <>Excluir o <b>{name}</b>?{n > 0 && <> {n} professor(es) desse grupo ficarão como “Não faz JEIF”.</>}</>, { danger: true, okLabel: 'Excluir' }))) return;
    update((d) => {
      d.school.jeifGroups = d.school.jeifGroups.filter((g) => g.id !== id);
      for (const t of d.teachers) if (t.jeifGroupId === id) t.jeifGroupId = null;
    });
  };
  const set = (id: string, fn: (g: (typeof data.school.jeifGroups)[number]) => void) =>
    update((d) => fn(d.school.jeifGroups.find((g) => g.id === id)!));
  return (
    <Card title="Agrupamentos de JEIF (Jornada Especial Integral de Formação)"
      actions={<button className="btn small" onClick={() => update((d) => { d.school.jeifGroups.push({ id: uid('jeif'), name: `Grupo ${d.school.jeifGroups.length + 1}`, start: '', end: '', days: [0, 1, 2, 3].filter((x) => x < d.school.days.length), noGapBefore: false }); })}>+ Novo agrupamento</button>}>
      <p className="muted small">
        O agrupamento de cada professor é escolhido no cadastro do professor. Nos dias marcados, o professor nunca recebe aulas cujo horário
        coincida com a JEIF (o sistema compara com os horários reais cadastrados em “Cadastro de períodos”).
      </p>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Grupo</th><th>Início</th><th>Término</th><th>Dias</th><th>Sem horário vago antes da JEIF</th><th className="num">Professores</th><th></th></tr></thead>
          <tbody>
            {data.school.jeifGroups.map((g) => {
              const a = toMinutes(g.start), b = toMinutes(g.end);
              const before = periodBeforeJeif(data, g);
              return (
                <tr key={g.id}>
                  <td><TextInput value={g.name} required onChange={(v) => set(g.id, (x) => { x.name = v; })} ariaLabel="Nome do grupo" /></td>
                  <td><TimeInput value={g.start} onChange={(v) => set(g.id, (x) => { x.start = v; })} ariaLabel="Início da JEIF" /></td>
                  <td>
                    <TimeInput value={g.end} onChange={(v) => set(g.id, (x) => { x.end = v; })} ariaLabel="Término da JEIF" />
                    {a != null && b != null && b <= a && <div className="field-error">Término antes do início.</div>}
                  </td>
                  <td>
                    {days.map((dn, d) => (
                      <Check key={d} label={dn.slice(0, 3)} checked={g.days.includes(d)}
                        onChange={(v) => set(g.id, (x) => { x.days = v ? [...x.days, d].sort() : x.days.filter((y) => y !== d); })} />
                    ))}
                  </td>
                  <td>
                    <Check label={before ? `Aulas do período ${before.name} vão até a última aula` : 'Ativar'} checked={g.noGapBefore}
                      onChange={(v) => set(g.id, (x) => { x.noGapBefore = v; })} />
                  </td>
                  <td className="num">{data.teachers.filter((t) => t.jeifGroupId === g.id).length}</td>
                  <td><button className="btn small danger" onClick={() => remove(g.id, g.name)}>Excluir</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">“Sem horário vago antes da JEIF”: nos dias de JEIF, o professor que trabalha no período que termina imediatamente antes da JEIF
        (por exemplo, a Tarde, para o Grupo III) tem suas aulas desse período terminando na última aula, sem aula vaga até a JEIF.</p>
    </Card>
  );
}

export default function SchoolPage() {
  const data = useData();
  const update = useStore((s) => s.update);
  const s = data.school;

  const removeLastDay = async () => {
    const name = s.days[s.days.length - 1];
    if (!(await confirmDialog('Remover dia letivo', <>Remover <b>{name}</b> dos dias letivos? Indisponibilidades, bloqueios e aulas desse dia serão descartados.</>, { danger: true, okLabel: 'Remover' }))) return;
    update((d) => {
      const n = d.school.days.length - 1;
      d.school.days.pop();
      trimDays(d, n);
    });
  };

  return (
    <>
      <PageHeader title="Configuração da escola" subtitle="Informações gerais da unidade escolar e da forma de contabilizar a jornada." />
      <div className="grid2">
        <Card title="Identificação">
          <Field label="Nome da unidade escolar">
            <TextInput value={s.name} onChange={(v) => update((d) => { d.school.name = v; })} />
          </Field>
          <Field label="Duração de cada aula (minutos)" hint="Usada como referência para calcular horários automaticamente no cadastro de períodos.">
            <NumInput value={s.lessonMinutes} min={1} max={240} onChange={(v) => update((d) => { d.school.lessonMinutes = v ?? 45; })} />
          </Field>
          <Field label="Tratamento padrão dos horários sem aula em turmas novas" hint="Pode ser alterado individualmente em cada turma.">
            <select className="input" value={s.defaultFreePolicy} onChange={(e) => update((d) => { d.school.defaultFreePolicy = e.target.value as FreePolicy; })}>
              <option value="livre">Permanecem livres</option>
              <option value="reservado">Reservados para atividades específicas</option>
              <option value="complementar">Podem receber atividades complementares</option>
            </select>
          </Field>
        </Card>
        <Card title="Dias letivos">
          <p className="muted small">Os dias são usados na ordem abaixo. Para manter a consistência dos dados, dias são adicionados ou removidos no final da lista.</p>
          {s.days.map((dn, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <span className="muted small" style={{ width: 20 }}>{i + 1}.</span>
              <TextInput value={dn} required onChange={(v) => update((d) => { d.school.days[i] = v; })} ariaLabel={`Nome do dia ${i + 1}`} />
            </div>
          ))}
          <div className="row">
            <button className="btn small" disabled={s.days.length >= 7} onClick={() => update((d) => { d.school.days.push(WEEK_DAYS[d.school.days.length] ?? `Dia ${d.school.days.length + 1}`); })}>+ Adicionar dia</button>
            <button className="btn small danger" disabled={s.days.length <= 1} onClick={removeLastDay}>Remover último dia</button>
          </div>
        </Card>
      </div>
      <JeifGroupsCard />
      <Card title="Como a jornada dos professores é contabilizada">
        <p className="muted small">
          A carga horária total não é presumida como soma das aulas. Defina a unidade de medida adotada pela escola, quais componentes entram na
          jornada e quanto vale cada unidade de cada componente. O demonstrativo de cada professor (em "Cargas horárias") usa estas regras.
        </p>
        <Field label="Unidade de medida da jornada" hint='Exemplos: "aulas", "horas-aula", "horas", "minutos".'>
          <TextInput value={s.workload.unit} required onChange={(v) => update((d) => { d.school.workload.unit = v; })} />
        </Field>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Componente</th><th>Conta na jornada?</th><th>Valor de cada unidade (em {s.workload.unit})</th></tr>
            </thead>
            <tbody>
              {COMPONENTS.map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td><Check checked={s.workload.components[k].counts} onChange={(v) => update((d) => { d.school.workload.components[k].counts = v; })} label={s.workload.components[k].counts ? 'Sim' : 'Não'} /></td>
                  <td><NumInput value={s.workload.components[k].weight} min={0} integer={false} onChange={(v) => update((d) => { d.school.workload.components[k].weight = v ?? 0; })} ariaLabel={`Peso de ${label}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
