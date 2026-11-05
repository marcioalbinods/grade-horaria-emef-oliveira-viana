"""Motor de montagem da grade horária baseado em Google OR-Tools CP-SAT.

Modelo
------
* x[a, d, s] = 1 se uma aula da atribuição ``a`` (turma + disciplina + professor)
  ocorre no dia ``d``, aula ``s`` do período da turma.
* y[r, d, s] = 1 se uma unidade da atividade ``r`` (H.A., CCH, HL, outra) do
  professor ocorre no dia ``d``, aula ``s`` do período da atividade.

Restrições obrigatórias (sempre respeitadas)
* cada atribuição recebe exatamente a quantidade de aulas cadastrada;
* cada atividade recebe exatamente a quantidade cadastrada;
* uma turma tem no máximo uma aula por horário;
* um professor tem no máximo uma ocupação por horário, inclusive entre
  períodos diferentes cujos horários reais se sobreponham;
* indisponibilidades, dias de trabalho, entrada/saída, limites e regras de
  posicionamento das atividades.

Os grupos de restrições configuráveis pelo usuário podem ser ativados por
"literais de suposição" no modo de diagnóstico. Assim, quando o problema é
impossível, o CP-SAT informa um subconjunto de grupos que, juntos, impedem a
montagem (núcleo de inviabilidade).
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Optional

from ortools.sat.python import cp_model

from .schemas import ProblemIn, Weights

STRATEGY_WEIGHTS: dict[str, Weights] = {
    "janelas": Weights(gap=100, isolated=40, days=8, shifts=10, distribution=15, triple=10,
                       preferences=30, holes=20, double=10, softLimits=50),
    "dias": Weights(gap=25, isolated=15, days=100, shifts=60, distribution=10, triple=10,
                    preferences=30, holes=15, double=5, softLimits=50),
    "distribuicao": Weights(gap=15, isolated=10, days=5, shifts=5, distribution=100, triple=60,
                            preferences=30, holes=15, double=20, softLimits=50),
    "aproveitamento": Weights(gap=40, isolated=60, days=10, shifts=10, distribution=20, triple=10,
                              preferences=30, holes=100, double=10, softLimits=50),
    "preferencias": Weights(gap=30, isolated=15, days=10, shifts=10, distribution=15, triple=10,
                            preferences=120, holes=15, double=30, softLimits=120),
    "equilibrada": Weights(gap=50, isolated=30, days=30, shifts=30, distribution=50, triple=30,
                           preferences=50, holes=40, double=15, softLimits=60),
}

STRATEGY_LABELS = {
    "janelas": "Menos janelas",
    "dias": "Menos dias trabalhados (concentrar a jornada)",
    "distribuicao": "Melhor distribuição das disciplinas",
    "aproveitamento": "Melhor aproveitamento dos horários",
    "preferencias": "Maior atendimento às preferências",
    "equilibrada": "Solução equilibrada",
    "personalizada": "Pesos personalizados",
}

STRUCTURAL = None  # proibição que nunca pode ser relaxada


def _minutes(hhmm: Optional[str]) -> Optional[int]:
    if not hhmm:
        return None
    try:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def cross_period_overlaps(problem: ProblemIn) -> list[tuple[str, int, str, int]]:
    """Pares (p1, s1, p2, s2) de aulas de períodos distintos que se sobrepõem no relógio."""
    out = []
    periods = problem.periods
    for i, p1 in enumerate(periods):
        for p2 in periods[i + 1:]:
            for s1, a in enumerate(p1.slots):
                a0, a1 = _minutes(a.start), _minutes(a.end)
                if a0 is None or a1 is None:
                    continue
                for s2, b in enumerate(p2.slots):
                    b0, b1 = _minutes(b.start), _minutes(b.end)
                    if b0 is None or b1 is None:
                        continue
                    if a0 < b1 and b0 < a1:
                        out.append((p1.id, s1, p2.id, s2))
    return out


@dataclass
class Group:
    key: str
    kind: str
    message: str
    suggestion: str
    refs: list[str] = field(default_factory=list)


class ModelBuilder:
    """Constrói o modelo CP-SAT.

    mode = "solve"     → restrições configuráveis são rígidas e variáveis
                          proibidas nem chegam a ser criadas;
    mode = "check"     → igual a "solve", mas sem objetivo (só viabilidade);
    mode = "diagnose"  → cada grupo de restrições é controlado por um literal
                          (suposição) para extração do núcleo de inviabilidade;
    relax_lessons      → permite aulas não alocadas (penalizadas) para indicar
                          quais aulas não cabem.
    """

    def __init__(self, problem: ProblemIn, weights: Optional[Weights] = None,
                 mode: str = "solve", relax_lessons: bool = False,
                 disabled_groups: Optional[set[str]] = None):
        self.p = problem
        self.w = weights or Weights()
        self.mode = mode
        self.relax = relax_lessons
        self.disabled = disabled_groups or set()
        self.m = cp_model.CpModel()
        self.D = len(problem.days)
        self.periods = {p.id: p for p in problem.periods}
        self.nslots = {p.id: len(p.slots) for p in problem.periods}
        self.classes = {c.id: c for c in problem.classes}
        self.teachers = {t.id: t for t in problem.teachers}
        self.groups: dict[str, Group] = {}
        self.lits: dict[str, cp_model.IntVar] = {}
        self.x: dict[str, dict[tuple[int, int], cp_model.IntVar]] = {}
        self.y: dict[str, dict[tuple[int, int], cp_model.IntVar]] = {}
        self.unplaced: dict[str, cp_model.IntVar] = {}
        self.terms: dict[str, list] = {k: [] for k in Weights.model_fields}
        self.teacher_occ: dict[tuple[str, str, int, int], list] = {}
        self.teacher_les: dict[tuple[str, str, int, int], list] = {}
        self.class_occ: dict[tuple[str, int, int], list] = {}
        self.build()

    # ------------------------------------------------------------------ grupos
    def group(self, key: str, kind: str, message: str, suggestion: str, refs=None):
        """Retorna o literal do grupo (modo diagnóstico) ou None (modo normal)."""
        if key not in self.groups:
            self.groups[key] = Group(key, kind, message, suggestion, refs or [])
            if self.mode == "diagnose":
                self.lits[key] = self.m.NewBoolVar(f"g[{key}]")
        if self.mode == "diagnose":
            return self.lits[key]
        return None

    def enforce(self, ct, lit):
        if lit is not None:
            ct.OnlyEnforceIf(lit)
        return ct

    # -------------------------------------------------------- disponibilidade
    def teacher_forbid(self, t, pid: str, d: int, s: int) -> list:
        """Lista de motivos (grupos) que proíbem o professor neste horário."""
        reasons: list = []
        if pid not in t.periodIds:
            return [STRUCTURAL]
        if d not in t.workDays:
            reasons.append(("tdays:" + t.id, "dias",
                            f"Dias de trabalho de {t.name}",
                            f"Inclua mais dias de trabalho para {t.name} ou reduza suas aulas.",
                            [t.id]))
        if (pid, d, s) in self._unavail[t.id]:
            reasons.append(("tunav:" + t.id, "indisponibilidade",
                            f"Horários indisponíveis de {t.name}",
                            f"Revise os horários marcados como indisponíveis para {t.name}.",
                            [t.id]))
        lo = t.entry.get(pid)
        hi = t.exit.get(pid)
        if (lo is not None and s < lo) or (hi is not None and s > hi):
            reasons.append(("tentry:" + t.id, "entrada",
                            f"Horários de entrada/saída de {t.name}",
                            f"Flexibilize a entrada ou a saída obrigatória de {t.name}.",
                            [t.id]))
        return reasons

    def _apply_forbid(self, var, reasons):
        for r in reasons:
            key, kind, msg, sug, refs = r
            lit = self.group(key, kind, msg, sug, refs)
            self.m.AddImplication(lit, var.Not())

    # ------------------------------------------------------------------ build
    def build(self):
        p, m = self.p, self.m
        self._unavail = {t.id: {tuple(u) for u in t.unavailable} for t in p.teachers}
        D = self.D

        # ---- variáveis de aula
        for a in p.assignments:
            c = self.classes[a.classId]
            t = self.teachers[a.teacherId]
            pid = c.periodId
            blocked = {tuple(b) for b in c.blocked}
            vars_a = {}
            for d in range(D):
                for s in range(self.nslots[pid]):
                    reasons = self.teacher_forbid(t, pid, d, s)
                    if STRUCTURAL in reasons:
                        continue
                    if (d, s) in blocked:
                        reasons.append(("cblock:" + c.id, "turma",
                                        f"Horários bloqueados da turma {c.name}",
                                        f"Libere horários bloqueados da turma {c.name}.",
                                        [c.id]))
                    reasons = [r for r in reasons if r[0] not in self.disabled]
                    if self.mode != "diagnose" and reasons:
                        continue
                    v = m.NewBoolVar(f"x[{a.id},{d},{s}]")
                    vars_a[(d, s)] = v
                    if reasons:
                        self._apply_forbid(v, reasons)
            self.x[a.id] = vars_a
            for (d, s), v in vars_a.items():
                self.class_occ.setdefault((c.id, d, s), []).append(v)
                self.teacher_occ.setdefault((t.id, pid, d, s), []).append(v)
                self.teacher_les.setdefault((t.id, pid, d, s), []).append(v)

            total = sum(vars_a.values())
            if self.relax:
                u = m.NewIntVar(0, a.lessons, f"unplaced[{a.id}]")
                self.unplaced[a.id] = u
                m.Add(total + u == a.lessons)
            else:
                m.Add(total == a.lessons)

            if a.maxPerDay is not None and a.maxPerDay < self.nslots[pid]:
                key = "amax:" + a.id
                if key not in self.disabled:
                    lit = self.group(key, "limite", f"Máximo de {a.maxPerDay} aula(s) por dia de "
                                     f"uma disciplina na turma {c.name} ({t.name})",
                                     "Aumente o máximo de aulas por dia dessa disciplina.",
                                     [a.id])
                    for d in range(D):
                        day = [v for (dd, _), v in vars_a.items() if dd == d]
                        if day:
                            self.enforce(m.Add(sum(day) <= a.maxPerDay), lit)

        # ---- atividades (H.A., CCH, HL, outras)
        self._act_meta = {}
        for r in p.activities:
            self._build_activity(r)
        for r in p.activities:
            self._activity_position(r)

        # ---- aulas fixadas manualmente
        for i, lk in enumerate(p.locks):
            key = f"lock:{i}"
            if key in self.disabled:
                continue
            store = self.x if lk.kind == "aula" else self.y
            v = store.get(lk.refId, {}).get((lk.day, lk.slot))
            lit = self.group(key, "fixada", f"Aula/atividade fixada ({lk.refId}) no dia {lk.day + 1}, "
                             f"{lk.slot + 1}ª aula", "Desbloqueie esta aula fixada.", [lk.refId])
            if v is None:
                # horário impossível para essa aula: só é possível se o bloqueio for retirado
                if lit is None:
                    m.AddBoolOr([])  # inviável
                else:
                    m.AddBoolOr([lit.Not()])
            else:
                self.enforce(m.Add(v == 1), lit)

        # ---- capacidade da turma
        for (cid, d, s), vs in self.class_occ.items():
            if len(vs) > 1:
                m.AddAtMostOne(vs)
        for c in p.classes:
            n = self.nslots[c.periodId]
            if c.dailyMax is not None and c.dailyMax < n:
                key = "cdaily:" + c.id
                if key in self.disabled:
                    continue
                lit = self.group(key, "turma", f"Limite de {c.dailyMax} aulas diárias da turma {c.name}",
                                 f"Aumente o limite de aulas diárias da turma {c.name}.", [c.id])
                for d in range(D):
                    les = []
                    for a in p.assignments:
                        if a.classId == c.id:
                            les += [v for (dd, _), v in self.x[a.id].items() if dd == d]
                    if les:
                        self.enforce(m.Add(sum(les) <= c.dailyMax), lit)

        # ---- professor: um compromisso por horário
        for key, vs in self.teacher_occ.items():
            if len(vs) > 1:
                m.AddAtMostOne(vs)
        overlaps = cross_period_overlaps(p)
        for t in p.teachers:
            for (p1, s1, p2, s2) in overlaps:
                for d in range(D):
                    a = self.teacher_occ.get((t.id, p1, d, s1), [])
                    b = self.teacher_occ.get((t.id, p2, d, s2), [])
                    if a and b:
                        m.Add(sum(a) + sum(b) <= 1)

        # ---- limites do professor
        for t in p.teachers:
            self._teacher_limits(t)

        if self.mode == "solve":
            self._objective()  # no modo "check" não há objetivo: só viabilidade

    def _build_activity(self, r):
        m, D = self.m, self.D
        t = self.teachers[r.teacherId]
        pid = r.periodId
        n = self.nslots.get(pid, 0)
        key = "act:" + r.id
        disabled = key in self.disabled
        lit = None if disabled else self.group(
            key, "atividade", f"Regras da atividade {r.label} de {t.name}",
            f"Flexibilize os dias, horários ou a posição da atividade {r.label} de {t.name}, "
            "ou altere sua quantidade.", [r.id, t.id])
        days = set(r.days) if r.days else set(range(D))
        slots = set(r.slots) if r.slots else set(range(n))
        fixed = {tuple(f) for f in r.fixed}
        if r.position == "meio":
            slots -= {0, n - 1}
        cls = self.classes.get(r.classId) if r.classId else None
        vars_r = {}
        for d in range(D):
            for s in range(n):
                reasons = self.teacher_forbid(t, pid, d, s)
                if STRUCTURAL in reasons:
                    continue
                own_ok = d in days and s in slots
                if r.mode == "fixo":
                    own_ok = (d, s) in fixed
                reasons = [x for x in reasons if x[0] not in self.disabled]
                if self.mode != "diagnose" and (reasons or (not own_ok and not disabled)):
                    continue
                v = m.NewBoolVar(f"y[{r.id},{d},{s}]")
                vars_r[(d, s)] = v
                if reasons:
                    self._apply_forbid(v, reasons)
                if not own_ok and not disabled and lit is not None:
                    m.AddImplication(lit, v.Not())
        self.y[r.id] = vars_r
        for (d, s), v in vars_r.items():
            self.teacher_occ.setdefault((t.id, pid, d, s), []).append(v)
            if cls is not None:
                self.class_occ.setdefault((cls.id, d, s), []).append(v)

        total = sum(vars_r.values()) if vars_r else 0
        if disabled:
            m.Add(total <= r.qty)
            return
        if vars_r:
            self.enforce(m.Add(total == r.qty), lit)
        elif r.qty > 0:
            if lit is None:
                m.AddBoolOr([])
            else:
                m.AddBoolOr([lit.Not()])
        if r.mode == "fixo":
            for f in fixed:
                v = vars_r.get(f)
                if v is not None:
                    self.enforce(m.Add(v == 1), lit)
        if r.maxPerDay is not None:
            for d in range(D):
                day = [v for (dd, _), v in vars_r.items() if dd == d]
                if day:
                    self.enforce(m.Add(sum(day) <= r.maxPerDay), lit)

        self._act_meta[r.id] = (lit, n, pid, t)

    def _activity_position(self, r):
        m, D = self.m, self.D
        if r.id not in self._act_meta:
            return
        lit, n, pid, t = self._act_meta[r.id]
        vars_r = self.y.get(r.id, {})
        pos = r.position
        if pos in ("inicio_periodo", "fim_periodo", "inicio_ou_fim_periodo",
                   "inicio_jornada", "fim_jornada", "inicio_ou_fim_jornada"):
            for d in range(D):
                day = {s: v for (dd, s), v in vars_r.items() if dd == d}
                if not day:
                    continue
                if pos.startswith("inicio_ou_fim"):
                    side = m.NewBoolVar(f"side[{r.id},{d}]")  # 1 = início
                    starts = [side]
                    ends = [side.Not()]
                elif pos.startswith("inicio"):
                    starts, ends = [None], []
                else:
                    starts, ends = [], [None]
                jornada = pos.endswith("jornada")
                for s, v in day.items():
                    for cond in starts:
                        enf = [v] + ([cond] if cond is not None else []) + ([lit] if lit is not None else [])
                        if jornada:
                            for t2 in range(s):
                                others = [o for o in self.teacher_occ.get((t.id, pid, d, t2), [])
                                          if o is not day.get(t2)]
                                if others:
                                    m.Add(sum(others) == 0).OnlyEnforceIf(enf)
                        elif s > 0:
                            prev = day.get(s - 1)
                            if prev is None:
                                m.AddBoolOr([e.Not() for e in enf])
                            else:
                                m.Add(prev == 1).OnlyEnforceIf(enf)
                    for cond in ends:
                        enf = [v] + ([cond] if cond is not None else []) + ([lit] if lit is not None else [])
                        if jornada:
                            for t2 in range(s + 1, n):
                                others = [o for o in self.teacher_occ.get((t.id, pid, d, t2), [])
                                          if o is not day.get(t2)]
                                if others:
                                    m.Add(sum(others) == 0).OnlyEnforceIf(enf)
                        elif s < n - 1:
                            nxt = day.get(s + 1)
                            if nxt is None:
                                m.AddBoolOr([e.Not() for e in enf])
                            else:
                                m.Add(nxt == 1).OnlyEnforceIf(enf)


    def _teacher_limits(self, t):
        m, D = self.m, self.D
        if t.maxDaily is not None:
            key = "tdaily:" + t.id
            hard = t.maxDaily.hard and key not in self.disabled
            lit = self.group(key, "limite", f"Limite de {t.maxDaily.value} aulas diárias de {t.name}",
                             f"Aumente o limite diário de {t.name} ou transforme-o em preferência.",
                             [t.id]) if hard else None
            for d in range(D):
                les = []
                for pid in t.periodIds:
                    for s in range(self.nslots.get(pid, 0)):
                        les += self.teacher_les.get((t.id, pid, d, s), [])
                if not les:
                    continue
                if hard:
                    self.enforce(m.Add(sum(les) <= t.maxDaily.value), lit)
                elif self.mode == "solve" and not t.maxDaily.hard:
                    ex = m.NewIntVar(0, len(les), f"exd[{t.id},{d}]")
                    m.Add(ex >= sum(les) - t.maxDaily.value)
                    self.terms["softLimits"].append(ex)
        if t.maxConsecutive is not None:
            k = t.maxConsecutive.value
            key = "tconsec:" + t.id
            hard = t.maxConsecutive.hard and key not in self.disabled
            lit = self.group(key, "limite", f"Limite de {k} aulas consecutivas de {t.name}",
                             f"Aumente o limite de aulas consecutivas de {t.name}.",
                             [t.id]) if hard else None
            for pid in t.periodIds:
                n = self.nslots.get(pid, 0)
                for d in range(D):
                    for s0 in range(0, n - k):
                        win = []
                        for s in range(s0, s0 + k + 1):
                            win += self.teacher_les.get((t.id, pid, d, s), [])
                        if len(win) <= k:
                            continue
                        if hard:
                            self.enforce(m.Add(sum(win) <= k), lit)
                        elif self.mode == "solve" and not t.maxConsecutive.hard:
                            ex = m.NewIntVar(0, len(win), f"exc[{t.id},{pid},{d},{s0}]")
                            m.Add(ex >= sum(win) - k)
                            self.terms["softLimits"].append(ex)

    # -------------------------------------------------------------- objetivo
    def _objective(self):
        m, p, D, w = self.m, self.p, self.D, self.w
        T = self.terms
        teacher_factor_gap = {}
        teacher_factor_iso = {}
        for t in p.teachers:
            fg = 1 + (2 if t.avoidGaps else 0) + (1 if t.preferConsecutive else 0)
            fi = 1 + (2 if t.preferConsecutive else 0)
            teacher_factor_gap[t.id] = fg
            teacher_factor_iso[t.id] = fi

        for t in p.teachers:
            worked_day = {}
            for d in range(D):
                attends = []
                for pid in t.periodIds:
                    n = self.nslots.get(pid, 0)
                    occ = [self.teacher_occ.get((t.id, pid, d, s), []) for s in range(n)]
                    if not any(occ):
                        continue
                    att = m.NewBoolVar(f"att[{t.id},{pid},{d}]")
                    for o in occ:
                        for v in o:
                            m.AddImplication(v, att)
                    attends.append(att)
                    T["shifts"].append(att)
                    cnt = sum(sum(o) for o in occ if o)
                    iso = m.NewIntVar(0, 1, f"iso[{t.id},{pid},{d}]")
                    m.Add(iso >= 2 * att - cnt)
                    T["isolated"].append((iso, teacher_factor_iso[t.id]))
                    # janelas: horário vazio entre duas ocupações do mesmo turno
                    if n >= 3:
                        b = [m.NewBoolVar(f"b[{t.id},{pid},{d},{s}]") for s in range(n)]
                        e = [m.NewBoolVar(f"e[{t.id},{pid},{d},{s}]") for s in range(n)]
                        for s in range(n):
                            for v in occ[s]:
                                m.AddImplication(v, b[s])
                                m.AddImplication(v, e[s])
                            if s > 0:
                                m.AddImplication(b[s - 1], b[s])
                            if s < n - 1:
                                m.AddImplication(e[s + 1], e[s])
                        for s in range(1, n - 1):
                            g = m.NewBoolVar(f"gap[{t.id},{pid},{d},{s}]")
                            m.Add(g >= b[s] + e[s] - 1 - sum(occ[s]))
                            T["gap"].append((g, teacher_factor_gap[t.id]))
                if not attends:
                    continue
                wd = m.NewBoolVar(f"wd[{t.id},{d}]")
                for a in attends:
                    m.AddImplication(a, wd)
                worked_day[d] = wd
                T["days"].append(wd)
                if t.preferredDays and d not in t.preferredDays:
                    T["preferences"].append((wd, 2))
            if t.maxDays is not None and worked_day:
                over = m.NewIntVar(0, D, f"overdays[{t.id}]")
                m.Add(over >= sum(worked_day.values()) - t.maxDays)
                T["preferences"].append((over, 3))
            for (pid, d, s) in {tuple(a) for a in t.avoid}:
                for v in self.teacher_occ.get((t.id, pid, d, s), []):
                    T["preferences"].append((v, 1))

        # distribuição das disciplinas na semana
        for a in p.assignments:
            xa = self.x[a.id]
            if a.lessons == 0 or not xa:
                continue
            days_av = len({d for (d, _) in xa})
            target = math.ceil(a.lessons / max(1, days_av))
            if a.double == "preferir":
                target = max(target, 2)
            for d in range(D):
                day = {s: v for (dd, s), v in xa.items() if dd == d}
                if not day:
                    continue
                if len(day) > target:
                    ex = m.NewIntVar(0, len(day), f"exdist[{a.id},{d}]")
                    m.Add(ex >= sum(day.values()) - target)
                    T["distribution"].append(ex)
                if target <= 2:
                    for s, v in day.items():
                        if s + 1 in day and s + 2 in day:
                            tri = m.NewBoolVar(f"tri[{a.id},{d},{s}]")
                            m.Add(tri >= v + day[s + 1] + day[s + 2] - 2)
                            T["triple"].append(tri)
                if a.double == "preferir":
                    pairs = {}
                    for s, v in day.items():
                        if s + 1 in day:
                            pr = m.NewBoolVar(f"pair[{a.id},{d},{s}]")
                            m.AddImplication(pr, v)
                            m.AddImplication(pr, day[s + 1])
                            pairs[s] = pr
                            if s - 1 in pairs:
                                m.Add(pairs[s - 1] + pr <= 1)
                    T["double"] += [(-1, pr) for pr in pairs.values()]

        # horários livres das turmas (início ou fim do dia)
        for c in p.classes:
            if c.freePosition == "qualquer":
                continue
            n = self.nslots[c.periodId]
            for d in range(D):
                occ = [self.class_occ.get((c.id, d, s), []) for s in range(n)]
                if not any(occ):
                    continue
                chain = [m.NewBoolVar(f"ch[{c.id},{d},{s}]") for s in range(n)]
                for s in range(n):
                    for v in occ[s]:
                        m.AddImplication(v, chain[s])
                    if c.freePosition == "fim" and s < n - 1:
                        m.AddImplication(chain[s + 1], chain[s])
                    if c.freePosition == "inicio" and s > 0:
                        m.AddImplication(chain[s - 1], chain[s])
                for s in range(n):
                    h = m.NewBoolVar(f"hole[{c.id},{d},{s}]")
                    m.Add(h >= chain[s] - sum(occ[s]))
                    T["holes"].append(h)

        obj = []
        for name, items in T.items():
            weight = getattr(w, name)
            if weight == 0:
                continue
            for it in items:
                if isinstance(it, tuple):
                    a, b = it
                    if isinstance(a, int):  # (-1, var) bonificação
                        obj.append(a * weight * b)
                    else:
                        obj.append(weight * b * a)
                else:
                    obj.append(weight * it)
        if obj:
            m.Minimize(sum(obj))

    # ---------------------------------------------------------- utilidades
    def penalty_breakdown(self, solver: cp_model.CpSolver) -> dict[str, int]:
        out = {}
        for name, items in self.terms.items():
            total = 0
            for it in items:
                if isinstance(it, tuple):
                    a, b = it
                    total += solver.Value(b) if isinstance(a, int) else solver.Value(a)
                else:
                    total += solver.Value(it)
            out[name] = int(total)
        return out

    def extract(self, solver: cp_model.CpSolver) -> list[dict]:
        entries = []
        for a in self.p.assignments:
            pid = self.classes[a.classId].periodId
            for (d, s), v in self.x[a.id].items():
                if solver.Value(v):
                    entries.append({"kind": "aula", "refId": a.id, "periodId": pid, "day": d, "slot": s})
        for r in self.p.activities:
            for (d, s), v in self.y.get(r.id, {}).items():
                if solver.Value(v):
                    entries.append({"kind": "atividade", "refId": r.id, "periodId": r.periodId,
                                    "day": d, "slot": s})
        return entries

    def add_hint(self, entries: list[dict]):
        on = {(e["kind"], e["refId"], e["day"], e["slot"]) for e in entries}
        for aid, vs in self.x.items():
            for (d, s), v in vs.items():
                self.m.AddHint(v, 1 if ("aula", aid, d, s) in on else 0)
        for rid, vs in self.y.items():
            for (d, s), v in vs.items():
                self.m.AddHint(v, 1 if ("atividade", rid, d, s) in on else 0)


STATUS = {
    cp_model.OPTIMAL: "otima",
    cp_model.FEASIBLE: "viavel",
    cp_model.INFEASIBLE: "inviavel",
    cp_model.MODEL_INVALID: "modelo_invalido",
    cp_model.UNKNOWN: "sem_solucao_no_tempo",
}


class _StopCallback(cp_model.CpSolverSolutionCallback):
    def __init__(self, should_stop):
        super().__init__()
        self.should_stop = should_stop

    def on_solution_callback(self):
        if self.should_stop():
            self.StopSearch()


def solve_strategy(problem: ProblemIn, strategy: str, weights: Weights, time_limit: float,
                   workers: int, seed: int = 0, hint: Optional[list[dict]] = None,
                   should_stop=None) -> dict:
    t0 = time.time()
    b = ModelBuilder(problem, weights, mode="solve")
    if hint:
        b.add_hint(hint)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = workers
    solver.parameters.random_seed = seed
    cb = _StopCallback(should_stop) if should_stop else None
    status = solver.Solve(b.m, cb) if cb else solver.Solve(b.m)
    res = {
        "strategy": strategy,
        "label": STRATEGY_LABELS.get(strategy, strategy),
        "status": STATUS.get(status, str(status)),
        "wallTime": round(time.time() - t0, 2),
        "weights": weights.model_dump(),
        "entries": [],
    }
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        res["entries"] = b.extract(solver)
        res["objective"] = solver.ObjectiveValue()
        res["bound"] = solver.BestObjectiveBound()
        res["penalties"] = b.penalty_breakdown(solver)
    return res


GROUP_COST = {"fixada": 1, "atividade": 2, "limite": 2, "entrada": 3, "turma": 3,
              "indisponibilidade": 4, "dias": 5}


def _is_infeasible(problem: ProblemIn, disabled: set[str], time_limit: float) -> Optional[bool]:
    """True = comprovadamente impossível; False = possível; None = não concluído."""
    b = ModelBuilder(problem, mode="check", disabled_groups=disabled)
    s = cp_model.CpSolver()
    s.parameters.num_search_workers = 8
    s.parameters.max_time_in_seconds = time_limit
    st = s.Solve(b.m)
    if st == cp_model.INFEASIBLE:
        return True
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return False
    return None


def diagnose(problem: ProblemIn, time_budget: float = 60.0) -> dict:
    """Explica por que não existe grade.

    * ``core``: conjunto de grupos de restrições que, juntos, já tornam a
      montagem impossível (eliminação em blocos, estilo QuickXplain);
    * ``relax``: menor conjunto (pelo custo) de grupos que, se flexibilizados,
      tornam a montagem possível;
    * ``unplaced``: aulas que não cabem mesmo na melhor alocação possível.
    """
    t0 = time.time()
    out: dict = {"core": [], "relax": [], "unplaced": [], "structural": False, "complete": True}
    deadline = t0 + time_budget

    def left():
        return max(1.0, deadline - time.time())

    probe = ModelBuilder(problem, mode="diagnose")
    groups = probe.groups
    all_keys = list(groups)

    # 1) correção mínima (máximo de grupos mantidos)
    probe.m.Maximize(sum(GROUP_COST.get(groups[k].kind, 2) * probe.lits[k] for k in all_keys)
                     if all_keys else 0)
    s = cp_model.CpSolver()
    s.parameters.num_search_workers = 8
    s.parameters.max_time_in_seconds = min(left() * 0.3, 30)
    st = s.Solve(probe.m)
    relax_keys: list[str] = []
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        relax_keys = [k for k in all_keys if not s.Value(probe.lits[k])]
        out["relaxOptimal"] = st == cp_model.OPTIMAL
    elif st == cp_model.INFEASIBLE:
        out["structural"] = True  # impossível mesmo sem nenhuma restrição configurável
    out["relax"] = [vars(groups[k]) for k in relax_keys]

    # 2) núcleo de conflito por eliminação em blocos
    if not out["structural"] and all_keys:
        everything = set(all_keys)
        rk = set(relax_keys)
        cand = [k for k in all_keys if k not in rk] + [k for k in all_keys if k in rk]
        necessary: list[str] = []
        chunk = max(1, len(cand) // 2)
        while cand:
            if time.time() > deadline - 5:
                out["complete"] = False
                necessary += cand
                break
            part, rest = cand[:chunk], cand[chunk:]
            enabled = set(necessary) | set(rest)
            res = _is_infeasible(problem, everything - enabled, min(10.0, left() / 3))
            if res:
                cand = rest
                chunk = max(1, min(chunk, len(cand) // 2 or 1))
            elif chunk > 1:
                chunk = max(1, chunk // 2)
            else:
                necessary.append(part[0])
                cand = rest
                chunk = max(1, len(cand) // 2)
        out["core"] = [vars(groups[k]) for k in necessary]
    elif not all_keys:
        out["structural"] = True

    # 3) melhor alocação possível (aulas que não cabem)
    rb = ModelBuilder(problem, mode="check", relax_lessons=True)
    if rb.unplaced:
        rb.m.Minimize(sum(rb.unplaced.values()))
        rs = cp_model.CpSolver()
        rs.parameters.num_search_workers = 8
        rs.parameters.max_time_in_seconds = left()
        st2 = rs.Solve(rb.m)
        if st2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for aid, u in rb.unplaced.items():
                val = rs.Value(u)
                if val > 0:
                    out["unplaced"].append({"assignmentId": aid, "missing": int(val)})
            out["unplacedOptimal"] = st2 == cp_model.OPTIMAL
        else:
            out["unplacedStatus"] = STATUS.get(st2, str(st2))
    out["wallTime"] = round(time.time() - t0, 2)
    return out
