// MobileApprovals — bandeja de firmas para el celular (/m-approvals).
//
// Pensada para el que APRUEBA (Capitán / Jefe de Máquinas) y el que AUTORIZA
// (Superintendente / DPA): un link directo que abre sólo lo que está esperando
// su firma, con el contexto mínimo para decidir — título, tarea y el taller que
// va a concurrir — y dos botones grandes: verde firma, rojo rechaza.
//
// No es la app completa (/m con sus tabs): es una pantalla de una sola función,
// igual que /m-daily-reports.
//
// Las firmas salen por los endpoints de siempre (setWorkOrderApproval y los de
// la SS). Acá no hay ninguna regla de negocio propia: los botones se muestran
// según los permisos que devuelve el backend en `can`, y el backend vuelve a
// validar en cada acción. Autorizar una OT arrastra sus SS — el aviso de la
// hoja de confirmación lo dice para que nadie firme a ciegas.

import React, { useCallback, useEffect, useState } from "react";
import { LogOut, ChevronLeft, RefreshCw, Wrench, FileText, Check, X, Lock } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useT, type TranslationKey } from "../lib/i18n";
import { api, ApiError } from "../lib/api";
import { CmsLogo } from "../components/CmsLogo";
import { AlertDialog } from "../components/AlertDialog";
import { AutoTextArea } from "../components/AutoTextArea";

// ─── Tipos (espejo de approvals-service.ts) ──────────────────────────────────

interface PendingItem {
  kind: "WO" | "SR";
  id: string;
  code: string;
  vesselCode: string;
  vesselName: string | null;
  assetName: string | null;
  title: string | null;
  task: string | null;
  causes: string | null;
  priority: string | null;
  department: string | null;
  status: string;
  openDate: string | null;
  dueDate: string | null;
  providers: string[];
  requestedByName: string | null;
  requestedAt: string | null;
  serviceRequestCount: number;
  workOrderCode: string | null;
  purchaseRequestKinds: string[];
}

interface PendingApprovals {
  can: { woApprove: boolean; woAuthorize: boolean; srApprove: boolean; srAuthorize: boolean };
  woApprove: PendingItem[];
  woAuthorize: PendingItem[];
  srApprove: PendingItem[];
  srAuthorize: PendingItem[];
}

/** Las cuatro bandejas. El id es también la clave dentro de la respuesta. */
type BoxId = "woApprove" | "woAuthorize" | "srApprove" | "srAuthorize";

interface BoxDef {
  id: BoxId;
  labelKey: TranslationKey;
  /** Verbo de la acción positiva; define también el rojo ("NO ..."). */
  action: "APPROVE" | "AUTHORIZE";
  Icon: React.FC<{ className?: string }>;
  /** Color del acento del botón del menú. */
  tone: string;
}

const BOXES: BoxDef[] = [
  { id: "woApprove",   labelKey: "approvals.box.woApprove",   action: "APPROVE",   Icon: Wrench,   tone: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  { id: "woAuthorize", labelKey: "approvals.box.woAuthorize", action: "AUTHORIZE", Icon: Wrench,   tone: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  { id: "srApprove",   labelKey: "approvals.box.srApprove",   action: "APPROVE",   Icon: FileText, tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  { id: "srAuthorize", labelKey: "approvals.box.srAuthorize", action: "AUTHORIZE", Icon: FileText, tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
];

const PRIORITY_TONE: Record<string, string> = {
  CRITICAL: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  HIGH:     "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  MEDIUM:   "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  LOW:      "bg-fg/5 text-text-industrial/60 border-fg/10",
};

const fmtDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
};

// ─── Pantalla ────────────────────────────────────────────────────────────────

export const MobileApprovals: React.FC = () => {
  const { tenant, user, logout } = useAuth();
  const { vessels, selectedVesselCode, setSelectedVesselCode, selectedVessel } = useVesselContext();
  const t = useT();

  const [data, setData]       = useState<PendingApprovals | null>(null);
  const [loading, setLoading] = useState(true);
  const [box, setBox]         = useState<BoxId | null>(null);
  const [alert, setAlert]     = useState<string | null>(null);
  // Ítem en proceso de firma: abre la hoja de confirmación.
  const [pending, setPending] = useState<{ item: PendingItem; box: BoxDef; reject: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
      setData(await api.get<PendingApprovals>(`/app/pms/approvals/pending${qs}`));
    } catch {
      setData(null);
      setAlert(t("approvals.loadError"));
    } finally {
      setLoading(false);
    }
  }, [selectedVesselCode, t]);

  useEffect(() => { void load(); }, [load]);

  // Firmado (o rechazado): la fila sale de su bandeja y los contadores se
  // recalculan solos. No se recarga todo para no perder el scroll de la lista.
  const dropItem = (boxId: BoxId, id: string) => {
    setData(prev => (prev ? { ...prev, [boxId]: prev[boxId].filter(i => i.id !== id) } : prev));
  };

  const activeBox = box ? BOXES.find(b => b.id === box)! : null;
  const items = data && box ? data[box] : [];

  return (
    <div className="flex flex-col h-screen bg-surface dark:bg-[#0A1A2A] overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="shrink-0 px-4 py-2.5 border-b border-fg/10 flex items-center gap-3 bg-surface dark:bg-[#0D1B2A]">
        {activeBox ? (
          <button
            type="button"
            onClick={() => setBox(null)}
            className="shrink-0 p-2 -ml-2 text-text-industrial/60 hover:text-fg transition-colors"
            aria-label={t("approvals.back")}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        ) : (
          <CmsLogo className="w-7 h-7 shrink-0" title={tenant?.name ?? "CMS3.0"} />
        )}

        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-widest text-accent font-bold leading-none truncate">
            {activeBox ? t(activeBox.labelKey) : t("approvals.title")}
          </span>
          {vessels.length > 1 ? (
            <select
              value={selectedVesselCode ?? ""}
              onChange={e => setSelectedVesselCode(e.target.value || null)}
              className="mt-1 bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-xs text-fg focus:outline-none focus:border-accent/50 appearance-none min-w-0"
            >
              <option value="">— {t("common.allVessels")} —</option>
              {vessels.map(v => (
                <option key={v.code} value={v.code}>{v.name}</option>
              ))}
            </select>
          ) : selectedVessel ? (
            <span className="text-xs text-text-industrial/50 truncate">{selectedVessel.name}</span>
          ) : (
            <span className="text-xs text-text-industrial/50 truncate">{t("approvals.subtitle")}</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 p-2 text-text-industrial/40 hover:text-fg transition-colors disabled:opacity-40"
          aria-label={t("approvals.refresh")}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={logout}
          className="shrink-0 p-2 -mr-1 text-text-industrial/40 hover:text-fg transition-colors"
          aria-label="logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* ── Contenido ───────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {!activeBox ? (
          <MenuGrid data={data} loading={loading} onPick={setBox} />
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-industrial/50">
            {loading ? "…" : t("approvals.empty")}
          </p>
        ) : (
          <div className="p-3 space-y-3">
            {items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                box={activeBox}
                onAct={reject => setPending({ item, box: activeBox, reject })}
              />
            ))}
          </div>
        )}
      </main>

      {pending && (
        <ConfirmSheet
          item={pending.item}
          box={pending.box}
          reject={pending.reject}
          defaultName={user?.name ?? ""}
          onClose={() => setPending(null)}
          onError={msg => { setPending(null); setAlert(msg); }}
          onDone={() => { dropItem(pending.box.id, pending.item.id); setPending(null); }}
        />
      )}

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};

// ─── Menú: los cuatro botones ────────────────────────────────────────────────

const MenuGrid: React.FC<{
  data: PendingApprovals | null;
  loading: boolean;
  onPick: (id: BoxId) => void;
}> = ({ data, loading, onPick }) => {
  const t = useT();
  const total = data
    ? data.woApprove.length + data.woAuthorize.length + data.srApprove.length + data.srAuthorize.length
    : 0;

  return (
    <div className="p-4 space-y-3">
      {BOXES.map(b => {
        const allowed = data?.can[b.id] ?? false;
        const count = data?.[b.id].length ?? 0;
        return (
          <button
            key={b.id}
            type="button"
            disabled={!allowed || loading}
            onClick={() => onPick(b.id)}
            className={`w-full min-h-[88px] rounded-2xl border-2 px-4 py-4 flex items-center gap-4 text-left transition-all active:scale-[0.98] ${
              allowed ? b.tone : "border-fg/10 bg-fg/[0.03] text-text-industrial/40"
            } disabled:cursor-not-allowed`}
          >
            {allowed ? <b.Icon className="w-7 h-7 shrink-0" /> : <Lock className="w-6 h-6 shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block text-base font-extrabold leading-tight">{t(b.labelKey)}</span>
              {!allowed && (
                <span className="block text-[11px] mt-0.5 opacity-70">{t("approvals.noPermission")}</span>
              )}
            </span>
            {allowed && (
              <span className={`shrink-0 min-w-[2.5rem] h-10 px-2 rounded-xl flex items-center justify-center text-xl font-black ${
                count > 0 ? "bg-fg/10" : "opacity-30"
              }`}>
                {loading ? "·" : count}
              </span>
            )}
          </button>
        );
      })}

      {!loading && data && total === 0 && (
        <p className="pt-4 text-center text-sm text-text-industrial/50">{t("approvals.allClear")}</p>
      )}
    </div>
  );
};

// ─── Tarjeta de un ítem ──────────────────────────────────────────────────────

const ItemCard: React.FC<{
  item: PendingItem;
  box: BoxDef;
  onAct: (reject: boolean) => void;
}> = ({ item, box, onAct }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isAuthorize = box.action === "AUTHORIZE";
  const task = item.task?.trim() ?? "";
  const long = task.length > 180;

  return (
    <article className="rounded-2xl border border-fg/10 bg-fg/[0.02] dark:bg-[#0D1B2A] overflow-hidden">
      <div className="p-3.5 space-y-2.5">

        {/* Identificación: código, buque (NOMBRE, no código) y prioridad */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-mono font-bold text-accent truncate">
              {item.code}
              {item.kind === "SR" && item.workOrderCode ? ` · ${item.workOrderCode}` : ""}
            </p>
            <p className="text-[11px] text-text-industrial/50 truncate">
              {item.vesselName ?? item.vesselCode}
              {item.assetName ? ` · ${item.assetName}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {item.priority && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${PRIORITY_TONE[item.priority] ?? PRIORITY_TONE.LOW}`}>
                {item.priority}
              </span>
            )}
            {item.status === "ON_HOLD" && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-bold bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30">
                {t("approvals.deferredTag")}
              </span>
            )}
          </div>
        </div>

        {/* Título */}
        <h3 className="text-[15px] font-bold text-fg leading-snug">
          {item.title?.trim() || item.assetName || item.code}
        </h3>

        {/* Tarea */}
        {task && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-industrial/45">
              {t("approvals.task")}
            </p>
            <p className={`text-[13px] text-fg/80 leading-relaxed whitespace-pre-wrap ${open || !long ? "" : "line-clamp-4"}`}>
              {task}
            </p>
            {long && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="mt-0.5 text-[11px] font-semibold text-accent"
              >
                {open ? t("approvals.showLess") : t("approvals.showMore")}
              </button>
            )}
          </div>
        )}

        {/* Causas (sólo SS) */}
        {open && item.causes?.trim() && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-industrial/45">
              {t("approvals.causes")}
            </p>
            <p className="text-[13px] text-fg/80 leading-relaxed whitespace-pre-wrap">{item.causes}</p>
          </div>
        )}

        {/* Proveedores sugeridos = el taller que ya trae el registro */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-industrial/45">
            {t("approvals.providers")}
          </p>
          {item.providers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {item.providers.map(p => (
                <span key={p} className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-semibold">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-text-industrial/40 italic">{t("approvals.noProviders")}</p>
          )}
        </div>

        {/* Pie: de quién viene, vencimiento, SS colgadas */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-industrial/50 pt-0.5">
          {item.requestedByName && (
            <span>
              {isAuthorize ? t("approvals.approvedBy") : t("approvals.sentBy")}: <b className="text-fg/70">{item.requestedByName}</b>
              {fmtDate(item.requestedAt) ? ` · ${fmtDate(item.requestedAt)}` : ""}
            </span>
          )}
          {fmtDate(item.dueDate) && <span>{t("approvals.due")}: {fmtDate(item.dueDate)}</span>}
          {item.kind === "WO" && item.serviceRequestCount > 0 && (
            <span>{t("approvals.linkedSr")}: <b className="text-fg/70">{item.serviceRequestCount}</b></span>
          )}
          {item.kind === "SR" && item.purchaseRequestKinds.length > 0 && (
            <span>{item.purchaseRequestKinds.join(" · ")}</span>
          )}
        </div>
      </div>

      {/* Los dos botones grandes */}
      <div className="grid grid-cols-2 gap-px bg-fg/10 border-t border-fg/10">
        <button
          type="button"
          onClick={() => onAct(false)}
          className="min-h-[56px] flex items-center justify-center gap-2 bg-emerald-600 text-white font-extrabold text-sm tracking-wide active:brightness-90"
        >
          <Check className="w-5 h-5" />
          {isAuthorize ? t("approvals.action.authorize") : t("approvals.action.approve")}
        </button>
        <button
          type="button"
          onClick={() => onAct(true)}
          className="min-h-[56px] flex items-center justify-center gap-2 bg-red-600 text-white font-extrabold text-sm tracking-wide active:brightness-90"
        >
          <X className="w-5 h-5" />
          {isAuthorize ? t("approvals.action.rejectAuth") : t("approvals.action.reject")}
        </button>
      </div>
    </article>
  );
};

// ─── Hoja de confirmación ────────────────────────────────────────────────────

const ConfirmSheet: React.FC<{
  item: PendingItem;
  box: BoxDef;
  reject: boolean;
  defaultName: string;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}> = ({ item, box, reject, defaultName, onClose, onDone, onError }) => {
  const t = useT();
  const [name, setName]     = useState(defaultName);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Validaciones del formulario: ventanita con OK, no recuadro rojo al pie.
  const [alert, setAlert]   = useState<string | null>(null);

  const isAuthorize = box.action === "AUTHORIZE";
  const title = reject
    ? (isAuthorize ? t("approvals.action.rejectAuth") : t("approvals.action.reject"))
    : (isAuthorize ? t("approvals.action.authorize") : t("approvals.action.approve"));

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) { setAlert(t("approvals.signerRequired")); return; }
    const trimmedReason = reason.trim();
    if (reject && !trimmedReason) { setAlert(t("approvals.reasonRequired")); return; }

    setSaving(true);
    try {
      if (item.kind === "WO") {
        await api.post(`/app/pms/work-orders/${item.id}/approval`, {
          step: reject ? "RECHAZA" : isAuthorize ? "AUTORIZA" : "APRUEBA",
          name: trimmedName,
          reason: reject ? trimmedReason : undefined,
        });
      } else if (reject) {
        await api.post(`/app/pms/service-requests/${item.id}/reject`, { reason: trimmedReason });
      } else {
        await api.post(
          `/app/pms/service-requests/${item.id}/${isAuthorize ? "authorize" : "approve"}`,
          { name: trimmedName },
        );
      }
      onDone();
    } catch (err) {
      setSaving(false);
      // El servidor manda el motivo real (403 sin atribución, 409 si otro firmó
      // primero). Se muestra tal cual: es información que el usuario necesita.
      onError(err instanceof ApiError && err.message ? err.message : t("approvals.actionError"));
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div
          className="w-full max-w-lg bg-surface dark:bg-[#0D1B2A] border-t border-fg/10 rounded-t-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div>
            <h2 className={`text-lg font-extrabold ${reject ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {title}
            </h2>
            <p className="text-xs text-text-industrial/60 mt-0.5">
              {item.code} · {item.title?.trim() || item.assetName || item.vesselName || item.vesselCode}
            </p>
            {reject && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                {item.kind === "WO" ? t("approvals.rejectNoticeWo") : t("approvals.rejectNoticeSr")}
              </p>
            )}
            {/* Autorizar/aprobar una OT arrastra sus SS: que nadie firme a ciegas. */}
            {!reject && item.kind === "WO" && item.serviceRequestCount > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                {t("approvals.cascadeNotice")} ({item.serviceRequestCount})
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">
              {t("approvals.signerName")}
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/50"
            />
          </div>

          {reject && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-industrial/60">
                {t("approvals.reason")}
              </label>
              <AutoTextArea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                className="w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/50 resize-none"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="min-h-[52px] rounded-xl border border-fg/15 text-sm font-bold text-text-industrial/70 disabled:opacity-50"
            >
              {t("approvals.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className={`min-h-[52px] rounded-xl text-white text-sm font-extrabold disabled:opacity-60 ${
                reject ? "bg-red-600" : "bg-emerald-600"
              }`}
            >
              {saving ? t("approvals.saving") : t("approvals.confirm")}
            </button>
          </div>
        </div>
      </div>

      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </>
  );
};
