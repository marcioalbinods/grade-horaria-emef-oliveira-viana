"""Testes automatizados do motor de montagem (dados fictícios)."""
from __future__ import annotations

import pytest

from app.precheck import precheck
from app.schemas import ProblemIn
from app.solver import STRATEGY_WEIGHTS, diagnose, solve_strategy

from .fixtures import SchoolBuilder, full_school
from .validator import teacher_gaps, validate


def solve(pdict, strategy="equilibrada", tl=20):
    prob = ProblemIn.model_validate(pdict)
    assert precheck(prob) == [], [i.message for i in precheck(prob)]
    return solve_strategy(prob, strategy, STRATEGY_WEIGHTS[strategy], tl, 8)


def assert_valid(pdict, res):
    assert res["status"] in ("otima", "viavel"), res["status"]
    errs = validate(pdict, res["entries"])
    assert errs == [], errs[:10]


def small():
    """Uma turma de 40 (manhã), uma de 30 (tarde), 27 e 24."""
    b = SchoolBuilder()
    b.cls("C40", "1º A", "M", 40)
    b.cls("C27", "4º A", "M", 27)
    b.cls("C30", "6º A", "T", 30)
    b.cls("C24", "4º B", "T", 24)
    b.teacher("RM", "Regente manhã", ["M"])            # somente manhã
    b.teacher("RM2", "Regente 4º manhã", ["M"])
    b.teacher("RT", "Regente tarde", ["T"])             # somente tarde
    b.teacher("RT2", "Professor tarde 2", ["T"])
    b.teacher("ED", "Ed. Física (manhã e tarde)", ["M", "T"])  # dois períodos
    b.assign("C40", "RM", "POL", 37)
    b.assign("C40", "ED", "EF", 3, maxPerDay=1)
    b.assign("C27", "RM2", "POL", 24)
    b.assign("C27", "ED", "EF", 3, maxPerDay=1)
    b.assign("C30", "RT", "POR", 15, maxPerDay=3)
    b.assign("C30", "RT2", "MAT", 12, maxPerDay=3)
    b.assign("C30", "ED", "EF", 3, maxPerDay=1)
    b.assign("C24", "RT2", "CIE", 14)
    b.assign("C24", "ED", "EF", 3, maxPerDay=1)
    b.assign("C24", "RT", "HIS", 7)
    return b


# ---------------------------------------------------------------- básicos
def test_small_school_valid_and_counts():
    p = small().build()
    res = solve(p)
    assert_valid(p, res)
    # quantidade efetivamente cadastrada: 27 e 24 aulas, sem preencher lacunas
    per_class = {}
    cls_of = {a["id"]: a["classId"] for a in p["assignments"]}
    for e in res["entries"]:
        per_class[cls_of[e["refId"]]] = per_class.get(cls_of[e["refId"]], 0) + 1
    assert per_class == {"C40": 40, "C27": 27, "C30": 30, "C24": 24}


@pytest.mark.parametrize("strategy", list(STRATEGY_WEIGHTS))
def test_all_strategies_produce_valid_grades(strategy):
    p = small().build()
    res = solve(p, strategy, tl=10)
    assert_valid(p, res)


def test_teacher_only_morning_never_in_afternoon():
    p = small().build()
    res = solve(p)
    a_t = {a["id"]: a["teacherId"] for a in p["assignments"]}
    for e in res["entries"]:
        if a_t[e["refId"]] in ("RM", "RM2"):
            assert e["periodId"] == "M"
        if a_t[e["refId"]] in ("RT", "RT2"):
            assert e["periodId"] == "T"


def test_unavailability_and_workdays_respected():
    b = small()
    t = b.p["teachers"][4]  # ED
    t["workDays"] = [0, 1, 2, 3]
    t["unavailable"] = [["M", 0, 0], ["M", 0, 1], ["T", 1, 5]]
    t["entry"] = {"T": 1}
    p = b.build()
    res = solve(p)
    assert_valid(p, res)
    for e in res["entries"]:
        a = next(a for a in p["assignments"] if a["id"] == e["refId"])
        if a["teacherId"] == "ED":
            assert e["day"] != 4
            assert not (e["periodId"] == "T" and e["slot"] == 0)


def test_cross_period_clock_overlap_blocks_double_booking():
    """Se os horários da tarde se sobrepõem aos da manhã, o professor dos dois
    períodos não pode estar nos dois ao mesmo tempo."""
    b = SchoolBuilder()
    b.p["periods"][1]["slots"] = [dict(s) for s in b.p["periods"][0]["slots"][:6]]  # mesmos horários
    b.cls("A", "Turma manhã", "M", 8)
    b.cls("B", "Turma tarde", "T", 6)
    b.teacher("X", "Prof X", ["M", "T"], work_days=[0])
    b.assign("A", "X", "MAT", 4)
    b.assign("B", "X", "MAT", 4)
    b.p["days"] = ["Segunda"]
    p = b.build()
    res = solve(p)
    assert_valid(p, res)
    m = {e["slot"] for e in res["entries"] if e["periodId"] == "M"}
    t = {e["slot"] for e in res["entries"] if e["periodId"] == "T"}
    assert not (m & t)


def test_locks_are_respected():
    b = small()
    p = b.build()
    aid = p["assignments"][2]["id"]  # EF da 4º manhã
    p["locks"] = [{"kind": "aula", "refId": aid, "periodId": "M", "day": 2, "slot": 6}]
    res = solve(p)
    assert_valid(p, res)


# ------------------------------------------------- H.A., CCH e HL
@pytest.mark.parametrize("position", ["inicio_periodo", "fim_periodo", "inicio_ou_fim_periodo",
                                      "inicio_jornada", "fim_jornada", "inicio_ou_fim_jornada", "meio"])
def test_activity_positions(position):
    b = small()
    b.activity("HL1", "RT", "HL", "T", 3, position=position, maxPerDay=1)
    b.activity("HA1", "RT2", "HA", "T", 2, days=[0, 2], slots=[2, 3, 4])
    b.activity("CCH1", "RT", "CCH", "T", 1, days=[4])
    b.activity("HA2", "ED", "HA", "M", 2, mode="fixo", fixed=[[1, 0], [1, 1]])
    p = b.build()
    res = solve(p)
    assert_valid(p, res)
    acts = [e for e in res["entries"] if e["kind"] == "atividade"]
    assert len(acts) == 3 + 2 + 1 + 2
    hl = [e for e in acts if e["refId"] == "HL1"]
    if position in ("inicio_periodo", "fim_periodo", "inicio_ou_fim_periodo"):
        for e in hl:
            ok = {"inicio_periodo": [0], "fim_periodo": [5], "inicio_ou_fim_periodo": [0, 5]}[position]
            assert e["slot"] in ok


def test_hl_never_in_middle_with_multi_unit_block():
    b = small()
    b.activity("HL1", "RT2", "HL", "T", 4, position="inicio_ou_fim_periodo", maxPerDay=2)
    p = b.build()
    res = solve(p)
    assert_valid(p, res)


def test_cch_occupying_class_free_slot():
    b = small()
    # 4º B tem 24 aulas em 30 horários: a CCH pode usar horários livres da turma
    b.activity("CCH1", "RT", "CCH", "T", 2, classId="C24")
    p = b.build()
    res = solve(p)
    assert_valid(p, res)
    cls = [(e["day"], e["slot"]) for e in res["entries"] if e["kind"] == "aula"
           and next(a for a in p["assignments"] if a["id"] == e["refId"])["classId"] == "C24"]
    cch = [(e["day"], e["slot"]) for e in res["entries"] if e["refId"] == "CCH1"]
    assert not set(cls) & set(cch)


def test_limits_hard():
    b = small()
    b.p["teachers"][2]["maxDaily"] = {"value": 5, "hard": True}  # RT: 22 aulas
    b.p["teachers"][2]["maxConsecutive"] = {"value": 3, "hard": True}
    p = b.build()
    res = solve(p)
    assert_valid(p, res)


def test_limits_make_problem_infeasible_and_core_points_to_them():
    """Com no máximo 2 aulas seguidas em 6 horários, cabem só 4 aulas/dia (20 < 22)."""
    b = small()
    b.p["teachers"][2]["maxConsecutive"] = {"value": 2, "hard": True}
    prob = ProblemIn.model_validate(b.build())
    res = solve_strategy(prob, "equilibrada", STRATEGY_WEIGHTS["equilibrada"], 10, 8)
    assert res["status"] == "inviavel"
    diag = diagnose(prob, 30)
    assert "tconsec:RT" in {g["key"] for g in diag["core"]}


# ------------------------------------------------------ escola completa
def test_full_fictitious_school():
    p = full_school()
    res = solve(p, "equilibrada", tl=60)
    assert_valid(p, res)
    total_lessons = sum(a["lessons"] for a in p["assignments"])
    assert sum(1 for e in res["entries"] if e["kind"] == "aula") == total_lessons


def test_janelas_strategy_reduces_gaps_vs_distribution():
    p = small().build()
    r1 = solve(p, "janelas", tl=10)
    assert_valid(p, r1)
    assert teacher_gaps(p, r1["entries"]) <= 2


# ------------------------------------------------------- sem solução
def test_precheck_detects_math_incompatibility():
    b = small()
    b.p["assignments"][0]["lessons"] = 41  # 41 aulas numa turma de 40 horários
    prob = ProblemIn.model_validate(b.build())
    issues = precheck(prob)
    cats = {i.category for i in issues}
    assert "matematica" in cats or "cadastro" in cats


def test_precheck_teacher_wrong_period():
    b = small()
    b.p["teachers"][0]["periodIds"] = ["T"]
    issues = precheck(ProblemIn.model_validate(b.build()))
    assert any(i.category == "cadastro" and "não trabalha nesse período" in i.message for i in issues)


def test_infeasible_core_identifies_conflicting_restrictions():
    """Dois professores com indisponibilidades que, juntas, tornam a turma impossível."""
    b = SchoolBuilder()
    b.p["days"] = ["Segunda", "Terça"]
    b.cls("A", "Turma A", "T", 12)
    b.teacher("P1", "Prof. Um", ["T"])
    b.teacher("P2", "Prof. Dois", ["T"])
    b.assign("A", "P1", "MAT", 6)
    b.assign("A", "P2", "POR", 6)
    # cada um sozinho cabe, mas ambos ficam indisponíveis na segunda aula de segunda
    b.p["teachers"][0]["unavailable"] = [["T", 0, 1]]
    b.p["teachers"][1]["unavailable"] = [["T", 0, 1]]
    p = b.build()
    prob = ProblemIn.model_validate(p)
    assert precheck(prob) == []
    res = solve_strategy(prob, "equilibrada", STRATEGY_WEIGHTS["equilibrada"], 10, 8)
    assert res["status"] == "inviavel"
    assert res["entries"] == []
    diag = diagnose(prob, 20)
    keys = {g["key"] for g in diag["core"]}
    assert keys == {"tunav:P1", "tunav:P2"}
    assert sum(u["missing"] for u in diag["unplaced"]) == 1


def test_infeasible_hl_rule():
    b = SchoolBuilder()
    b.p["days"] = ["Segunda"]
    b.cls("A", "A", "T", 6)
    b.cls("B", "B", "T", 6)
    b.teacher("P", "Prof", ["T"])
    b.teacher("Q", "Prof Q", ["T"])
    b.assign("A", "P", "MAT", 3)
    b.assign("A", "Q", "POR", 3)
    b.assign("B", "P", "MAT", 3)
    b.assign("B", "Q", "POR", 3)
    # P já ocupa os 6 horários; HL obrigatória no início não cabe
    b.activity("HLP", "P", "HL", "T", 1, position="inicio_periodo")
    p = b.build()
    prob = ProblemIn.model_validate(p)
    issues = precheck(prob)
    assert any(i.category == "matematica" for i in issues)


def test_infeasible_lock_conflict_diagnosed():
    b = small()
    p = b.build()
    a_ed = p["assignments"][1]["id"]  # EF 1º A (ED)
    a_ed2 = p["assignments"][3]["id"]  # EF 4º A (ED)
    p["locks"] = [
        {"kind": "aula", "refId": a_ed, "periodId": "M", "day": 0, "slot": 0},
        {"kind": "aula", "refId": a_ed2, "periodId": "M", "day": 0, "slot": 0},
    ]
    prob = ProblemIn.model_validate(p)
    res = solve_strategy(prob, "equilibrada", STRATEGY_WEIGHTS["equilibrada"], 10, 8)
    assert res["status"] == "inviavel"
    diag = diagnose(prob, 20)
    assert {g["key"] for g in diag["core"]} == {"lock:0", "lock:1"}


def test_soft_limits_do_not_block():
    b = small()
    b.p["teachers"][0]["maxDaily"] = {"value": 2, "hard": False}  # impossível como obrigatório
    p = b.build()
    res = solve(p, tl=10)
    assert_valid(p, res)
