import { useEffect, useState } from 'react';
import { ConfirmHost } from './components/ui';
import { servedLocally } from './logic/api';
import { useStore, type PageId } from './store';
import Dashboard from './pages/Dashboard';
import SchoolPage from './pages/SchoolPage';
import PeriodsPage from './pages/PeriodsPage';
import ClassesPage from './pages/ClassesPage';
import MatrixPage from './pages/MatrixPage';
import TeachersPage from './pages/TeachersPage';
import WorkloadPage from './pages/WorkloadPage';
import ActivitiesPage from './pages/ActivitiesPage';
import AvailabilityPage from './pages/AvailabilityPage';
import SolvePage from './pages/SolvePage';
import { ClassSchedulePage, TeacherSchedulePage } from './pages/SchedulePages';
import OverviewPage from './pages/OverviewPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

const MENU: { id: PageId; label: string; icon: string; group: string }[] = [
  { id: 'painel', label: 'Painel inicial', icon: '◧', group: 'Início' },
  { id: 'escola', label: 'Configuração da escola', icon: '⌂', group: 'Estrutura' },
  { id: 'periodos', label: 'Cadastro de períodos', icon: '◷', group: 'Estrutura' },
  { id: 'turmas', label: 'Cadastro de turmas', icon: '▦', group: 'Estrutura' },
  { id: 'matriz', label: 'Matriz curricular', icon: '☰', group: 'Estrutura' },
  { id: 'professores', label: 'Cadastro de professores', icon: '☺', group: 'Professores' },
  { id: 'cargas', label: 'Cargas horárias', icon: 'Σ', group: 'Professores' },
  { id: 'atividades', label: 'H.A., CCH e HL', icon: '◔', group: 'Professores' },
  { id: 'disponibilidade', label: 'Disponibilidade', icon: '✓', group: 'Professores' },
  { id: 'montagem', label: 'Montagem automática', icon: '⚙', group: 'Grade' },
  { id: 'grade-turma', label: 'Grade por turma', icon: '▤', group: 'Grade' },
  { id: 'grade-professor', label: 'Grade por professor', icon: '▥', group: 'Grade' },
  { id: 'grade-geral', label: 'Grade geral', icon: '▩', group: 'Grade' },
  { id: 'relatorios', label: 'Relatórios', icon: '⎙', group: 'Saída' },
  { id: 'configuracoes', label: 'Configurações e backups', icon: '⛁', group: 'Saída' },
];

function Page({ id }: { id: PageId }) {
  switch (id) {
    case 'painel': return <Dashboard />;
    case 'escola': return <SchoolPage />;
    case 'periodos': return <PeriodsPage />;
    case 'turmas': return <ClassesPage />;
    case 'matriz': return <MatrixPage />;
    case 'professores': return <TeachersPage />;
    case 'cargas': return <WorkloadPage />;
    case 'atividades': return <ActivitiesPage />;
    case 'disponibilidade': return <AvailabilityPage />;
    case 'montagem': return <SolvePage />;
    case 'grade-turma': return <ClassSchedulePage />;
    case 'grade-professor': return <TeacherSchedulePage />;
    case 'grade-geral': return <OverviewPage />;
    case 'relatorios': return <ReportsPage />;
    case 'configuracoes': return <SettingsPage />;
  }
}

export default function App() {
  const { loaded, loadError, page, go, init, saveState, savedAt, toasts, dismiss } = useStore();
  const isDemo = useStore((s) => s.data.isDemo);
  const school = useStore((s) => s.data.school.name);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  if (!loaded) return <div className="loading">Carregando dados salvos…</div>;

  let lastGroup = '';
  return (
    <div className={'app' + (menuOpen ? ' menu-open' : '')}>
      <aside className="sidebar no-print">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <div>
            <strong>Grade Horária</strong>
            <span>{school || 'Escola'}</span>
          </div>
        </div>
        <nav>
          {MENU.map((m, i) => {
            const head = m.group !== lastGroup ? <div className="nav-group">{m.group}</div> : null;
            lastGroup = m.group;
            return (
              <div key={m.id}>
                {head}
                <button
                  className={'nav-item' + (page === m.id ? ' active' : '')}
                  onClick={() => { go(m.id); setMenuOpen(false); }}
                  aria-current={page === m.id ? 'page' : undefined}
                >
                  <span className="nav-num">{i + 1}</span>
                  <span className="nav-icon" aria-hidden>{m.icon}</span>
                  {m.label}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="storage-note">
          <div className={'save-state ' + saveState}>
            {saveState === 'salvando' ? 'Salvando…' : saveState === 'erro' ? '⚠ Erro ao salvar' : `✓ Salvo${savedAt ? ' às ' + new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`}
          </div>
          <div>Os dados ficam armazenados <b>somente neste navegador e neste computador</b>{!servedLocally() && <> (nesta versão online, separados dos dados da versão local)</>}. Faça backups regularmente.</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">☰</button>
          <span className="topbar-title">{MENU.find((m) => m.id === page)?.label}</span>
        </header>
        {isDemo && (
          <div className="demo-banner no-print">
            Você está usando <b>dados FICTÍCIOS de demonstração</b>. Eles não representam a escola real.{' '}
            <button className="btn small" onClick={() => go('configuracoes', 'avancado')}>Voltar aos dados reais</button>
          </div>
        )}
        {loadError && <div className="demo-banner erro">Não foi possível ler os dados salvos: {loadError}. Verifique se o navegador permite armazenamento local.</div>}
        <main className="content">
          <Page id={page} />
        </main>
      </div>
      {menuOpen && <div className="menu-backdrop no-print" onClick={() => setMenuOpen(false)} />}
      <div className="toasts no-print" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind} onClick={() => dismiss(t.id)}>{t.text}</div>
        ))}
      </div>
      <ConfirmHost />
    </div>
  );
}
