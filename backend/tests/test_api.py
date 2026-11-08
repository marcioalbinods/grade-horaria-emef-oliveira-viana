"""Testes da API HTTP e teste integrado com dados gerados pelo frontend."""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

from .fixtures import SchoolBuilder
from .test_solver import small
from .validator import validate

client = TestClient(app)
DEMO = Path(__file__).parent / "data" / "demo_problem.json"


def wait(job_id, timeout=600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = client.get(f"/api/jobs/{job_id}").json()
        if r["state"] != "running":
            return r
        time.sleep(0.5)
    raise TimeoutError


def test_health():
    r = client.get("/api/health").json()
    assert r["ok"] and r["solver"] == "CP-SAT"
    assert "jeif" in r["features"]


def test_solve_job_multiple_strategies():
    p = small().build()
    p["options"] = {"strategies": ["janelas", "dias", "distribuicao", "equilibrada"], "timeLimit": 5}
    job = wait(client.post("/api/solve", json=p).json()["jobId"])
    assert job["state"] == "done" and job["outcome"] == "ok"
    assert len(job["results"]) == 4
    for res in job["results"]:
        assert validate(p, res["entries"]) == []


def test_precheck_outcome_blocks_solving():
    b = small()
    b.p["teachers"][0]["periodIds"] = ["T"]
    p = b.build()
    job = wait(client.post("/api/solve", json=p).json()["jobId"])
    assert job["outcome"] == "precheck"
    assert any(i["category"] == "cadastro" for i in job["issues"])
    assert "results" not in job


def test_infeasible_returns_diagnosis_and_no_grade():
    b = SchoolBuilder()
    b.p["days"] = ["Segunda", "Terça"]
    b.cls("A", "Turma A", "T", 12)
    b.teacher("P1", "Prof. Um", ["T"], unavailable=[["T", 0, 1]])
    b.teacher("P2", "Prof. Dois", ["T"], unavailable=[["T", 0, 1]])
    b.assign("A", "P1", "MAT", 6)
    b.assign("A", "P2", "POR", 6)
    p = b.build()
    p["options"] = {"strategies": ["equilibrada"], "timeLimit": 5}
    job = wait(client.post("/api/solve", json=p).json()["jobId"])
    assert job["outcome"] == "infeasible"
    assert all(not r["entries"] for r in job["results"])
    keys = {g["key"] for g in job["diagnosis"]["core"]}
    assert keys == {"tunav:P1", "tunav:P2"}


def test_invalid_payload_rejected():
    r = client.post("/api/solve", json={"days": []})
    assert r.status_code == 422


def test_cancel():
    p = json.loads(DEMO.read_text()) if DEMO.exists() else small().build()
    p["options"] = {"strategies": ["equilibrada"], "timeLimit": 120}
    jid = client.post("/api/solve", json=p).json()["jobId"]
    time.sleep(3)
    assert client.post(f"/api/jobs/{jid}/cancel").json()["ok"]
    job = wait(jid, 60)
    assert job["state"] == "done"


@pytest.mark.skipif(not DEMO.exists(), reason="rode 'npm test' no frontend para gerar o arquivo")
def test_demo_from_frontend_is_solved_without_conflicts():
    p = json.loads(DEMO.read_text())
    p["options"] = {"strategies": ["janelas"], "timeLimit": 45}
    job = wait(client.post("/api/solve", json=p).json()["jobId"])
    assert job["outcome"] == "ok", job.get("diagnosis")
    entries = job["results"][0]["entries"]
    assert validate(p, entries) == []
    assert sum(1 for e in entries if e["kind"] == "aula") == sum(a["lessons"] for a in p["assignments"])
