// Modelo de dados da aplicação. Tudo fica salvo no IndexedDB do navegador.
export type ID = string;

export interface Slot {
  start: string; // "07:00" ou "" (não configurado)
  end: string;
}

export interface Break {
  afterSlot: number; // intervalo após a aula de índice afterSlot (0 = após a 1ª aula)
  start: string;
  end: string;
  label: string;
}

export interface Period {
  id: ID;
  name: string;
  slots: Slot[];
  breaks: Break[];
}

export interface Cycle {
  id: ID;
  name: string;
}

export interface Grade {
  id: ID;
  name: string; // "1º ano"
  short: string; // "1º"
  cycleId: ID | null;
  order: number;
}

export type FreePolicy = 'livre' | 'reservado' | 'complementar';
export type FreePosition = 'qualquer' | 'fim' | 'inicio';

export interface SchoolClass {
  id: ID;
  periodId: ID;
  gradeId: ID;
  letter: string;
  name: string;
  weeklyLessons: number;
  dailyMax: number | null; // null = todas as aulas do período
  blocked: [number, number][]; // (dia, aula) sem aula regular
  freePolicy: FreePolicy;
  freePosition: FreePosition;
  notes: string;
}

export interface PendingGroup {
  id: ID;
  periodId: ID;
  gradeId: ID;
  weeklyLessons: number;
  note: string;
}

export interface Subject {
  id: ID;
  name: string;
  short: string;
  color: string;
}

export interface Limit {
  value: number;
  hard: boolean;
}

export interface Availability {
  workDays: number[];
  unavailable: string[]; // chaves "periodo|dia|aula"
  avoid: string[]; // preferência: evitar
  entry: Record<ID, number | null>;
  exit: Record<ID, number | null>;
  maxDaily: Limit | null;
  maxConsecutive: Limit | null;
  preferredDays: number[];
  maxDays: number | null;
  preferConsecutive: boolean;
  avoidGaps: boolean;
}

export interface OtherWork {
  label: string;
  qty: number;
}

export interface Workload {
  total: number | null;
  regular: number | null;
  ha: number | null;
  cch: number | null;
  hl: number | null;
  others: OtherWork[];
}

/** Agrupamento de JEIF (Jornada Especial Integral de Formação). */
export interface JeifGroup {
  id: ID;
  name: string; // "Grupo I"
  start: string; // "10:30"
  end: string; // "12:00"
  days: number[]; // índices dos dias letivos (padrão: segunda a quinta)
  /** Sem horário vago entre as aulas do período imediatamente anterior e a JEIF. */
  noGapBefore: boolean;
}

export interface Teacher {
  id: ID;
  name: string;
  subjectIds: ID[];
  periodIds: ID[];
  jeifGroupId: ID | null;
  workload: Workload;
  availability: Availability;
  notes: string;
}

export interface Assignment {
  id: ID;
  classId: ID;
  subjectId: ID;
  teacherId: ID | null;
  lessons: number;
  maxPerDay: number | null;
  double: 'indiferente' | 'preferir';
}

export type ActivityType = 'HA' | 'CCH' | 'HL' | 'OUTRA';
export type Position =
  | 'qualquer'
  | 'meio'
  | 'inicio_periodo'
  | 'fim_periodo'
  | 'inicio_ou_fim_periodo'
  | 'inicio_jornada'
  | 'fim_jornada'
  | 'inicio_ou_fim_jornada';

export interface Activity {
  id: ID;
  teacherId: ID;
  type: ActivityType;
  label: string;
  periodId: ID;
  qty: number;
  inGrid: boolean; // ocupa horário na grade?
  days: number[]; // vazio = qualquer dia de trabalho
  slots: number[]; // vazio = qualquer aula do período
  position: Position;
  mode: 'flexivel' | 'fixo';
  fixed: [number, number][];
  maxPerDay: number | null;
  classId: ID | null; // ocupa horário livre desta turma
  notes: string;
}

export type WorkComponent = 'aula' | 'HA' | 'CCH' | 'HL' | 'OUTRA';

export interface WorkloadConfig {
  unit: string;
  components: Record<WorkComponent, { counts: boolean; weight: number }>;
}

export type StrategyId = 'janelas' | 'dias' | 'distribuicao' | 'aproveitamento' | 'preferencias' | 'equilibrada';

export interface SchoolConfig {
  name: string;
  days: string[];
  lessonMinutes: number;
  workload: WorkloadConfig;
  defaultFreePolicy: FreePolicy;
  jeifGroups: JeifGroup[];
  solver: { timeLimit: number; strategies: StrategyId[]; serverUrl: string };
}

export interface Entry {
  kind: 'aula' | 'atividade';
  refId: ID;
  periodId: ID;
  day: number;
  slot: number;
  locked?: boolean;
}

export interface Schedule {
  id: ID;
  name: string;
  createdAt: string;
  updatedAt: string;
  strategy: string;
  label: string;
  entries: Entry[];
  edited: boolean;
  solver?: { status: string; wallTime: number; objective?: number; bound?: number };
  notes: string;
}

export interface AppData {
  version: 1;
  school: SchoolConfig;
  periods: Period[];
  cycles: Cycle[];
  grades: Grade[];
  classes: SchoolClass[];
  pending: PendingGroup[];
  subjects: Subject[];
  teachers: Teacher[];
  assignments: Assignment[];
  activities: Activity[];
  schedules: Schedule[];
  activeScheduleId: ID | null;
  isDemo: boolean;
  lastBackup: string | null;
  updatedAt: string;
}
