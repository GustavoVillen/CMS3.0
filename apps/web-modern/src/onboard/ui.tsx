// Piezas de la "App a bordo" (Preview V30): la app de celular del Capitán y del
// Jefe de Máquinas. Todo lo tocable mide 44px o más y nada baja de 13px: se usa
// con guantes, con el barco moviéndose y con poca luz.
//
// Regla de las pantallas: completar lo mínimo y mandar a aprobar. Mientras falte
// un dato obligatorio el botón principal dice "Faltan N datos" y, al tocarlo,
// marca en amarillo lo que falta y lleva hasta ahí (decisión del usuario: en el
// celular no se envía con datos incompletos).

import React, { useEffect, useRef } from "react";
import { ArrowLeft, AlertTriangle, Loader2, Check } from "lucide-react";
import { useT } from "../lib/i18n";
import { ModalCloseButton } from "../components/ModalCloseButton";

export interface Opt { value: string; label: string }

/** Pantalla completa: encabezado fijo, contenido con scroll y pie fijo. */
export function Screen({ head, foot, children, scrollKey }: {
  head?: React.ReactNode;
  foot?: React.ReactNode;
  children: React.ReactNode;
  /** Cambiarlo vuelve el scroll arriba (p. ej. al pasar de paso). */
  scrollKey?: string | number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [scrollKey]);
  // h-dvh y no h-screen: en el celular 100vh no descuenta las barras del
  // navegador y el pie con el botón principal quedaba tapado.
  return (
    <div className="h-dvh flex flex-col bg-bg text-fg">
      {head}
      <div ref={ref} data-ob-scroll className="flex-1 overflow-y-auto overscroll-contain p-4 flex flex-col gap-3.5">
        {children}
      </div>
      {foot && (
        <div className="shrink-0 bg-surface border-t border-fg/10 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-2">
          {foot}
        </div>
      )}
    </div>
  );
}

export function Head({ title, sub, onBack, step, steps = 3 }: {
  title: string;
  sub?: string | null;
  onBack: () => void;
  step?: number;
  steps?: number;
}) {
  const t = useT();
  return (
    <div className="shrink-0 bg-surface pt-[env(safe-area-inset-top)]">
      <div className={`flex items-center gap-2.5 px-3 pt-2 pb-2.5 ${step ? "" : "border-b border-fg/10"}`}>
        <button type="button" onClick={onBack} aria-label={t("ob.back")}
          className="w-11 h-11 shrink-0 rounded-xl bg-fg/5 grid place-items-center text-fg active:bg-fg/10">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-extrabold leading-tight text-fg truncate">{title}</h1>
          {sub && <p className="text-[12.5px] text-text-industrial/60 truncate">{sub}</p>}
        </div>
      </div>
      {step && (
        <div className="flex gap-1.5 px-4 pb-3 border-b border-fg/10">
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={`flex-1 h-[5px] rounded-full ${i < step ? "bg-accent" : "bg-fg/10"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Rótulo + contenido. `missing` lo pinta en amarillo con "Falta"; si se pasa, el campo es obligatorio y lleva asterisco. */
export function Field({ label, missing, optional, hint, children, id }: {
  label: string;
  missing?: boolean;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
  id?: string;
}) {
  const t = useT();
  return (
    <div id={id} data-missing={missing ? "1" : undefined}
      className={`-mx-3 px-3 py-3 rounded-2xl border-[1.5px] flex flex-col gap-2 ${missing ? "bg-warning/10 border-warning" : "border-transparent"}`}>
      <p className="text-sm font-extrabold text-fg flex items-center gap-2">
        {/* Obligatorio = quien lo usa le pasa `missing` (estándar V50: asterisco siempre). */}
        <span>{label}{missing !== undefined && !optional && <span className="ml-0.5 font-black text-danger" aria-hidden="true">*</span>}</span>
        {missing && <span className="text-[11px] font-extrabold uppercase tracking-wide text-warning">{t("ob.missing")}</span>}
        {optional && <span className="text-xs font-semibold text-text-industrial/45">{t("ob.optional")}</span>}
      </p>
      {hint && <p className="text-[12.5px] text-text-industrial/60 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

export function Chips({ options, value, onChange, small }: {
  options: Opt[];
  value: string | string[] | null;
  onChange: (v: string) => void;
  small?: boolean;
}) {
  const isOn = (v: string) => Array.isArray(value) ? value.includes(v) : value === v;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={isOn(o.value)}
          className={`${small ? "min-h-9 px-3 text-[13px]" : "min-h-11 px-3.5 text-[14.5px]"} rounded-xl border-[1.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
            isOn(o.value) ? "bg-fg text-bg border-fg" : "bg-surface text-fg border-fg/10 active:bg-fg/5"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputCls = "w-full min-h-[50px] rounded-xl border-[1.5px] border-fg/10 bg-surface text-fg text-base px-3 py-2.5 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15";
export const textareaCls = `${inputCls} min-h-[96px] resize-none leading-snug`;

/** Fila elegible con punto de radio (equipo, proveedor, OT). */
export function RadioRow({ on, onClick, title, sub, icon }: {
  on: boolean; onClick: () => void; title: string; sub?: string | null; icon?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`w-full text-left flex items-center gap-3 px-3.5 py-3 rounded-2xl border-[1.5px] ${on ? "border-accent bg-accent/10" : "border-fg/10 bg-surface active:bg-fg/5"}`}>
      {icon ?? (
        <span className={`w-[22px] h-[22px] shrink-0 rounded-full border-2 grid place-items-center ${on ? "border-accent" : "border-fg/30"}`}>
          {on && <span className="w-[11px] h-[11px] rounded-full bg-accent" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] font-bold text-fg leading-snug">{title}</b>
        {sub && <span className="block text-[12.5px] text-text-industrial/60 truncate">{sub}</span>}
      </span>
    </button>
  );
}

/** Tarjeta grande de dos opciones (quién hace el trabajo, tipo de permiso). */
export function OptionCard({ on, onClick, icon, title, sub }: {
  on: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`min-h-[124px] rounded-2xl border-[1.5px] p-3.5 flex flex-col gap-2 items-start text-left ${on ? "border-accent bg-accent/10" : "border-fg/10 bg-surface active:bg-fg/5"}`}>
      <span className={`w-[42px] h-[42px] rounded-xl grid place-items-center ${on ? "bg-accent text-accent-fg" : "bg-fg/5 text-fg"}`}>{icon}</span>
      <b className="text-[15px] font-bold leading-tight text-fg">{title}</b>
      {sub && <small className="text-[12.5px] text-text-industrial/60">{sub}</small>}
    </button>
  );
}

/**
 * Botón principal. Con datos faltantes dice "Faltan N datos" en amarillo y
 * `onMissing` marca los campos; sin faltantes ejecuta `onClick`.
 */
export function MainButton({ missing = 0, label, icon, onClick, onMissing, busy, disabled }: {
  missing?: number;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  onMissing?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  if (missing > 0) {
    return (
      <button type="button" onClick={onMissing}
        className="w-full min-h-[54px] rounded-2xl border-[1.5px] border-warning bg-warning/15 text-warning text-base font-extrabold flex items-center justify-center gap-2">
        <AlertTriangle className="w-[18px] h-[18px]" />
        {(missing === 1 ? t("ob.missingOne") : t("ob.missingN")).replace("{n}", String(missing))}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled}
      className="w-full min-h-[54px] rounded-2xl bg-accent text-accent-fg text-base font-extrabold flex items-center justify-center gap-2 disabled:opacity-45">
      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

/** Lleva la vista hasta el primer campo marcado como faltante. */
export function scrollToMissing() {
  requestAnimationFrame(() => {
    const el = document.querySelector("[data-ob-scroll] [data-missing='1']");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

/** Resultado de un envío: qué pasó y qué sigue. */
export function DoneScreen({ icon, title, code, lines, onHome, again }: {
  icon: React.ReactNode;
  title: string;
  code?: string | null;
  lines: Array<{ icon: React.ReactNode; text: string }>;
  onHome: () => void;
  again?: { label: string; onClick: () => void };
}) {
  const t = useT();
  return (
    <Screen foot={<>
      <MainButton label={t("ob.backHome")} onClick={onHome} />
      {again && (
        <button type="button" onClick={again.onClick}
          className="w-full min-h-12 rounded-2xl border-[1.5px] border-fg/10 bg-surface text-fg text-[15px] font-bold">
          {again.label}
        </button>
      )}
    </>}>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-6">
        <span className="w-20 h-20 rounded-full bg-success/15 text-success grid place-items-center">{icon}</span>
        <h2 className="mt-2.5 text-[23px] font-extrabold leading-tight text-fg text-balance">{title}</h2>
        {code && <span className="font-mono text-sm font-semibold text-text-industrial/60">{code}</span>}
        <ul className="mt-2.5 w-full flex flex-col gap-2 text-left">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-fg bg-surface border border-fg/10 rounded-xl px-3 py-2.5">
              <span className="shrink-0 text-text-industrial/50 mt-px">{l.icon}</span><span>{l.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Screen>
  );
}

/** Ventanita desde abajo (cantidad de repuesto, avisos de horómetro, firma). */
export function Sheet({ title, sub, onClose, children }: {
  title: string; sub?: string | null; onClose: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] bg-black/55 flex items-end" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
        className="w-full max-h-[85vh] overflow-y-auto bg-surface rounded-t-[22px] px-4 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col gap-3">
        <div className="mx-auto w-10 h-[5px] rounded-full bg-fg/15" />
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-extrabold leading-tight text-fg">{title}</h2>
            {sub && <p className="text-[12.5px] text-text-industrial/60 font-mono mt-0.5">{sub}</p>}
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function Note({ tone = "info", icon, children }: {
  tone?: "info" | "ai" | "warn"; icon: React.ReactNode; children: React.ReactNode;
}) {
  const cls = tone === "ai" ? "bg-violet-500/10 [&>svg]:text-violet-600 dark:[&>svg]:text-violet-300"
    : tone === "warn" ? "bg-warning/10 [&>svg]:text-warning"
    : "bg-accent/10 [&>svg]:text-accent";
  return (
    <div className={`flex gap-2.5 items-start rounded-2xl p-3 text-[13.5px] text-fg ${cls}`}>
      {icon}<div className="min-w-0">{children}</div>
    </div>
  );
}

/** Rótulo de sección en mayúsculas. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-extrabold uppercase tracking-[0.07em] text-text-industrial/45 mt-1.5 -mb-1.5 px-0.5">{children}</p>;
}

export const Tick = () => <Check className="w-3.5 h-3.5" />;

/** Hoy en formato YYYY-MM-DD, en la hora local del teléfono. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
