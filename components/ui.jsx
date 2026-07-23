"use client";
// -----------------------------------------------------------------------------
// components/ui.jsx — the shared primitives every screen composes from.
// Styling lives in globals.css; these only own behaviour and structure.
// -----------------------------------------------------------------------------
import React, { createContext, useCallback, useContext, useEffect, useId, useState } from "react";

/* --------------------------------- atoms --------------------------------- */

export function Btn({ children, kind, sm, icon, className = "", ...rest }) {
  const cls = ["btn", kind, sm && "sm", icon && "icon", className].filter(Boolean).join(" ");
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

export function Dot({ tone = "ok", pulse }) {
  const color = { ok: "var(--ok)", bad: "var(--bad)", warn: "var(--warn)",
    blue: "var(--blue)", faint: "var(--faint)" }[tone] ?? tone;
  return <span className={`dot${pulse ? " pulse" : ""}`}
    style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}

export function Chip({ children, tone = "" }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function Card({ children, flush, className = "", ...rest }) {
  return <div className={`card${flush ? " flush" : ""} ${className}`} {...rest}>{children}</div>;
}

export function Spinner() { return <span className="spinner" />; }

/* --------------------------------- forms --------------------------------- */

export function Field({ label, hint, error, children, ...input }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      {label && <div className="label">{label}</div>}
      {children ?? <input id={id} className={`input${error ? " err" : ""}`} {...input} />}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error">{error}</div>}
    </label>
  );
}

export function Select({ label, options, hint, error, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <select className="select" {...rest}>
        {options.map((o) => {
          const { value, label: text } = typeof o === "string" ? { value: o, label: o } : o;
          return <option key={value} value={value}>{text}</option>;
        })}
      </select>
    </Field>
  );
}

export function Search({ value, onChange, placeholder = "Search…" }) {
  return (
    <span className="search">
      <span className="glyph">⌕</span>
      <input className="input" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

/** Search box that only fires upstream once typing settles. */
export function DebouncedSearch({ value, onChange, delay = 300, ...rest }) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => { setLocal(value ?? ""); }, [value]);
  useEffect(() => {
    if (local === (value ?? "")) return;
    const t = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(t);
    // `value` deliberately omitted: including it re-arms the timer on every
    // upstream echo and the search then fires twice per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);
  return <Search value={local} onChange={setLocal} {...rest} />;
}

/* --------------------------------- tabs ---------------------------------- */

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => {
        const { id, label } = typeof t === "string" ? { id: t, label: t } : t;
        return (
          <div key={id} role="tab" aria-selected={active === id}
            className={`tab${active === id ? " active" : ""}`}
            onClick={() => onChange(id)}>{label}</div>
        );
      })}
    </div>
  );
}

/* -------------------------------- modal ---------------------------------- */

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>{title}</b>
          <span className="close" onClick={onClose}>×</span>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Destructive-action gate. Returns a promise-free callback style on purpose. */
export function Confirm({ title = "Are you sure?", message, confirmLabel = "Delete",
  onConfirm, onClose, busy }) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="danger solid" onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner /> : null}{confirmLabel}
        </Btn>
      </>
    }>
      <div className="muted">{message}</div>
    </Modal>
  );
}

/* -------------------------------- toasts --------------------------------- */

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((message, tone = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3600);
  }, []);

  // The shape every screen actually wants at a call site.
  const toast = useCallback(Object.assign(
    (m) => push(m, "ok"),
    { ok: (m) => push(m, "ok"), bad: (m) => push(m, "bad"), warn: (m) => push(m, "warn") },
  ), [push]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-host">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === "ok" ? "" : t.tone}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* -------------------------------- utils ---------------------------------- */

export function timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function dateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** Cents → display string. Money is integer minor units everywhere server-side. */
export function money(cents, currency = "USD") {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency })
      .format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}

export const LABEL_TONE = {
  ONLINE: "ok", OFFLINE: "bad", BROADCASTING: "blue", ERROR: "bad", UNKNOWN: "warn",
};
