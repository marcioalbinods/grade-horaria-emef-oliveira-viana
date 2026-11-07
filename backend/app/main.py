"""API do Sistema de Grade Horária.

Endpoints
---------
GET  /api/health              → estado do servidor e versão do OR-Tools
POST /api/precheck            → verificações prévias (sem otimizar)
POST /api/solve               → inicia a montagem (retorna id do processamento)
GET  /api/jobs/{id}           → andamento / resultado
POST /api/jobs/{id}/cancel    → interrompe a montagem

A interface (frontend) é servida como arquivos estáticos na raiz "/".
Nenhum dado é armazenado no servidor: os dados ficam no navegador do usuário.
"""
from __future__ import annotations

import inspect
import os
import threading
import time
import uuid
from pathlib import Path

import ortools
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .precheck import precheck
from .schemas import ProblemIn
from .solver import STRATEGY_WEIGHTS, diagnose, solve_strategy

app = FastAPI(title="Grade Horária – EMEF Oliveira Viana", version="1.0.0")
_cors = {"allow_origins": ["*"], "allow_methods": ["*"], "allow_headers": ["*"]}
if "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters:
    _cors["allow_private_network"] = True  # versões recentes do Starlette
app.add_middleware(CORSMiddleware, **_cors)


@app.middleware("http")
async def private_network_access(request, call_next):
    """Permite que a versão publicada no GitHub Pages (site público) use o motor
    rodando neste computador (rede local), conforme o padrão Private Network Access."""
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
MAX_JOBS = 20


def _cleanup():
    with LOCK:
        if len(JOBS) > MAX_JOBS:
            old = sorted(JOBS.items(), key=lambda kv: kv[1]["created"])[: len(JOBS) - MAX_JOBS]
            for k, _ in old:
                if JOBS[k]["state"] != "running":
                    del JOBS[k]


def run_job(job_id: str, problem: ProblemIn) -> None:
    job = JOBS[job_id]
    opts = problem.options
    try:
        issues = precheck(problem)
        if issues:
            job.update(state="done", outcome="precheck", issues=[i.model_dump() for i in issues])
            return
        strategies = list(dict.fromkeys(opts.strategies))
        if opts.customWeights is not None:
            strategies = ["personalizada"]
        # A solução equilibrada é calculada primeiro e serve de ponto de partida
        # (hint) para as demais; cada prioridade parte da melhor solução anterior.
        requested = list(strategies)
        if "equilibrada" in strategies:
            strategies = ["equilibrada"] + [s for s in strategies if s != "equilibrada"]
        results = []
        hint = None
        for i, st in enumerate(strategies):
            if job["cancel"]:
                break
            job["progress"] = {"current": i + 1, "total": len(strategies), "strategy": st}
            weights = opts.customWeights if st == "personalizada" else STRATEGY_WEIGHTS[st]
            res = solve_strategy(problem, st, weights, opts.timeLimit, opts.numWorkers,
                                 seed=opts.seed + i, hint=hint, should_stop=lambda: job["cancel"])
            results.append(res)
            if res["status"] == "inviavel":
                break  # todas as estratégias compartilham as mesmas restrições obrigatórias
            if res["entries"]:
                hint = res["entries"]
        order = {s: i for i, s in enumerate(requested)}
        results.sort(key=lambda r: order.get(r["strategy"], 99))
        job["results"] = results
        ok = [r for r in results if r["entries"]]
        if ok:
            job.update(state="done", outcome="ok")
            return
        if job["cancel"]:
            job.update(state="done", outcome="cancelled")
            return
        infeasible = any(r["status"] == "inviavel" for r in results)
        job["progress"] = {"current": 1, "total": 1, "strategy": "diagnostico"}
        diag = diagnose(problem, time_budget=max(20.0, min(120.0, opts.timeLimit * 2))) \
            if opts.diagnose else None
        job.update(state="done", outcome="infeasible" if infeasible else "timeout", diagnosis=diag)
    except Exception as exc:  # noqa: BLE001 - devolve o erro de forma legível
        job.update(state="error", error=f"{type(exc).__name__}: {exc}")
    finally:
        job["finished"] = time.time()


@app.get("/api/health")
def health():
    return {"ok": True, "ortools": ortools.__version__, "solver": "CP-SAT"}


@app.post("/api/precheck")
def api_precheck(problem: ProblemIn):
    return {"issues": [i.model_dump() for i in precheck(problem)]}


@app.post("/api/solve")
def api_solve(problem: ProblemIn):
    _cleanup()
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"id": job_id, "state": "running", "created": time.time(), "cancel": False,
                    "progress": {"current": 0, "total": len(problem.options.strategies)}}
    threading.Thread(target=run_job, args=(job_id, problem), daemon=True).start()
    return {"jobId": job_id}


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "Processamento não encontrado (o servidor pode ter sido reiniciado).")
    return {k: v for k, v in job.items() if k != "cancel"}


@app.post("/api/jobs/{job_id}/cancel")
def api_cancel(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "Processamento não encontrado.")
    job["cancel"] = True
    return {"ok": True}


# ---------------------------------------------------------------- frontend
DIST = Path(os.environ.get("GRADE_FRONTEND_DIR",
                           Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
