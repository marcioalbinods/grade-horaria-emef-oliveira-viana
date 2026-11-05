"""Verificações feitas antes da otimização.

Detectam erros de cadastro e incompatibilidades matemáticas evidentes, para que
o usuário receba mensagens claras em vez de apenas "não há solução".
"""
from __future__ import annotations

from .schemas import Issue, ProblemIn


def precheck(p: ProblemIn) -> list[Issue]:
    issues: list[Issue] = []
    D = len(p.days)
    periods = {x.id: x for x in p.periods}
    classes = {c.id: c for c in p.classes}
    teachers = {t.id: t for t in p.teachers}

    def add(cat, msg, sug=None, refs=None):
        issues.append(Issue(category=cat, message=msg, suggestion=sug, refs=refs or []))

    if D == 0:
        add("cadastro", "Nenhum dia letivo configurado.", "Configure os dias letivos da escola.")
    for per in p.periods:
        if not per.slots:
            add("cadastro", f"O período {per.name} não possui aulas configuradas.",
                "Informe a quantidade de aulas diárias do período.", [per.id])

    # ---- integridade de referências
    for c in p.classes:
        if c.periodId not in periods:
            add("cadastro", f"A turma {c.name} está vinculada a um período inexistente.",
                "Edite a turma e selecione o período.", [c.id])
    for t in p.teachers:
        for pid in t.periodIds:
            if pid not in periods:
                add("cadastro", f"{t.name} está vinculado a um período inexistente.", None, [t.id])
        if not t.periodIds:
            add("cadastro", f"{t.name} não possui período de trabalho.",
                "Informe em qual período o professor trabalha.", [t.id])
        if not t.workDays:
            add("cadastro", f"{t.name} não possui dias de trabalho.",
                "Informe os dias da semana em que o professor trabalha.", [t.id])
    valid_assign = []
    for a in p.assignments:
        c = classes.get(a.classId)
        t = teachers.get(a.teacherId)
        if c is None or t is None:
            add("cadastro", f"Atribuição {a.id} referencia turma ou professor inexistente.", None, [a.id])
            continue
        if c.periodId not in t.periodIds:
            per = periods.get(c.periodId)
            add("cadastro",
                f"{t.name} tem aulas na turma {c.name} ({per.name if per else '?'}), "
                f"mas não trabalha nesse período.",
                f"Inclua o período {per.name if per else ''} no cadastro de {t.name} "
                "ou atribua a aula a outro professor.", [a.id, t.id, c.id])
            continue
        valid_assign.append(a)
    for r in p.activities:
        t = teachers.get(r.teacherId)
        if t is None:
            add("cadastro", f"Atividade {r.label} sem professor válido.", None, [r.id])
            continue
        if r.periodId not in t.periodIds:
            add("cadastro", f"A atividade {r.label} de {t.name} está em um período em que "
                "o professor não trabalha.", "Altere o período da atividade.", [r.id, t.id])
        if r.mode == "fixo" and len(r.fixed) != r.qty:
            add("cadastro", f"A atividade {r.label} de {t.name} é de horário fixo, mas possui "
                f"{len(r.fixed)} horário(s) marcado(s) para {r.qty} unidade(s).",
                "Marque exatamente a quantidade de horários fixos.", [r.id, t.id])
        if r.classId and r.classId in classes and classes[r.classId].periodId != r.periodId:
            add("cadastro", f"A atividade {r.label} de {t.name} está vinculada a uma turma de "
                "outro período.", "Ajuste o período ou a turma da atividade.", [r.id])
    if issues:
        return issues

    # ---- capacidade das turmas
    for c in p.classes:
        n = len(periods[c.periodId].slots)
        daily = min(n, c.dailyMax) if c.dailyMax is not None else n
        blocked = {tuple(b) for b in c.blocked}
        cap = 0
        for d in range(D):
            free = sum(1 for s in range(n) if (d, s) not in blocked)
            cap += min(daily, free)
        total = sum(a.lessons for a in valid_assign if a.classId == c.id)
        if total > c.weeklyLessons:
            add("cadastro", f"A matriz da turma {c.name} soma {total} aulas, acima das "
                f"{c.weeklyLessons} aulas semanais cadastradas.",
                "Corrija a quantidade de aulas na matriz ou a carga semanal da turma.", [c.id])
        if total > cap:
            add("matematica", f"A turma {c.name} precisa de {total} aulas, mas só há {cap} "
                "horários disponíveis na semana.",
                "Reduza aulas, libere horários bloqueados ou aumente o limite diário.", [c.id])

    # ---- capacidade dos professores
    for t in p.teachers:
        mine = [a for a in valid_assign if a.teacherId == t.id]
        acts = [r for r in p.activities if r.teacherId == t.id]
        need = sum(a.lessons for a in mine) + sum(r.qty for r in acts)
        unav = {tuple(u) for u in t.unavailable}
        avail = 0
        for pid in t.periodIds:
            n = len(periods[pid].slots)
            lo = t.entry.get(pid, 0)
            hi = t.exit.get(pid, n - 1)
            for d in t.workDays:
                if 0 <= d < D:
                    avail += sum(1 for s in range(n) if lo <= s <= hi and (pid, d, s) not in unav)
        if need > avail:
            add("matematica", f"{t.name} precisa de {need} horários (aulas + atividades na grade), "
                f"mas tem apenas {avail} horários disponíveis.",
                "Reduza atribuições ou atividades, ou amplie a disponibilidade.", [t.id])
        lessons = sum(a.lessons for a in mine)
        if t.maxDaily and t.maxDaily.hard:
            cap = t.maxDaily.value * len([d for d in t.workDays if 0 <= d < D])
            if lessons > cap:
                add("matematica", f"{t.name} tem {lessons} aulas, mas o limite obrigatório de "
                    f"{t.maxDaily.value} aulas por dia em {len(t.workDays)} dia(s) permite só {cap}.",
                    "Aumente o limite diário, os dias de trabalho, ou torne o limite uma preferência.",
                    [t.id])

    # ---- cada atribuição isoladamente
    for a in valid_assign:
        c, t = classes[a.classId], teachers[a.teacherId]
        n = len(periods[c.periodId].slots)
        blocked = {tuple(b) for b in c.blocked}
        unav = {tuple(u) for u in t.unavailable}
        lo = t.entry.get(c.periodId, 0)
        hi = t.exit.get(c.periodId, n - 1)
        per_day = []
        for d in range(D):
            k = 0
            if d in t.workDays:
                k = sum(1 for s in range(n) if lo <= s <= hi and (d, s) not in blocked
                        and (c.periodId, d, s) not in unav)
            if a.maxPerDay is not None:
                k = min(k, a.maxPerDay)
            if c.dailyMax is not None:
                k = min(k, c.dailyMax)
            per_day.append(k)
        if a.lessons > sum(per_day):
            add("matematica", f"{t.name} precisa dar {a.lessons} aulas na turma {c.name}, mas só "
                f"existem {sum(per_day)} horários compatíveis entre o professor e a turma "
                "(considerando dias, indisponibilidades, bloqueios e limites por dia).",
                "Amplie a disponibilidade do professor, libere horários da turma ou aumente o "
                "máximo de aulas por dia.", [a.id, t.id, c.id])

    # ---- atividades
    for r in p.activities:
        t = teachers[r.teacherId]
        n = len(periods[r.periodId].slots)
        if r.mode == "fixo":
            continue
        days = set(r.days) if r.days else set(range(D))
        slots = set(r.slots) if r.slots else set(range(n))
        if r.position == "meio":
            slots -= {0, n - 1}
        unav = {tuple(u) for u in t.unavailable}
        cnt = 0
        for d in days & set(t.workDays):
            k = sum(1 for s in slots if 0 <= s < n and (r.periodId, d, s) not in unav)
            if r.maxPerDay is not None:
                k = min(k, r.maxPerDay)
            cnt += k
        if r.qty > cnt:
            add("matematica", f"A atividade {r.label} de {t.name} precisa de {r.qty} horário(s), "
                f"mas suas regras só permitem {cnt}.",
                "Amplie os dias/horários permitidos ou o máximo por dia.", [r.id, t.id])

    # ---- aulas fixadas
    seen = set()
    for lk in p.locks:
        k = (lk.kind, lk.refId, lk.day, lk.slot)
        if k in seen:
            add("cadastro", "Há uma aula fixada duplicada no mesmo horário.", None, [lk.refId])
        seen.add(k)
    return issues
