/**
 * Piezas visuales comunes de la consola de plataforma, para que todas las
 * pantallas se lean igual: encabezado con explicación, estados con color +
 * ícono + texto, tarjetas de resumen, barras de ranking, filtros con rótulo
 * visible y estados vacíos que dicen qué hacer.
 */
import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Circle, Info, Inbox } from "lucide-react";
import type { Tone } from "../../lib/platform-labels";

export const inputCls =
  "w-full md:w-auto px-3 py-2.5 md:py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-base md:text-sm text-fg " +
  "placeholder:text-text-industrial/40 focus:outline-none focus:border-accent/50";

// ── Encabezado de página ─────────────────────────────────────────────────────

export function PageIntro({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-start gap-3 mb-5">
      <div className="min-w-0 md:flex-1">
        <h1 className="text-xl font-bold text-fg">{title}</h1>
        <p className="text-sm text-text-industrial/60 mt-0.5 max-w-3xl">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ── Estado (color + ícono + texto) ───────────────────────────────────────────

const TONE_CLS: Record<Tone, string> = {
  ok:    "bg-success/10 text-success border-success/25",
  warn:  "bg-warning/10 text-warning border-warning/25",
  bad:   "bg-danger/10 text-danger border-danger/25",
  info:  "bg-accent/10 text-accent border-accent/25",
  muted: "bg-fg/5 text-text-industrial/60 border-fg/10",
};
const TONE_ICON: Record<Tone, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, info: Info, muted: Circle,
};

export function StatusPill({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 max-w-full whitespace-normal md:whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold text-left ${TONE_CLS[tone]}`}>
      <Icon className="w-3 h-3 shrink-0" />{children}
    </span>
  );
}

// ── Tarjeta, tarjeta de resumen y ranking ────────────────────────────────────

export function Card({ title, subtitle, actions, children, className = "" }: {
  title?: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`bento-card rounded-2xl overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start gap-2 px-4 pt-4">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-bold text-fg">{title}</h2>}
            {subtitle && <p className="text-xs text-text-industrial/50 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={title || actions ? "pt-3" : ""}>{children}</div>
    </section>
  );
}

export function KpiCard({ label, value, hint, tone, onClick }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "bad"; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`bento-card rounded-2xl px-3 py-3 md:px-4 md:py-3.5 text-left w-full min-w-0 ${onClick ? "hover:border-accent/40 transition-colors cursor-pointer" : ""}`}>
      <div className="text-xs text-text-industrial/60">{label}</div>
      <div className={`text-xl md:text-2xl font-bold mt-0.5 break-words ${tone === "bad" ? "text-danger" : "text-fg"}`}>{value}</div>
      {hint && <div className="text-xs text-text-industrial/50 mt-0.5">{hint}</div>}
    </Tag>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 mb-4">{children}</div>;
}

/** Lista con barra proporcional: «Walter García · 168 usos ……… US$ 1,21». */
export function BarList({ items, emptyText = "Sin datos en el período." }: {
  items: Array<{ key: string; label: React.ReactNode; detail?: React.ReactNode; value: number; valueText: string; onClick?: () => void }>;
  emptyText?: string;
}) {
  if (items.length === 0) return <p className="px-4 pb-4 text-sm text-text-industrial/50">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return (
    <ul className="px-4 pb-3">
      {items.map((i) => {
        const Row = i.onClick ? "button" : "div";
        return (
          <li key={i.key} className="border-b border-fg/5 last:border-0">
            <Row onClick={i.onClick} className={`w-full text-left py-2 ${i.onClick ? "hover:bg-fg/[0.03] rounded-md" : ""}`}>
              <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate"><span className="text-fg font-medium">{i.label}</span>
                  {i.detail && <span className="text-xs text-text-industrial/50"> · {i.detail}</span>}</span>
                <span className="font-semibold text-fg whitespace-nowrap">{i.valueText}</span>
              </div>
              <div className="h-2 mt-1.5 rounded bg-fg/5 overflow-hidden">
                <div className="h-full rounded bg-accent" style={{ width: `${(i.value / max) * 100}%` }} />
              </div>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

// ── Filtros ──────────────────────────────────────────────────────────────────

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-end mb-3 [&>*]:min-w-0">{children}</div>;
}

/** Campo de filtro con su rótulo siempre visible (no depende del placeholder). */
export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-industrial/60">
      {label}
      {children}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-fg/10 overflow-hidden bg-fg/[0.02] self-start">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-3 py-2 md:py-1.5 text-sm transition-colors ${value === o.value ? "bg-accent/10 text-accent font-semibold" : "text-text-industrial/60 hover:text-fg"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Vacío ────────────────────────────────────────────────────────────────────

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="py-10 px-4 text-center">
      <Inbox className="w-8 h-8 mx-auto text-text-industrial/25 mb-2" />
      <p className="text-sm font-semibold text-fg">{title}</p>
      {text && <p className="text-sm text-text-industrial/50 mt-1">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Nombre arriba, dato secundario abajo (persona + rol, empresa + buque). */
export function TwoLines({ main, sub }: { main: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="leading-tight min-w-0">
      <div className="text-sm text-fg font-medium truncate">{main}</div>
      {sub && <div className="text-xs text-text-industrial/50 truncate mt-0.5">{sub}</div>}
    </div>
  );
}
