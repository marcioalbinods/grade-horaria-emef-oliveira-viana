"""Dados FICTÍCIOS para testar o motor de montagem.

Nenhum nome ou quantidade aqui corresponde a dados reais da escola: são apenas
casos de teste que reproduzem a estrutura informada (manhã com 8 aulas, tarde
com 6 aulas, turmas de 40, 30, 27 e 24 aulas semanais).
"""
from __future__ import annotations

import copy

DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]


def _slots(start_h, start_m, n, brk_after=None, brk_len=0):
    out = []
    t = start_h * 60 + start_m
    for i in range(n):
        out.append({"start": f"{t // 60:02d}:{t % 60:02d}", "end": f"{(t + 45) // 60:02d}:{(t + 45) % 60:02d}"})
        t += 45
        if brk_after is not None and i == brk_after:
            t += brk_len
    return out


def periods():
    return [
        {"id": "M", "name": "Manhã", "slots": _slots(7, 0, 8, brk_after=3, brk_len=15)},
        {"id": "T", "name": "Tarde", "slots": _slots(13, 30, 6, brk_after=2, brk_len=20)},
    ]


def teacher(tid, name, periods_, work_days=None, **kw):
    t = {"id": tid, "name": name, "periodIds": periods_,
         "workDays": list(range(5)) if work_days is None else work_days,
         "unavailable": [], "avoid": [], "entry": {}, "exit": {}}
    t.update(kw)
    return t


class SchoolBuilder:
    def __init__(self):
        self.p = {"days": DAYS, "periods": periods(), "classes": [], "teachers": [],
                  "assignments": [], "activities": [], "locks": [],
                  "options": {"strategies": ["equilibrada"], "timeLimit": 20, "numWorkers": 8}}
        self._a = 0

    def cls(self, cid, name, pid, weekly, **kw):
        c = {"id": cid, "name": name, "periodId": pid, "weeklyLessons": weekly, "blocked": []}
        c.update(kw)
        self.p["classes"].append(c)
        return cid

    def teacher(self, tid, name, periods_, **kw):
        self.p["teachers"].append(teacher(tid, name, periods_, **kw))
        return tid

    def assign(self, cid, tid, subj, n, **kw):
        self._a += 1
        a = {"id": f"a{self._a}", "classId": cid, "teacherId": tid, "subjectId": subj, "lessons": n}
        a.update(kw)
        self.p["assignments"].append(a)
        return a["id"]

    def activity(self, rid, tid, typ, pid, qty, **kw):
        r = {"id": rid, "teacherId": tid, "type": typ, "label": typ, "periodId": pid, "qty": qty}
        r.update(kw)
        self.p["activities"].append(r)
        return rid

    def build(self):
        return copy.deepcopy(self.p)


def full_school():
    """Escola fictícia completa com a estrutura informada (15 turmas manhã + 15 tarde)."""
    b = SchoolBuilder()
    morning = []
    for serie, n, weekly in [("1", 4, 40), ("2", 4, 40), ("3", 5, 40), ("4", 2, 27)]:
        for i in range(n):
            morning.append(b.cls(f"M{serie}{'ABCDE'[i]}", f"{serie}º {'ABCDE'[i]}", "M", weekly))
    afternoon = []
    for serie, n, weekly in [("1", 3, 30), ("4", 1, 24), ("5", 1, 30), ("6", 3, 30), ("7", 1, 30),
                             ("8", 3, 30), ("9", 3, 30)]:
        for i in range(n):
            afternoon.append(b.cls(f"T{serie}{'ABC'[i]}", f"{serie}º {'ABC'[i]} (T)", "T", weekly))

    # --- especialistas
    b.teacher("EF1", "Prof. EF Manhã", ["M"], maxDaily={"value": 7, "hard": True})
    b.teacher("EF2", "Prof. EF Manhã/Tarde", ["M", "T"])
    b.teacher("EF3", "Prof. EF Tarde 1", ["T"])
    b.teacher("EF4", "Prof. EF Tarde 2", ["T"], work_days=[0, 1, 2, 3])
    b.teacher("AR1", "Prof. Arte Manhã", ["M"])
    b.teacher("AR2", "Prof. Arte Tarde 1", ["T"])
    b.teacher("AR3", "Prof. Arte Tarde 2", ["T"], work_days=[1, 2, 3])
    b.teacher("IN1", "Prof. Inglês Manhã/Tarde", ["M", "T"])
    b.teacher("IN2", "Prof. Inglês Tarde 1", ["T"])
    b.teacher("IN3", "Prof. Inglês Tarde 2", ["T"])
    b.teacher("LE1", "Prof. Leitura Manhã", ["M"])
    b.teacher("LE2", "Prof. Leitura Manhã/Tarde", ["M", "T"])

    for cid in morning:
        serie = cid[1]
        full = serie != "4"
        reg = b.teacher(f"R{cid}", f"Regente {cid}", ["M"])
        b.assign(cid, reg, "POL", 30 if full else 20)
        b.assign(cid, "EF1" if serie in "12" else "EF2", "EF", 3, maxPerDay=1)
        b.assign(cid, "AR1", "ART", 2, maxPerDay=1)
        b.assign(cid, "IN1", "ING", 2)
        if full:
            b.assign(cid, "LE1" if serie in "12" else "LE2", "LEI", 3)
        b.activity(f"HA{cid}", reg, "HA", "M", 2, maxPerDay=1)

    # --- tarde: anos iniciais
    for cid in afternoon[:5]:
        serie = cid[1]
        reg = b.teacher(f"R{cid}", f"Regente {cid}", ["T"])
        base = {"1": 22, "4": 17, "5": 23}[serie]
        b.assign(cid, reg, "POL", base)
        b.assign(cid, "EF3", "EF", 3, maxPerDay=1)
        b.assign(cid, "AR2", "ART", 2)
        b.assign(cid, "IN1", "ING", 2)
        if serie == "1":
            b.assign(cid, "LE2", "LEI", 1)
        b.activity(f"HL{cid}", reg, "HL", "T", 1, position="inicio_ou_fim_periodo")

    # --- tarde: anos finais (6º ao 9º)
    finals = afternoon[5:]
    groups = {
        "POR": (6, [finals[0:3], finals[3:6], finals[6:10]]),
        "MAT": (6, [finals[0:3], finals[3:6], finals[6:10]]),
        "CIE": (4, [finals[0:5], finals[5:10]]),
        "HIS": (3, [finals[0:5], finals[5:10]]),
        "GEO": (3, [finals[0:5], finals[5:10]]),
    }
    for subj, (n, parts) in groups.items():
        for i, part in enumerate(parts):
            tid = b.teacher(f"{subj}{i + 1}", f"Prof. {subj} {i + 1}", ["T"])
            for cid in part:
                b.assign(cid, tid, subj, n, maxPerDay=2)
    for cid in finals:
        serie = cid[1]
        b.assign(cid, "EF2" if serie == "6" else ("EF4" if serie in "78" else "EF3"), "EF", 3, maxPerDay=1)
        b.assign(cid, "AR2" if serie == "6" else "AR3", "ART", 2, maxPerDay=1)
        b.assign(cid, "IN2" if serie in "678" else "IN3", "ING", 3, maxPerDay=1)
    # atividades variadas
    b.activity("HA_POR1", "POR1", "HA", "T", 3, position="qualquer", maxPerDay=1)
    b.activity("HL_MAT1", "MAT1", "HL", "T", 2, position="inicio_ou_fim_jornada")
    b.activity("CCH_CIE1", "CIE1", "CCH", "T", 2, days=[1, 3])
    b.activity("HL_IN1", "IN1", "HL", "M", 1, position="fim_periodo")
    return b.build()
