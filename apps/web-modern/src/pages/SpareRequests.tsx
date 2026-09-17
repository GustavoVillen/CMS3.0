// Solicitudes de repuestos (Preview V4): el formulario del buque al departamento
// de Compras. Borrador → "Enviar a Compras" (correo con el PDF) → Enviada, y ahí
// termina; lo que llega se carga por Recepción con remito en Repuestos & Stock.
// Las solicitudes viejas (Aprobada / Entregada…) se muestran sólo para consulta.

import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Ban, ClipboardList, FileDown, Loader2, Mail, Plus, Save, Send, Trash2, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";
import { DataTable, fmtDate, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { AutoTextArea } from "../components/AutoTextArea";
import { useT, type TranslationKey } from "../lib/i18n";
import { GuideField, GuideNeedTag, RequiredMark } from "../components/GuideKit";
import { useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { downloadAuthedFile } from "../lib/authed-media";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { textMatches } from "../lib/text-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestItem {
  id: string; spareId: string | null; spareSku: string | null;
  itemLabel: string; description: string; partNumber: string | null; equipment: string | null;
  onHand: number | null; quantity: number; unit: string; notes: string | null;
}

interface SpareRequest {
  id: string; requestCode: string; status: string; priority: string;
  requestedAt: string; notes: string | null; rejectionReason: string | null;
  requestedForVesselCode: string | null;
  requestedByName: string | null; sentAt: string | null;
  sentTo?: string | null; sentByName?: string | null;
  items: { id: string }[];
}
interface ListResponse { items: SpareRequest[]; total: number; }
interface SpareOption { id: string; sku: string; name: string; unit: string; available: number; manufacturerPartNumber: string | null; status: string; }
interface SendResult { sent: boolean; to: string | null; reason?: "NO_MAILBOX" | "NOT_CONFIGURED" | "SEND_FAILED"; error?: string }

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
// Estados del proceso vigente primero; el resto sólo aparece en solicitudes viejas.
const STATUSES = ["DRAFT", "SUBMITTED", "CANCELLED", "APPROVED", "REJECTED", "PARTIALLY_FULFILLED", "FULFILLED"] as const;
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-fg/5 text-fg/60 border-fg/15",
  SUBMITTED: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25",
  CANCELLED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: "text-fg/50", MEDIUM: "text-blue-700 dark:text-blue-400", HIGH: "text-amber-700 dark:text-amber-400", CRITICAL: "text-red-700 dark:text-red-400",
};

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg placeholder-fg/30 focus:outline-none focus:border-accent/50 disabled:opacity-70";
const labelCls = "block text-[10px] font-semibold text-fg/50 uppercase tracking-wider mb-1";

function StatusBadge({ status }: { status: string }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10.5px] font-bold whitespace-nowrap ${STATUS_COLORS[status] ?? "bg-fg/5 text-fg/45 border-fg/10"}`}>
      {t(`srq.status.${status}` as TranslationKey)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  requestId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const SpareRequestModal: React.FC<ModalProps> = ({ requestId, onClose, onChanged }) => {
  const t = useT();
  const can = useCan();
  const canManage = can("spareRequest.manage");
  const { vessels, selectedVesselCode } = useVesselContext();

  const [id, setId] = useState<string | null>(requestId);
  const detail = useFetch<SpareRequest>(id ? `/app/pms/spare-requests/${id}` : null, [id]);
  const itemsFetch = useFetch<{ items: RequestItem[] }>(id ? `/app/pms/spare-requests/${id}/items` : null, [id]);
  const request = detail.data;
  const items = itemsFetch.data?.items ?? [];
  const status = request?.status ?? "DRAFT";
  const isDraft = !id || status === "DRAFT";
  const editable = isDraft && canManage;

  // Campos del borrador: arrancan del registro cuando llega.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [vesselCode, setVesselCode] = useState(selectedVesselCode ?? "");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [notes, setNotes] = useState("");
  if (request && loadedFor !== request.id) {
    setLoadedFor(request.id);
    setVesselCode(request.requestedForVesselCode ?? "");
    setPriority(request.priority);
    setNotes(request.notes ?? "");
  }

  const [busy, setBusy] = useState<null | "save" | "send" | "resend" | "cancel" | "delete" | "pdf" | "add">(null);
  const [alert, setAlert] = useState<{ title?: string; message: string; closeAfter?: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [savedTick, setSavedTick] = useState(0);

  const refresh = () => { void detail.reload(); void itemsFetch.reload(); onChanged(); };
  const fail = (e: unknown, fallback: TranslationKey) => setAlert({ message: e instanceof ApiError ? e.message : t(fallback) });

  const payload = () => ({ priority, notes: notes.trim() || null, requestedForVesselCode: vesselCode || null });

  const save = async (): Promise<boolean> => {
    if (!vesselCode) { setAlert({ message: t("srq.err.vessel") }); return false; }
    setBusy("save");
    try {
      if (!id) {
        const created = await api.post<SpareRequest>("/app/pms/spare-requests", payload());
        setId(created.id);
      } else {
        await api.patch(`/app/pms/spare-requests/${id}`, payload());
      }
      setSavedTick(n => n + 1);
      refresh();
      return true;
    } catch (e) { fail(e, "srq.err.save"); return false; }
    finally { setBusy(null); }
  };

  const sendReasonText = (r: SendResult) =>
    r.reason === "NO_MAILBOX" ? t("srq.send.noMailbox")
    : r.reason === "NOT_CONFIGURED" ? t("srq.send.noSmtp")
    : t("srq.send.failed").replace("{error}", r.error ?? "");

  const send = async () => {
    if (items.length === 0) { setAlert({ message: t("srq.err.noItems") }); return; }
    if (!(await save())) return;
    setBusy("send");
    try {
      const r = await api.post<SendResult>(`/app/pms/spare-requests/${id}/submit`);
      refresh();
      setAlert(r.sent
        ? { title: t("srq.send.okTitle"), message: t("srq.send.ok").replace("{to}", r.to ?? ""), closeAfter: true }
        : { title: t("srq.send.notSentTitle"), message: sendReasonText(r) });
    } catch (e) { fail(e, "srq.err.send"); }
    finally { setBusy(null); }
  };

  const resend = async () => {
    setBusy("resend");
    try {
      const r = await api.post<SendResult>(`/app/pms/spare-requests/${id}/resend`);
      refresh();
      setAlert(r.sent
        ? { title: t("srq.send.okTitle"), message: t("srq.send.ok").replace("{to}", r.to ?? "") }
        : { title: t("srq.send.notSentTitle"), message: sendReasonText(r) });
    } catch (e) { fail(e, "srq.err.send"); }
    finally { setBusy(null); }
  };

  const cancelRequest = async () => {
    if (!cancelReason.trim()) { setAlert({ message: t("srq.err.cancelReason") }); return; }
    setBusy("cancel");
    try {
      const r = await api.post<{ purchasingNotified: boolean }>(`/app/pms/spare-requests/${id}/cancel`, { reason: cancelReason.trim() });
      setCancelling(false); setCancelReason("");
      refresh();
      setAlert({ message: r.purchasingNotified ? t("srq.cancel.okNotified") : t("srq.cancel.okNotNotified") });
    } catch (e) { fail(e, "srq.err.save"); }
    finally { setBusy(null); }
  };

  const deleteDraft = async () => {
    if (!id || !window.confirm(t("srq.confirmDelete"))) return;
    setBusy("delete");
    try { await api.delete(`/app/pms/spare-requests/${id}`); onChanged(); onClose(); }
    catch (e) { fail(e, "srq.err.save"); setBusy(null); }
  };

  const downloadPdf = async () => {
    if (!request) return;
    setBusy("pdf");
    try { await downloadAuthedFile(`/app/pms/spare-requests/${request.id}/pdf`, `${request.requestCode}.pdf`); }
    catch { setAlert({ message: t("sp.pdfError") }); }
    finally { setBusy(null); }
  };

  const saveQty = async (item: RequestItem) => {
    const raw = qtyDraft[item.id];
    if (raw === undefined || Number(raw) === item.quantity) return;
    if (!(Number(raw) > 0)) { setAlert({ message: t("srq.err.qty") }); setQtyDraft(q => ({ ...q, [item.id]: String(item.quantity) })); return; }
    try { await api.patch(`/app/pms/spare-requests/${id}/items/${item.id}`, { quantity: Number(raw) }); void itemsFetch.reload(); }
    catch (e) { fail(e, "srq.err.save"); }
  };

  const removeItem = async (item: RequestItem) => {
    try { await api.delete(`/app/pms/spare-requests/${id}/items/${item.id}`); void itemsFetch.reload(); onChanged(); }
    catch (e) { fail(e, "srq.err.save"); }
  };

  // Lo cargado desde la base y lo recién guardado pasan a ser el estado "limpio".
  const isDirty = useDirtyTracker({ vesselCode, priority, notes }, `${loadedFor}|${savedTick}`);
  const requestClose = useEscapeGuard({ isDirty: editable && isDirty, onSave: async () => { await save(); }, onClose });

  const vesselName = (code: string | null) => (code ? vessels.find(v => v.code === code)?.name ?? code : "—");
  const title = request ? request.requestCode : t("srq.new");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      {alert && (
        <AlertDialog title={alert.title} message={alert.message}
          onClose={() => { const close = alert.closeAfter; setAlert(null); if (close) onClose(); }} />
      )}
      <div className="w-full max-w-3xl max-h-[92vh] bg-surface border border-fg/10 rounded-2xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-fg/10 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-fg">{title}</h2>
              {request && <StatusBadge status={status} />}
            </div>
            {request && (
              <p className="text-[11px] text-fg/50 mt-0.5">
                {vesselName(request.requestedForVesselCode)} · {t("srq.requestedBy")} {request.requestedByName ?? "—"} · {fmtDate(request.requestedAt)}
              </p>
            )}
          </div>
          <ModalCloseButton onClose={requestClose} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {id && detail.loading && !request && (
            <p className="py-8 text-center text-xs text-fg/40"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />{t("common.loading")}</p>
          )}

          {status === "SUBMITTED" && request?.sentAt && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-xs text-blue-900 dark:text-blue-200">
              <Mail className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {t("srq.sentInfo")
                  .replace("{to}", request.sentTo ?? "—")
                  .replace("{date}", fmtDate(request.sentAt))
                  .replace("{by}", request.sentByName ?? "—")}
              </span>
            </div>
          )}
          {status === "CANCELLED" && request?.rejectionReason && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-700 dark:text-red-400">{t("srq.cancelledReason")}</p>
              <p className="text-xs text-red-800 dark:text-red-300 mt-0.5">{request.rejectionReason}</p>
            </div>
          )}
          {request && !["DRAFT", "SUBMITTED", "CANCELLED"].includes(status) && (
            <p className="rounded-xl border border-fg/10 bg-fg/5 px-3 py-2 text-[11px] text-fg/55">{t("srq.legacyHint")}</p>
          )}

          {(!id || request) && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <GuideField id="srq-vessel" missing={editable && !vesselCode}>
                  <label className={labelCls}>{t("sp.forms.vessel")}<RequiredMark />{editable && !vesselCode && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                  <select value={vesselCode} onChange={e => setVesselCode(e.target.value)} disabled={!editable || items.length > 0} className={inputCls}
                    title={editable && items.length > 0 ? t("srq.vesselLocked") : undefined}>
                    <option value="">{t("srq.pickVessel")}</option>
                    {vessels.map(v => <option key={v.code} value={v.code}>{v.name ?? v.code}</option>)}
                  </select>
                </GuideField>
                <div>
                  <label className={labelCls}>{t("col.priority")}</label>
                  <select value={priority} onChange={e => setPriority(e.target.value)} disabled={!editable} className={inputCls} title={t("srq.priorityHelp")}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{t(`sp.batch.prio.${p}` as TranslationKey)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>{t("srq.reason")}</label>
                <AutoTextArea value={notes} onChange={e => setNotes(e.target.value)} rows={2} disabled={!editable}
                  placeholder={t("srq.reasonPh")} className={`${inputCls} resize-none`} />
              </div>
            </>
          )}

          {id && request && (
            // Hace falta al menos un ítem para poder enviar a Compras.
            <GuideField id="srq-items" missing={editable && items.length === 0}>
              <label className={labelCls}>{t("srq.col.items")}<RequiredMark />{editable && items.length === 0 && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
              <ItemsTable
                requestId={id}
                vesselCode={request.requestedForVesselCode}
                items={items}
                editable={editable}
                qtyDraft={qtyDraft}
                setQtyDraft={setQtyDraft}
                onSaveQty={saveQty}
                onRemove={removeItem}
                onAdded={() => { void itemsFetch.reload(); onChanged(); }}
                onError={msg => setAlert({ message: msg })}
              />
            </GuideField>
          )}
          {!id && <p className="text-[11px] text-fg/45">{t("srq.createFirst")}</p>}
          {status === "SUBMITTED" && <p className="text-[11px] text-fg/45">{t("srq.receiveHint")}</p>}

          {cancelling && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-3 space-y-2">
              <GuideField id="srq-cancel-reason" missing={!cancelReason.trim()}>
                <label className="text-xs font-semibold text-red-700 dark:text-red-400">{t("srq.cancelTitle")}<RequiredMark />{!cancelReason.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                <AutoTextArea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2}
                  placeholder={t("srq.cancelPh")} className={`${inputCls} resize-none mt-1`} />
              </GuideField>
              <div className="flex gap-2">
                <button onClick={() => void cancelRequest()} disabled={busy !== null}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:brightness-110 disabled:opacity-40">
                  {busy === "cancel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("srq.cancelConfirm")}
                </button>
                <button onClick={() => setCancelling(false)} className="px-3 py-1.5 text-xs text-fg/50 hover:text-fg border border-fg/10 rounded-lg">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-fg/10 shrink-0">
          <div className="flex gap-2">
            {id && editable && (
              <button onClick={() => void deleteDraft()} disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-400 border border-red-500/25 bg-red-500/5 rounded-lg hover:bg-red-500/10 disabled:opacity-40">
                <Trash2 className="w-3.5 h-3.5" /> {t("srq.deleteDraft")}
              </button>
            )}
            {status === "SUBMITTED" && canManage && !cancelling && (
              <button onClick={() => setCancelling(true)} disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-400 border border-red-500/25 bg-red-500/5 rounded-lg hover:bg-red-500/10 disabled:opacity-40">
                <Ban className="w-3.5 h-3.5" /> {t("srq.cancel")}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {request && (
              <button onClick={() => void downloadPdf()} disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-fg/5 border border-fg/10 text-fg/70 rounded-lg hover:bg-fg/10 hover:text-fg disabled:opacity-40">
                {busy === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
              </button>
            )}
            {editable && (
              <button onClick={() => void save()} disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent/15 border border-accent/30 text-accent rounded-lg hover:bg-accent/25 disabled:opacity-40">
                {busy === "save" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {id ? t("srq.save") : t("srq.createDraft")}
              </button>
            )}
            {id && editable && (
              <button onClick={() => void send()} disabled={busy !== null}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-orange-600 text-white rounded-lg hover:brightness-110 disabled:opacity-40">
                {busy === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t("srq.send")}
              </button>
            )}
            {status === "SUBMITTED" && canManage && (
              <button onClick={() => void resend()} disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-fg/5 border border-fg/10 text-fg/70 rounded-lg hover:bg-fg/10 hover:text-fg disabled:opacity-40">
                {busy === "resend" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} {t("srq.resend")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Ítems
// ---------------------------------------------------------------------------

interface ItemsTableProps {
  requestId: string;
  vesselCode: string | null;
  items: RequestItem[];
  editable: boolean;
  qtyDraft: Record<string, string>;
  setQtyDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSaveQty: (item: RequestItem) => void;
  onRemove: (item: RequestItem) => void;
  onAdded: () => void;
  onError: (message: string) => void;
}

const ItemsTable: React.FC<ItemsTableProps> = ({ requestId, vesselCode, items, editable, qtyDraft, setQtyDraft, onSaveQty, onRemove, onAdded, onError }) => {
  const t = useT();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const sparesFetch = useFetch<{ items: SpareOption[] }>(editable && vesselCode ? `/app/pms/spares?vesselCode=${encodeURIComponent(vesselCode)}` : null, [editable, vesselCode]);
  const inRequest = new Set(items.map(i => i.spareId));
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (sparesFetch.data?.items ?? [])
      .filter(s => s.status === "ACTIVE" && !inRequest.has(s.id))
      .filter(s => !q || textMatches(s.sku, q) || textMatches(s.name, q) || textMatches(s.manufacturerPartNumber, q))
      .slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparesFetch.data, search, items]);

  const add = async (s: SpareOption) => {
    setAdding(true); setOpen(false); setSearch("");
    try {
      await api.post(`/app/pms/spare-requests/${requestId}/items`, { spareId: s.id, description: s.name, quantity: 1, unit: s.unit });
      onAdded();
    } catch (e) { onError(e instanceof ApiError ? e.message : t("srq.err.save")); }
    finally { setAdding(false); }
  };

  return (
    <div className="rounded-xl border border-fg/10 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-fg/5">
          <tr className="text-[10px] uppercase tracking-wider text-fg/50">
            <th className="px-3 py-2 text-left">{t("sp.v23.col.spare")}</th>
            <th className="px-3 py-2 text-left">{t("srq.col.partNumber")}</th>
            <th className="px-3 py-2 text-right">{t("sp.batch.onBoard")}</th>
            <th className="px-3 py-2 text-right">{t("sp.batch.quantity")}{editable && <RequiredMark />}</th>
            {editable && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr><td colSpan={editable ? 5 : 4} className="px-3 py-5 text-center text-fg/40">{t("srq.noItems")}</td></tr>
          )}
          {items.map(it => (
            <tr key={it.id} className="border-t border-fg/5">
              <td className="px-3 py-2">
                <div className="font-semibold text-fg">{it.itemLabel}</div>
                <div className="text-[10.5px] text-fg/50">
                  {it.spareSku && <span className="font-mono">{it.spareSku}</span>}
                  {it.equipment && <span> · {it.equipment}</span>}
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-fg/70">{it.partNumber ?? "—"}</td>
              <td className="px-3 py-2 text-right text-fg/70">{it.onHand ?? "—"}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {editable ? (
                  <input type="number" min={0} step="any" value={qtyDraft[it.id] ?? String(it.quantity)}
                    onChange={e => setQtyDraft(q => ({ ...q, [it.id]: e.target.value }))}
                    onBlur={() => onSaveQty(it)}
                    className="w-16 rounded-md border border-fg/10 bg-fg/5 px-2 py-1 text-right text-xs text-fg focus:outline-none focus:border-accent/50" />
                ) : <b>{it.quantity}</b>}
                <span className="ml-1 text-fg/50">{it.unit}</span>
              </td>
              {editable && (
                <td className="px-2 py-2 text-right">
                  <button type="button" onClick={() => onRemove(it)} title={t("sp.batch.remove")} className="rounded p-1 text-red-600 hover:bg-red-500/10">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div className="relative border-t border-fg/10 px-3 py-2">
          <div className="flex items-center gap-2">
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <Plus className="w-3.5 h-3.5 text-accent" />}
            <input value={search} onChange={e => { setSearch(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={t("srq.addPh")}
              className="w-full bg-transparent text-xs text-fg placeholder-fg/40 focus:outline-none" />
          </div>
          {open && (
            <div className="absolute left-2 right-2 bottom-full mb-1 z-20 max-h-56 overflow-y-auto rounded-xl border border-fg/10 bg-surface shadow-xl">
              {options.length === 0
                ? <p className="px-3 py-2 text-xs text-fg/40">{t("srq.noResults")}</p>
                : options.map(s => (
                  <button key={s.id} type="button" onMouseDown={() => void add(s)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-fg/5">
                    <span className="flex-1 text-fg">{s.name} <span className="font-mono text-fg/45">{s.sku}</span></span>
                    <span className={`shrink-0 text-[10px] ${s.available <= 0 ? "text-red-700 dark:text-red-400 font-semibold" : "text-fg/45"}`}>
                      {t("sp.batch.onBoard")}: {s.available} {s.unit}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const SpareRequestsPage: React.FC = () => {
  const t = useT();
  const can = useCan();
  const { vessels } = useVesselContext();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "");
  const [priorityFilter, setPriorityFilter] = useState(searchParams.get("priority") ?? "");
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<string | "new" | null>(null);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (priorityFilter) p.set("priority", priorityFilter);
    const qs = p.toString();
    return `/app/pms/spare-requests${qs ? `?${qs}` : ""}`;
  }, [statusFilter, priorityFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();
  const vesselName = (code: string | null) => (code ? vessels.find(v => v.code === code)?.name ?? code : "—");
  const rows = useMemo(() => {
    const base = applyTmsaFilter(data?.items ?? null, tmsaFilter, r => r.id) ?? [];
    const q = searchText.trim().toLowerCase();
    if (!q) return base;
    return base.filter(r => textMatches(r.requestCode, q) || textMatches(vesselName(r.requestedForVesselCode), q)
      || textMatches(r.requestedByName, q) || textMatches(r.notes, q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tmsaFilter, searchText, vessels]);

  const COLUMNS: Column<SpareRequest>[] = [
    { key: "requestCode", header: t("col.code"), sortValue: r => r.requestCode, render: r => <span className="font-mono font-bold text-fg text-xs">{r.requestCode}</span> },
    { key: "vessel", header: t("sp.forms.vessel"), sortValue: r => vesselName(r.requestedForVesselCode), render: r => <span className="text-xs">{vesselName(r.requestedForVesselCode)}</span> },
    { key: "status", header: t("col.status"), sortValue: r => r.status, render: r => <StatusBadge status={r.status} /> },
    { key: "priority", header: t("col.priority"), sortValue: r => PRIORITIES.indexOf(r.priority as typeof PRIORITIES[number]), render: r => <span className={`text-xs font-semibold ${PRIORITY_COLORS[r.priority] ?? ""}`}>{t(`sp.batch.prio.${r.priority}` as TranslationKey)}</span> },
    { key: "items", header: t("srq.col.items"), sortValue: r => r.items?.length ?? 0, render: r => <span className="text-xs text-fg/60">{r.items?.length ?? 0}</span> },
    { key: "requestedBy", header: t("srq.col.requestedBy"), sortValue: r => r.requestedByName ?? "", render: r => <span className="text-xs text-fg/70">{r.requestedByName ?? "—"}</span> },
    { key: "sentAt", header: t("srq.col.sent"), sortValue: r => r.sentAt ?? "", render: r => <span className="text-xs text-fg/60">{r.sentAt ? fmtDate(r.sentAt) : "—"}</span> },
  ];

  const selCls = "bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50";

  return (
    <div className="space-y-4">
      {selected && (
        <SpareRequestModal
          key={selected}
          requestId={selected === "new" ? null : selected}
          onClose={() => setSelected(null)}
          onChanged={() => void reload()}
        />
      )}

      <PageHeader icon={ClipboardList} title={t("srq.title")} total={rows.length} onReload={reload}>
        <ExportExcelButton module="spare_requests" />
        {can("spareRequest.manage") && (
          <button onClick={() => setSelected("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-xs font-bold hover:brightness-110">
            <Plus className="w-3.5 h-3.5" /> {t("srq.new")}
          </button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <select value={toFilterSelectValue(statusFilter)} onChange={e => setStatusFilter(fromFilterSelectValue(e.target.value))} className={selCls}>
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          {STATUSES.map(s => <option key={s} value={s}>{t(`srq.status.${s}` as TranslationKey)}</option>)}
        </select>
        <select value={toFilterSelectValue(priorityFilter)} onChange={e => setPriorityFilter(fromFilterSelectValue(e.target.value))} className={selCls}>
          <option value={FILTER_ALL_VALUE}>{t("srq.allPriorities")}</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{t(`sp.batch.prio.${p}` as TranslationKey)}</option>)}
        </select>
        <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={t("srq.searchPh")} className={`${selCls} flex-1 min-w-[12rem]`} />
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={rows.length} total={data?.items?.length ?? 0} />
      <DataTable
        columns={COLUMNS}
        data={rows}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("srq.empty")}
        onRowClick={r => setSelected(r.id)}
      />
    </div>
  );
};
