"""Esquemas de entrada e saída do motor de montagem da grade.

Os dados chegam já normalizados pela interface (frontend). Índices de dia e de
aula ("slot") começam em 0. Todo horário de um período é identificado por
(periodId, dia, aula).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Position = Literal[
    "qualquer",
    "meio",
    "inicio_periodo",
    "fim_periodo",
    "inicio_ou_fim_periodo",
    "inicio_jornada",
    "fim_jornada",
    "inicio_ou_fim_jornada",
]

Strategy = Literal[
    "janelas", "dias", "distribuicao", "aproveitamento", "preferencias", "equilibrada"
]


class SlotIn(BaseModel):
    start: Optional[str] = None  # "07:00"
    end: Optional[str] = None


class PeriodIn(BaseModel):
    id: str
    name: str
    slots: list[SlotIn]


class ClassIn(BaseModel):
    id: str
    name: str
    periodId: str
    weeklyLessons: int = Field(ge=0)
    dailyMax: Optional[int] = None  # None = todas as aulas do período
    blocked: list[tuple[int, int]] = []  # (dia, aula) sem aula regular
    freePosition: Literal["qualquer", "fim", "inicio"] = "qualquer"


class Limit(BaseModel):
    value: int = Field(ge=0)
    hard: bool = True


class TeacherIn(BaseModel):
    id: str
    name: str
    periodIds: list[str]
    workDays: list[int]  # dias em que trabalha
    unavailable: list[tuple[str, int, int]] = []  # (periodo, dia, aula) obrigatória
    avoid: list[tuple[str, int, int]] = []  # preferência: evitar
    entry: dict[str, int] = {}  # periodo -> primeira aula permitida
    exit: dict[str, int] = {}  # periodo -> última aula permitida
    maxDaily: Optional[Limit] = None
    maxConsecutive: Optional[Limit] = None
    preferredDays: list[int] = []  # preferência: concentrar nestes dias
    maxDays: Optional[int] = None  # preferência: no máximo N dias
    preferConsecutive: bool = False
    avoidGaps: bool = False


class AssignmentIn(BaseModel):
    id: str
    classId: str
    teacherId: str
    subjectId: str
    lessons: int = Field(ge=0)
    maxPerDay: Optional[int] = None  # obrigatório
    double: Literal["indiferente", "preferir"] = "indiferente"


class ActivityIn(BaseModel):
    id: str
    teacherId: str
    type: str  # HA, CCH, HL, OUTRA
    label: str
    periodId: str
    qty: int = Field(ge=0)
    days: list[int] = []  # vazio = todos os dias de trabalho
    slots: list[int] = []  # vazio = todas as aulas do período
    position: Position = "qualquer"
    mode: Literal["flexivel", "fixo"] = "flexivel"
    fixed: list[tuple[int, int]] = []
    maxPerDay: Optional[int] = None
    classId: Optional[str] = None  # ocupa também o horário livre desta turma


class LockIn(BaseModel):
    kind: Literal["aula", "atividade"]
    refId: str
    periodId: str
    day: int
    slot: int


class Weights(BaseModel):
    gap: int = 0
    days: int = 0
    shifts: int = 0
    isolated: int = 0
    distribution: int = 0
    triple: int = 0
    preferences: int = 0
    holes: int = 0
    double: int = 0
    softLimits: int = 0


class OptionsIn(BaseModel):
    strategies: list[Strategy] = ["janelas", "dias", "distribuicao", "equilibrada"]
    timeLimit: float = Field(default=30, ge=1, le=1800)
    numWorkers: int = Field(default=8, ge=1, le=32)
    seed: int = 0
    customWeights: Optional[Weights] = None
    diagnose: bool = True


class ProblemIn(BaseModel):
    days: list[str]
    periods: list[PeriodIn]
    classes: list[ClassIn]
    teachers: list[TeacherIn]
    assignments: list[AssignmentIn]
    activities: list[ActivityIn] = []
    locks: list[LockIn] = []
    options: OptionsIn = OptionsIn()


class EntryOut(BaseModel):
    kind: Literal["aula", "atividade"]
    refId: str
    periodId: str
    day: int
    slot: int


class Issue(BaseModel):
    category: Literal["cadastro", "matematica", "restricoes", "preferencias", "tempo"]
    message: str
    suggestion: Optional[str] = None
    refs: list[str] = []
