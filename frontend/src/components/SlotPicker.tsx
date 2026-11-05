import type { Period } from '../types';
import { slotTime } from '../logic/util';

export interface CellLook {
  cls: string; // classe CSS
  text?: string;
  title?: string;
}

/** Grade semanal clicável (dias × aulas) usada para marcar disponibilidades,
 *  bloqueios e horários permitidos/fixos. */
export function SlotPicker(props: {
  period: Period;
  days: string[];
  look: (d: number, s: number) => CellLook;
  onCell: (d: number, s: number) => void;
  onDay?: (d: number) => void;
  onSlot?: (s: number) => void;
  disabledDays?: number[];
}) {
  const { period, days } = props;
  return (
    <div className="picker-wrap">
      <table className="picker">
        <thead>
          <tr>
            <th>Aula</th>
            {days.map((d, i) => (
              <th key={i}>
                {props.onDay ? (
                  <button className="link-th" onClick={() => props.onDay!(i)} title="Alternar o dia inteiro">{d.slice(0, 3)}</button>
                ) : (
                  d.slice(0, 3)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {period.slots.map((_, s) => (
            <tr key={s}>
              <th>
                {props.onSlot ? (
                  <button className="link-th" onClick={() => props.onSlot!(s)} title="Alternar esta aula em todos os dias">{s + 1}ª</button>
                ) : (
                  `${s + 1}ª`
                )}
                <span className="picker-time">{slotTime(period, s)}</span>
              </th>
              {days.map((dn, d) => {
                const l = props.look(d, s);
                const dis = props.disabledDays?.includes(d);
                return (
                  <td key={d}>
                    <button
                      className={'pcell ' + l.cls + (dis ? ' dis' : '')}
                      onClick={() => !dis && props.onCell(d, s)}
                      title={l.title ?? `${dn}, ${s + 1}ª aula`}
                      aria-label={`${dn}, ${s + 1}ª aula: ${l.title ?? l.cls}`}
                      disabled={dis}
                    >
                      {l.text ?? ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
