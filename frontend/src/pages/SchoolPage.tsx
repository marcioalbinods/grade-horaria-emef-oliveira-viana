import { Card, Check, confirmDialog, Field, NumInput, PageHeader, TextInput } from '../components/ui';
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
