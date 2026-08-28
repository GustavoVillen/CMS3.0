// PARTE SEMANAL DE FLOTA — pantalla de consulta.
//
// Dos cosas distintas conviven acá:
//
//   · "Ahora": se arma en el momento con LA SESIÓN DE QUIEN MIRA, así que cada
//     uno ve el estado de los buques que tiene asignados. Por eso está abierta
//     a todos los roles.
//   · "Semanas anteriores": son las copias congeladas que dejó el envío
//     automático. Son de flota completa, y sólo el administrador ve toda la
//     flota, así que la lista se pide únicamente para ese rol (el backend lo
//     vuelve a chequear con 403).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarRange, Loader2, Sunrise, Sunset, Archive, Mail, MailX } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AlertDialog } from "../components/AlertDialog";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";

type Kind = "WEEKLY_OPENING" | "WEEKLY_CLOSING";

interface HistoryItem {
  id: string;
  reportKind: Kind;
  periodKey: string;
  status: string;
  recipients: string[];
  sentAt: string;
  hasSnapshot: boolean;
}

/** El HTML del parte viene del backend; se pide con la sesión por cabecera. */
async function fetchReportHtml(path: string): Promise<string> {
  const res = await fetch(path, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("gpms_token") ?? ""}`,
      "X-Tenant-Slug": localStorage.getItem("gpms_tenant_slug") ?? "",
    },
  });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try { const j = await res.json(); message = j?.error?.message ?? message; } catch { /* no era JSON */ }
    throw new ApiError(res.status, "REPORT_ERROR", message);
  }
  return res.text();
}

export const WeeklyReportPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";

  const [kind, setKind] = useState<Kind>("WEEKLY_OPENING");
  const [viewing, setViewing] = useState<HistoryItem | null>(null);
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [alert, setAlert] = useState<string | null>(null);

  // `t` se recrea en CADA render (useT no memoriza). Ponerla como dependencia
  // de estas funciones las volvía inestables, el efecto de abajo se disparaba
  // en cada render y la pantalla entraba en un bucle de recargas. Se lee por
  // ref para que las funciones queden estables y el efecto corra una sola vez.
  const tRef = useRef(t);
  tRef.current = t;

  const loadCurrent = useCallback(async (k: Kind) => {
    setLoading(true);
    setViewing(null);
    try {
      setHtml(await fetchReportHtml(`/app/tenant/weekly-report/preview?kind=${k}`));
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : tRef.current("weeklyReport.loadError"));
      setHtml("");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadArchived = useCallback(async (item: HistoryItem) => {
    setLoading(true);
    setViewing(item);
    try {
      setHtml(await fetchReportHtml(`/app/tenant/weekly-report/archived/${item.id}`));
    } catch (e) {
      setAlert(e instanceof ApiError ? e.message : tRef.current("weeklyReport.loadError"));
      setHtml("");
    } finally {
      setLoading(false);
    }
  }, []);

  // El ítem del menú ya está restringido a administradores, pero la ruta se
  // puede escribir a mano: sin esto entraría, pediría el parte y mostraría un
  // error 403 en una ventanita, que es una forma fea de decir "no te toca".
  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    void loadCurrent("WEEKLY_OPENING");
  }, [loadCurrent, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get<{ items: HistoryItem[] }>("/app/tenant/weekly-report/history")
      .then((r) => setHistory(r.items ?? []))
      .catch(() => { /* sin historial todavía: la lista queda vacía */ });
  }, [isAdmin]);

  const kindLabel = (k: Kind) => k === "WEEKLY_OPENING" ? t("weeklyReport.opening") : t("weeklyReport.closing");

  const tabCls = (active: boolean) => [
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
    active
      ? "bg-accent text-accent-fg border-accent"
      : "border-border text-fg/60 hover:text-fg hover:bg-fg/5",
  ].join(" ");

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader icon={CalendarRange} title={t("page.weeklyReport")} />
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-fg/50">
          {t("weeklyReport.adminOnly")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={CalendarRange} title={t("page.weeklyReport")}>
        <button className={tabCls(!viewing && kind === "WEEKLY_OPENING")}
          onClick={() => { setKind("WEEKLY_OPENING"); void loadCurrent("WEEKLY_OPENING"); }}>
          <Sunrise className="w-3.5 h-3.5" /> {t("weeklyReport.opening")}
        </button>
        <button className={tabCls(!viewing && kind === "WEEKLY_CLOSING")}
          onClick={() => { setKind("WEEKLY_CLOSING"); void loadCurrent("WEEKLY_CLOSING"); }}>
          <Sunset className="w-3.5 h-3.5" /> {t("weeklyReport.closing")}
        </button>
      </PageHeader>

      <div className="flex gap-4 items-start">
        {/* Semanas anteriores — sólo administrador */}
        {isAdmin && history.length > 0 && (
          <aside className="w-64 shrink-0 rounded-2xl border border-border bg-surface p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fg/40 px-1 flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5" /> {t("weeklyReport.pastWeeks")}
            </p>
            <div className="space-y-1 max-h-[70vh] overflow-y-auto">
              {history.map((h) => {
                const active = viewing?.id === h.id;
                const emailed = h.status === "SENT";
                return (
                  <button
                    key={h.id}
                    onClick={() => { if (h.hasSnapshot) void loadArchived(h); }}
                    disabled={!h.hasSnapshot}
                    title={h.hasSnapshot ? undefined : t("weeklyReport.noSnapshot")}
                    className={[
                      "w-full text-left px-2.5 py-2 rounded-lg border transition-all",
                      active ? "border-accent bg-accent/10" : "border-transparent hover:bg-fg/5",
                      h.hasSnapshot ? "cursor-pointer" : "opacity-40 cursor-default",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-fg">{h.periodKey}</span>
                      {emailed
                        ? <Mail className="w-3 h-3 text-success-sea shrink-0" aria-label={t("weeklyReport.emailed")} />
                        : <MailX className="w-3 h-3 text-fg/30 shrink-0" aria-label={t("weeklyReport.notEmailed")} />}
                    </div>
                    <span className="text-[10px] text-fg/50">{kindLabel(h.reportKind)}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        <div className="flex-1 min-w-0 rounded-2xl border border-border bg-surface overflow-hidden">
          {viewing && (
            <div className="px-4 py-2 border-b border-border bg-fg/[0.03] flex items-center gap-2 flex-wrap">
              <Archive className="w-3.5 h-3.5 text-fg/40" />
              <span className="text-xs text-fg/70">
                {t("weeklyReport.viewingArchived")
                  .replace("{week}", viewing.periodKey)
                  .replace("{kind}", kindLabel(viewing.reportKind))}
              </span>
              <button
                onClick={() => { void loadCurrent(kind); }}
                className="text-xs font-medium text-accent hover:underline ml-auto"
              >
                {t("weeklyReport.backToNow")}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 text-fg/40 text-sm py-24">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : html ? (
            // sandbox sin permisos: el parte es HTML de correo, no tiene ni
            // necesita scripts. Las imágenes se siguen viendo.
            <iframe
              title={t("page.weeklyReport")}
              srcDoc={html}
              sandbox=""
              className="w-full border-0 bg-white"
              style={{ height: "calc(100vh - 190px)", minHeight: 480 }}
            />
          ) : (
            <div className="text-center text-fg/40 text-sm py-24">{t("weeklyReport.empty")}</div>
          )}
        </div>
      </div>

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};
