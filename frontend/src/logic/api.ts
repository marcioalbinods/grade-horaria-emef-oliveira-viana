// Comunicação com o motor de otimização (servidor Python com OR-Tools CP-SAT).
import type { Problem } from './payload';

export interface SolveResult {
  strategy: string;
  label: string;
  status: 'otima' | 'viavel' | 'inviavel' | 'sem_solucao_no_tempo' | 'modelo_invalido';
  wallTime: number;
  entries: { kind: 'aula' | 'atividade'; refId: string; periodId: string; day: number; slot: number }[];
  objective?: number;
  bound?: number;
  penalties?: Record<string, number>;
}

export interface ServerIssue {
  category: 'cadastro' | 'matematica' | 'restricoes' | 'preferencias' | 'tempo';
  message: string;
  suggestion?: string | null;
  refs: string[];
}

export interface DiagnosisGroup {
  key: string;
  kind: string;
  message: string;
  suggestion: string;
  refs: string[];
}

export interface Diagnosis {
  core: DiagnosisGroup[];
  relax: DiagnosisGroup[];
  unplaced: { assignmentId: string; missing: number }[];
  structural: boolean;
  complete: boolean;
  relaxOptimal?: boolean;
  unplacedOptimal?: boolean;
  unplacedStatus?: string;
  wallTime: number;
}

export interface Job {
  id: string;
  state: 'running' | 'done' | 'error';
  outcome?: 'ok' | 'precheck' | 'infeasible' | 'timeout' | 'cancelled';
  progress?: { current: number; total: number; strategy?: string };
  results?: SolveResult[];
  issues?: ServerIssue[];
  diagnosis?: Diagnosis | null;
  error?: string;
}

function base(serverUrl: string) {
  return (serverUrl || '').replace(/\/+$/, '');
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Não foi possível conectar ao motor de otimização. Verifique se o programa foi iniciado pelo arquivo "iniciar" (servidor local).');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* ignore */
    }
    throw new Error(`Erro do servidor (${res.status}). ${detail}`);
  }
  return res.json() as Promise<T>;
}

export function health(serverUrl: string) {
  return req<{ ok: boolean; ortools: string; solver: string }>(`${base(serverUrl)}/api/health`);
}

export function startSolve(serverUrl: string, problem: Problem) {
  return req<{ jobId: string }>(`${base(serverUrl)}/api/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(problem),
  });
}

export function getJob(serverUrl: string, id: string) {
  return req<Job>(`${base(serverUrl)}/api/jobs/${id}`);
}

export function cancelJob(serverUrl: string, id: string) {
  return req<{ ok: boolean }>(`${base(serverUrl)}/api/jobs/${id}/cancel`, { method: 'POST' });
}
