// JEIF (Jornada Especial Integral de Formação): horários em que o professor
// não pode ter aulas e regra de "sem horário vago" antes da JEIF.
import type { AppData, JeifGroup, Period, Teacher } from '../types';
import { slotKey, toMinutes } from './util';

export interface JeifInfo {
  group: JeifGroup | null;
  /** Chaves "periodo|dia|aula" que coincidem com a JEIF (proibidas para aulas). */
  blocked: Set<string>;
  /** Dias/período em que as aulas devem terminar na última aula, sem vaga até a JEIF. */
  noGap: { periodId: string; day: number }[];
  /** Períodos do professor sem horários configurados (impossível calcular a coincidência). */
  missingTimes: string[];
  /** Problema no próprio cadastro do grupo (horário inválido). */
  invalid: string | null;
}

function periodComplete(p: Period) {
  return p.slots.length > 0 && p.slots.every((s) => toMinutes(s.start) != null && toMinutes(s.end) != null);
}

export function jeifGroupOf(data: AppData, t: Teacher): JeifGroup | null {
  if (!t.jeifGroupId) return null;
  return data.school.jeifGroups.find((g) => g.id === t.jeifGroupId) ?? null;
}

export function jeifLabel(g: JeifGroup | null, days: string[]): string {
  if (!g) return 'Não faz JEIF';
  const d = g.days.filter((x) => x < days.length).map((x) => days[x]?.slice(0, 3)).join(', ');
  return `${g.name} (${g.start}–${g.end}${d ? `, ${d}` : ''})`;
}

/** Período da escola que termina imediatamente antes do início da JEIF (ex.: Tarde para o Grupo III). */
export function periodBeforeJeif(data: AppData, g: JeifGroup): Period | null {
  const js = toMinutes(g.start);
  if (js == null) return null;
  let best: Period | null = null;
  let bestEnd = -1;
  for (const p of data.periods) {
    if (!periodComplete(p)) continue;
    const end = toMinutes(p.slots[p.slots.length - 1].end)!;
    if (end <= js && end > bestEnd) {
      best = p;
      bestEnd = end;
    }
  }
  return best;
}

export function jeifInfo(data: AppData, t: Teacher): JeifInfo {
  const out: JeifInfo = { group: jeifGroupOf(data, t), blocked: new Set(), noGap: [], missingTimes: [], invalid: null };
  const g = out.group;
  if (!g) return out;
  const js = toMinutes(g.start), je = toMinutes(g.end);
  if (js == null || je == null || je <= js) {
    out.invalid = `O horário da JEIF ${g.name} é inválido (${g.start || '--:--'}–${g.end || '--:--'}).`;
    return out;
  }
  const D = data.school.days.length;
  const days = g.days.filter((d) => d >= 0 && d < D);
  for (const pid of t.periodIds) {
    const p = data.periods.find((x) => x.id === pid);
    if (!p) continue;
    if (!periodComplete(p)) {
      out.missingTimes.push(p.name);
      continue;
    }
    p.slots.forEach((sl, s) => {
      const a = toMinutes(sl.start)!, b = toMinutes(sl.end)!;
      if (a < je && js < b) for (const d of days) out.blocked.add(slotKey(pid, d, s));
    });
  }
  if (g.noGapBefore) {
    const incomplete = data.periods.filter((p) => !periodComplete(p)).map((p) => p.name);
    if (incomplete.length) {
      for (const n of incomplete) if (!out.missingTimes.includes(n)) out.missingTimes.push(n);
      return out;
    }
    const before = periodBeforeJeif(data, g);
    if (before && t.periodIds.includes(before.id)) for (const d of days) out.noGap.push({ periodId: before.id, day: d });
  }
  return out;
}
