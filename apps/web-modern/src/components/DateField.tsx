// Campos de fecha, fecha y hora, y hora que se ven DD/MM/AAAA HH:MM (24 h).
//
// <input type="date"> lo dibuja el navegador con el idioma de Chrome: con Chrome
// en inglés salía mm/dd/yyyy y la hora con AM/PM, aunque la app esté en español.
// Regla del producto: toda fecha que lee una persona va DD/MM/AAAA. Estos campos
// reemplazan a los nativos sin cambiar nada hacia afuera: `value` y lo que
// entregan onChange / onBlur en `e.target.value` siguen siendo AAAA-MM-DD,
// AAAA-MM-DDTHH:MM o HH:MM, como el input nativo.
//
// Se escribe con números (las barras y los dos puntos se ponen solos) y el botón
// de calendario abre el selector del navegador sobre un input nativo oculto.

import React, { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useT } from "../lib/i18n";

type Kind = "date" | "datetime-local" | "time";

type NativeProps = Omit<React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "onBlur">;

export interface DateFieldProps extends NativeProps {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}

const DIGITS: Record<Kind, number> = { date: 8, "datetime-local": 12, time: 4 };

/** Valor del input nativo → texto que se ve. */
function toText(kind: Kind, v: string | null | undefined): string {
  if (!v) return "";
  if (kind === "time") {
    const m = /^(\d{2}):(\d{2})/.exec(v);
    return m ? `${m[1]}:${m[2]}` : "";
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return "";
  const day = `${m[3]}/${m[2]}/${m[1]}`;
  return kind === "date" ? day : m[4] ? `${day} ${m[4]}:${m[5]}` : day;
}

/** Lo que se tipeó, con las barras y los dos puntos en su lugar. */
function mask(kind: Kind, raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, DIGITS[kind]);
  if (kind === "time") return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
  let out = d.slice(0, 2);
  if (d.length > 2) out += `/${d.slice(2, 4)}`;
  if (d.length > 4) out += `/${d.slice(4, 8)}`;
  if (d.length > 8) out += ` ${d.slice(8, 10)}`;
  if (d.length > 10) out += `:${d.slice(10, 12)}`;
  return out;
}

/** Texto completo y válido → valor del input nativo; si no, null. */
function toValue(kind: Kind, text: string): string | null {
  const d = text.replace(/\D/g, "");
  if (d.length !== DIGITS[kind]) return null;
  const hhmm = (s: string) => {
    const h = +s.slice(0, 2), mi = +s.slice(2, 4);
    return h <= 23 && mi <= 59 ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : null;
  };
  if (kind === "time") return hhmm(d);
  const day = +d.slice(0, 2), month = +d.slice(2, 4), year = +d.slice(4, 8);
  const daysInMonth = new Date(year, month, 0).getDate();
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  const iso = `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  if (kind === "date") return iso;
  const time = hhmm(d.slice(8, 12));
  return time ? `${iso}T${time}` : null;
}

/** Evento con la forma del nativo: lo único que se lee de afuera es target.value. */
function asEvent<E>(base: object, value: string, name?: string, id?: string): E {
  const target = { value, name: name ?? "", id: id ?? "" };
  return Object.assign({}, base, { target, currentTarget: target }) as E;
}

/** Ancho, márgenes y lugar en un flex/grid van al contenedor; el resto, al campo. */
const LAYOUT_CLASS = /^(-?m[trblxy]?-|w-|min-w-|max-w-|flex-|shrink|grow|basis-|col-|row-|self-|justify-self-|order-|block$|inline-block$)/;

const PLACEHOLDER_KEY = { date: "common.datePlaceholder", "datetime-local": "common.dateTimePlaceholder", time: "common.timePlaceholder" } as const;

function DateField({ kind, value, defaultValue, onChange, onBlur, className = "", style, disabled, min, max, name, id, ...rest }: DateFieldProps & { kind: Kind }) {
  const t = useT();
  const controlled = value !== undefined;
  const current = (controlled ? value : defaultValue) ?? "";
  const [text, setText] = useState(() => toText(kind, current));
  const valueRef = useRef(current);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Un valor que llega de afuera (otro campo, el copiloto, un reset) se muestra,
  // salvo mientras se está escribiendo: no se le pisa el texto a medias.
  useEffect(() => {
    if (!controlled) return;
    valueRef.current = value ?? "";
    if (!focused.current) setText(toText(kind, value));
  }, [controlled, kind, value]);

  const emit = (next: string, base: object) => {
    if (next === valueRef.current) return;
    valueRef.current = next;
    onChange?.(asEvent<React.ChangeEvent<HTMLInputElement>>(base, next, name, id));
  };

  const layout = className.split(/\s+/).filter(c => LAYOUT_CLASS.test(c.replace(/^\w+:/, "")));
  const field = className.split(/\s+/).filter(c => c && !layout.includes(c));
  const block = layout.some(c => /^(w-full|block)$/.test(c));
  const withPicker = kind !== "time";

  return (
    <span className={`relative ${block ? "block" : "inline-block"} align-middle ${layout.join(" ")}`}>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        name={name}
        id={id}
        disabled={disabled}
        size={kind === "datetime-local" ? 16 : kind === "date" ? 10 : 5}
        placeholder={rest.placeholder ?? t(PLACEHOLDER_KEY[kind])}
        className={`${field.join(" ")} w-full`}
        style={withPicker ? { paddingRight: "1.75rem", ...style } : style}
        value={text}
        onFocus={e => { focused.current = true; rest.onFocus?.(e); }}
        onChange={e => {
          const masked = mask(kind, e.target.value);
          setText(masked);
          if (!masked) emit("", e);
          else {
            const next = toValue(kind, masked);
            if (next) emit(next, e);
          }
        }}
        onBlur={e => {
          focused.current = false;
          // Lo que quedó a medias o inválido no se guarda: vuelve lo último bueno.
          setText(toText(kind, valueRef.current));
          onBlur?.(asEvent<React.FocusEvent<HTMLInputElement>>(e, valueRef.current, name, id));
        }}
      />
      {withPicker && (
        <>
          <input
            ref={pickerRef}
            type={kind}
            tabIndex={-1}
            aria-hidden
            min={min}
            max={max}
            value={controlled ? (value ?? "") : valueRef.current}
            onChange={e => {
              const next = e.target.value;
              setText(toText(kind, next));
              emit(next, e);
              // Como el nativo, el campo queda enfocado: los que guardan al
              // salir (planilla, programación de la OT) guardan al dejarlo.
              inputRef.current?.focus();
            }}
            className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label={t("common.openCalendar")}
            title={t("common.openCalendar")}
            onClick={() => {
              const p = pickerRef.current;
              if (!p) return;
              try { p.showPicker(); } catch { p.focus(); p.click(); }
            }}
            className="absolute inset-y-0 right-1 flex items-center px-0.5 text-text-industrial/50 hover:text-accent disabled:opacity-40"
          >
            <CalendarDays className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </span>
  );
}

export const DateInput = (p: DateFieldProps) => <DateField kind="date" {...p} />;
export const DateTimeInput = (p: DateFieldProps) => <DateField kind="datetime-local" {...p} />;
export const TimeInput = (p: DateFieldProps) => <DateField kind="time" {...p} />;
