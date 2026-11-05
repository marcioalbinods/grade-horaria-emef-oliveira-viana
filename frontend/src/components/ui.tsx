import { useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { CATEGORY_LABELS, type Issue } from '../logic/checks';
import { useStore } from '../store';

// ------------------------------------------------------------ Modal
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [props]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={'modal' + (props.wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------ Confirmação
interface ConfirmState {
  open: boolean;
  title: string;
  text: ReactNode;
  danger: boolean;
  okLabel: string;
  resolve: ((v: boolean) => void) | null;
}
const useConfirm = create<ConfirmState>(() => ({ open: false, title: '', text: '', danger: false, okLabel: 'Confirmar', resolve: null }));

export function confirmDialog(title: string, text: ReactNode, opts: { danger?: boolean; okLabel?: string } = {}): Promise<boolean> {
  return new Promise((resolve) =>
    useConfirm.setState({ open: true, title, text, danger: !!opts.danger, okLabel: opts.okLabel ?? 'Confirmar', resolve }),
  );
}

export function ConfirmHost() {
  const s = useConfirm();
  if (!s.open) return null;
  const close = (v: boolean) => {
    s.resolve?.(v);
    useConfirm.setState({ open: false, resolve: null });
  };
  return (
    <Modal
      title={s.title}
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>Cancelar</button>
          <button className={'btn ' + (s.danger ? 'danger' : 'primary')} onClick={() => close(true)} autoFocus>{s.okLabel}</button>
        </>
      }
    >
      <div className="confirm-text">{s.text}</div>
    </Modal>
  );
}

// ------------------------------------------------------------ Campos
export function Field(props: { label: string; hint?: ReactNode; children: ReactNode; error?: string | null; className?: string }) {
  return (
    <label className={'field ' + (props.className ?? '')}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
      {props.error && <span className="field-error">{props.error}</span>}
    </label>
  );
}

/** Campo numérico que aceita vazio (null) e valida limites. */
export function NumInput(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  step?: number;
  placeholder?: string;
  integer?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [txt, setTxt] = useState(props.value == null ? '' : String(props.value).replace('.', ','));
  useEffect(() => {
    setTxt(props.value == null ? '' : String(props.value).replace('.', ','));
  }, [props.value]);
  const commit = (s: string) => {
    if (s.trim() === '') {
      if (props.allowEmpty) props.onChange(null);
      else setTxt(props.value == null ? '' : String(props.value));
      return;
    }
    let v = Number(s.replace(',', '.'));
    if (!Number.isFinite(v)) {
      setTxt(props.value == null ? '' : String(props.value));
      return;
    }
    if (props.integer !== false) v = Math.round(v);
    if (props.min != null) v = Math.max(props.min, v);
    if (props.max != null) v = Math.min(props.max, v);
    props.onChange(v);
    setTxt(String(v).replace('.', ','));
  };
  return (
    <input
      className={'input num ' + (props.className ?? '')}
      inputMode="decimal"
      value={txt}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
    />
  );
}

/** Campo de texto que só grava ao sair (evita salvar a cada tecla). */
export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string; className?: string; required?: boolean }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => {
    if (props.required && !v.trim()) {
      setV(props.value);
      return;
    }
    if (v !== props.value) props.onChange(v.trim());
  };
  return (
    <input
      className={'input ' + (props.className ?? '')}
      value={v}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

export function TimeInput(props: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  return <input type="time" className="input time" value={props.value} aria-label={props.ariaLabel} onChange={(e) => props.onChange(e.target.value)} />;
}

export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={'card ' + (props.className ?? '')}>
      {(props.title || props.actions) && (
        <div className="card-head">
          {props.title && <h3>{props.title}</h3>}
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p className="muted">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  );
}

export function Empty(props: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{props.children}</p>
      {props.action}
    </div>
  );
}

export function Badge(props: { kind?: 'ok' | 'erro' | 'aviso' | 'info' | 'neutro'; children: ReactNode; title?: string }) {
  return <span className={'badge ' + (props.kind ?? 'neutro')} title={props.title}>{props.children}</span>;
}

export function Tabs<T extends string>(props: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {props.items.map((i) => (
        <button key={i.id} role="tab" aria-selected={props.value === i.id} className={'tab' + (props.value === i.id ? ' active' : '')} onClick={() => props.onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={'check' + (props.disabled ? ' disabled' : '')}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

const ISSUE_KIND = { cadastro: 'erro', matematica: 'erro', pendencia: 'aviso', aviso: 'info' } as const;

export function IssueList(props: { issues: Issue[]; limit?: number; empty?: ReactNode }) {
  const go = useStore((s) => s.go);
  const [all, setAll] = useState(false);
  if (!props.issues.length) return <p className="ok-text">{props.empty ?? '✓ Nenhum problema encontrado.'}</p>;
  const list = all || !props.limit ? props.issues : props.issues.slice(0, props.limit);
  return (
    <div>
      <ul className="issues">
        {list.map((i, k) => (
          <li key={k} className={'issue ' + ISSUE_KIND[i.category]}>
            <Badge kind={ISSUE_KIND[i.category]}>{CATEGORY_LABELS[i.category]}</Badge>
            <div className="issue-body">
              <div>{i.message}</div>
              {i.suggestion && <div className="muted small">Sugestão: {i.suggestion}</div>}
            </div>
            {i.page && <button className="btn small" onClick={() => go(i.page!, i.param ?? null)}>Corrigir</button>}
          </li>
        ))}
      </ul>
      {props.limit && props.issues.length > props.limit && (
        <button className="btn link" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Mostrar todos (${props.issues.length})`}</button>
      )}
    </div>
  );
}

export function Stat(props: { label: string; value: ReactNode; hint?: ReactNode; kind?: 'ok' | 'erro' | 'aviso' }) {
  return (
    <div className={'stat ' + (props.kind ?? '')}>
      <div className="stat-value">{props.value}</div>
      <div className="stat-label">{props.label}</div>
      {props.hint && <div className="stat-hint">{props.hint}</div>}
    </div>
  );
}
