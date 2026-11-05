"""Validador independente de grades.

Não usa nenhum código do solver: recebe o problema (dict no mesmo formato da
API) e a lista de entradas, e verifica matematicamente todas as restrições
obrigatórias. Retorna a lista de violações (vazia = grade válida).
"""
from __future__ import annotations

from collections import Counter, defaultdict


def _min(h):
    if not h:
        return None
    a, b = h.split(":")
    return int(a) * 60 + int(b)


def validate(problem: dict, entries: list[dict]) -> list[str]:
    errs: list[str] = []
    D = len(problem["days"])
    periods = {p["id"]: p for p in problem["periods"]}
    nslots = {pid: len(p["slots"]) for pid, p in periods.items()}
    classes = {c["id"]: c for c in problem["classes"]}
    teachers = {t["id"]: t for t in problem["teachers"]}
    assigns = {a["id"]: a for a in problem["assignments"]}
    acts = {r["id"]: r for r in problem.get("activities", [])}

    class_occ = Counter()
    teacher_occ = defaultdict(list)  # (t, p, d, s) -> entries
    a_count = Counter()
    r_count = Counter()
    les_day_teacher = Counter()
    les_slot_teacher = set()
    a_day = Counter()
    r_day = Counter()
    class_day = Counter()
    act_slots = defaultdict(set)  # (rid, d) -> slots

    for e in entries:
        d, s, pid = e["day"], e["slot"], e["periodId"]
        if not (0 <= d < D) or pid not in nslots or not (0 <= s < nslots[pid]):
            errs.append(f"entrada fora da grade: {e}")
            continue
        if e["kind"] == "aula":
            a = assigns.get(e["refId"])
            if a is None:
                errs.append(f"aula de atribuição inexistente {e}")
                continue
            c = classes[a["classId"]]
            t = teachers[a["teacherId"]]
            if c["periodId"] != pid:
                errs.append(f"aula fora do período da turma {c['name']}")
            if [d, s] in [list(b) for b in c.get("blocked", [])]:
                errs.append(f"aula em horário bloqueado da turma {c['name']} ({d},{s})")
            class_occ[(c["id"], d, s)] += 1
            class_day[(c["id"], d)] += 1
            a_count[a["id"]] += 1
            a_day[(a["id"], d)] += 1
            les_day_teacher[(t["id"], d)] += 1
            les_slot_teacher.add((t["id"], pid, d, s))
        else:
            r = acts.get(e["refId"])
            if r is None:
                errs.append(f"atividade inexistente {e}")
                continue
            t = teachers[r["teacherId"]]
            if r["periodId"] != pid:
                errs.append(f"atividade {r['label']} fora do seu período")
            r_count[r["id"]] += 1
            r_day[(r["id"], d)] += 1
            act_slots[(r["id"], d)].add(s)
            if r.get("classId"):
                class_occ[(r["classId"], d, s)] += 1
            if r.get("mode") == "fixo":
                if [d, s] not in [list(f) for f in r.get("fixed", [])]:
                    errs.append(f"atividade fixa {r['label']} fora do horário fixo")
            else:
                if r.get("days") and d not in r["days"]:
                    errs.append(f"atividade {r['label']} em dia não permitido")
                if r.get("slots") and s not in r["slots"]:
                    errs.append(f"atividade {r['label']} em aula não permitida")
                if r.get("position") == "meio" and s in (0, nslots[pid] - 1):
                    errs.append(f"atividade {r['label']} deveria estar no meio do período")
        # disponibilidade do professor
        if pid not in t["periodIds"]:
            errs.append(f"{t['name']} alocado em período em que não trabalha")
        if d not in t["workDays"]:
            errs.append(f"{t['name']} alocado em dia em que não trabalha ({d})")
        if [pid, d, s] in [list(u) for u in t.get("unavailable", [])]:
            errs.append(f"{t['name']} alocado em horário indisponível ({pid},{d},{s})")
        lo = t.get("entry", {}).get(pid)
        hi = t.get("exit", {}).get(pid)
        if (lo is not None and s < lo) or (hi is not None and s > hi):
            errs.append(f"{t['name']} alocado fora do horário de entrada/saída")
        teacher_occ[(t["id"], pid, d, s)].append(e)

    for k, v in class_occ.items():
        if v > 1:
            errs.append(f"turma {k[0]} com {v} ocupações no dia {k[1]}, aula {k[2]}")
    for k, v in teacher_occ.items():
        if len(v) > 1:
            errs.append(f"professor {k[0]} com {len(v)} ocupações em {k[1:]}")
    # sobreposição entre períodos (relógio)
    plist = problem["periods"]
    for i, p1 in enumerate(plist):
        for p2 in plist[i + 1:]:
            for s1, a in enumerate(p1["slots"]):
                for s2, b in enumerate(p2["slots"]):
                    a0, a1, b0, b1 = _min(a.get("start")), _min(a.get("end")), _min(b.get("start")), _min(b.get("end"))
                    if None in (a0, a1, b0, b1) or not (a0 < b1 and b0 < a1):
                        continue
                    for t in teachers:
                        for d in range(D):
                            if (t, p1["id"], d, s1) in teacher_occ and (t, p2["id"], d, s2) in teacher_occ:
                                errs.append(f"{t} em dois períodos sobrepostos no dia {d}")
    for a in assigns.values():
        if a_count[a["id"]] != a["lessons"]:
            errs.append(f"atribuição {a['id']}: {a_count[a['id']]} de {a['lessons']} aulas")
        if a.get("maxPerDay") is not None:
            for d in range(D):
                if a_day[(a["id"], d)] > a["maxPerDay"]:
                    errs.append(f"atribuição {a['id']} excede máximo diário")
    for r in acts.values():
        if r_count[r["id"]] != r["qty"]:
            errs.append(f"atividade {r['id']}: {r_count[r['id']]} de {r['qty']}")
        if r.get("maxPerDay") is not None:
            for d in range(D):
                if r_day[(r["id"], d)] > r["maxPerDay"]:
                    errs.append(f"atividade {r['id']} excede máximo diário")
        n = nslots[r["periodId"]]
        pos = r.get("position", "qualquer")
        for d in range(D):
            sl = act_slots.get((r["id"], d))
            if not sl:
                continue
            block_start = sl == set(range(len(sl)))
            block_end = sl == set(range(n - len(sl), n))
            occ_other = {s for s in range(n)
                         if any(not (x["kind"] == "atividade" and x["refId"] == r["id"])
                                for x in teacher_occ.get((r["teacherId"], r["periodId"], d, s), []))}
            j_start = all(o > max(sl) for o in occ_other)
            j_end = all(o < min(sl) for o in occ_other)
            ok = {
                "inicio_periodo": block_start, "fim_periodo": block_end,
                "inicio_ou_fim_periodo": block_start or block_end,
                "inicio_jornada": j_start, "fim_jornada": j_end,
                "inicio_ou_fim_jornada": j_start or j_end,
            }.get(pos, True)
            if not ok:
                errs.append(f"atividade {r['label']} viola a posição '{pos}' no dia {d}: {sorted(sl)}")
    for c in classes.values():
        if c.get("dailyMax") is not None:
            for d in range(D):
                if class_day[(c["id"], d)] > c["dailyMax"]:
                    errs.append(f"turma {c['name']} excede limite diário")
    for t in teachers.values():
        md = t.get("maxDaily")
        if md and md.get("hard", True):
            for d in range(D):
                if les_day_teacher[(t["id"], d)] > md["value"]:
                    errs.append(f"{t['name']} excede limite diário obrigatório")
        mc = t.get("maxConsecutive")
        if mc and mc.get("hard", True):
            k = mc["value"]
            for pid in t["periodIds"]:
                for d in range(D):
                    run = 0
                    for s in range(nslots[pid]):
                        run = run + 1 if (t["id"], pid, d, s) in les_slot_teacher else 0
                        if run > k:
                            errs.append(f"{t['name']} excede {k} aulas consecutivas")
                            break
    for lk in problem.get("locks", []):
        if not any(e["kind"] == lk["kind"] and e["refId"] == lk["refId"] and e["day"] == lk["day"]
                   and e["slot"] == lk["slot"] for e in entries):
            errs.append(f"aula fixada não respeitada: {lk}")
    return errs


def teacher_gaps(problem: dict, entries: list[dict]) -> int:
    nslots = {p["id"]: len(p["slots"]) for p in problem["periods"]}
    assigns = {a["id"]: a for a in problem["assignments"]}
    acts = {r["id"]: r for r in problem.get("activities", [])}
    occ = defaultdict(set)
    for e in entries:
        tid = assigns[e["refId"]]["teacherId"] if e["kind"] == "aula" else acts[e["refId"]]["teacherId"]
        occ[(tid, e["periodId"], e["day"])].add(e["slot"])
    gaps = 0
    for (tid, pid, d), sl in occ.items():
        gaps += (max(sl) - min(sl) + 1) - len(sl)
    return gaps
