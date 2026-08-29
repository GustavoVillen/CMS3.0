// Especificación de Varada — TMSA 4.2.4 y 4.4.2.
//
// El buque arma la lista de trabajos (a mano o importando diferimientos,
// defectos y OT pendientes), la envía a tierra, la superintendencia comenta
// trabajo por trabajo, acepta o descarta cada línea y aprueba el documento.
//
// Patrón de pantalla: espeja VoyageTankReports (lista + drawer a pantalla
// completa con grilla de líneas editable).

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Anchor, Check, Download, Loader2, MessageSquare, Plus, Send, Trash2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { VesselLabel } from "../components/EntityLabels";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { downloadAuthedFile } from "../lib/authed-media";
import { useDeepLink } from "../lib/deep-link";
import { fmtDate } from "../lib/utils";
import { useT, type TranslationKey } from "../lib/i18n";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface DrydockSpec {
  id: string;
  vesselCode: string;
  specCode: string;
  title: string;
  status: string;
  shipyardName?: string | null;
  port?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  scopeSummary?: string | null;
  submittedByName?: string | null;
  submittedAt?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectedReason?: string | null;
  itemCount?: number;
  acceptedCount?: number;
  createdAt: string;
}

interface SpecComment {
  id: string;
  body: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

interface SpecItem {
  id: string;
  itemNo: number;
  category: string;
  title: string;
  description?: string | null;
  assetId?: string | null;
  assetName?: string | null;
  priority?: string | null;
  classRelated: boolean;
  proposedByVessel: boolean;
  itemStatus: string;
  decisionNotes?: string | null;
  sourceType: string;
  sourceId?: string | null;
  comments: SpecComment[];
}

interface FullSpec extends DrydockSpec {
  vesselName: string;
  items: SpecItem[];
}

interface ListResponse { items: DrydockSpec[]; total: number }

interface Candidate {
  sourceType: "DEFERRAL" | "DEFECT" | "WORK_ORDER";
  id: string;
  code: string;
  title: string;
  description?: string | null;
  assetName?: string | null;
  priority?: string | null;
  status: string;
  date?: string | null;
  /** Sólo diferimientos: el buque declaró que el trabajo va a la varada. */
  toNextDrydock?: boolean;
}

interface CandidatesResponse {
  deferrals: Candidate[];
  defects: Candidate[];
  workOrders: Candidate[];
}

// ─── Constantes ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  "HULL_STRUCTURE", "MACHINERY", "ELECTRICAL", "PIPING_VALVES", "TANKS",
  "SAFETY_EQUIPMENT", "CLASS_STATUTORY", "PAINTING", "OTHER",
] as const;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Estados en los que el documento ya no se edita (espejo del backend). */
const FROZEN = ["APPROVED", "CANCELLED"];

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-lg px-2 py-1.5 text-xs text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-50";
const inputSm  = "w-full bg-fg/5 border border-fg/10 rounded-md px-1.5 py-1 text-[11px] text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-50";
const labelCls = "block text-[10px] font-semibold text-text-industrial/60 uppercase tracking-wider";
const btnCls   = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40";

// Fila de trabajo en edición: todo string, para inputs controlados.
interface ItemRow {
  id: string | null;
  category: string;
  title: string;
  description: string;
  priority: string;
  classRelated: boolean;
  // Sólo lectura — vienen del backend y no se editan en la grilla.
  itemNo: number;
  itemStatus: string;
  sourceType: string;
  assetName: string | null;
  proposedByVessel: boolean;
  comments: SpecComment[];
}

function toRow(i: SpecItem): ItemRow {
  return {
    id: i.id,
    category: i.category,
    title: i.title,
    description: i.description ?? "",
    priority: i.priority ?? "",
    classRelated: i.classRelated,
    itemNo: i.itemNo,
    itemStatus: i.itemStatus,
    sourceType: i.sourceType,
    assetName: i.assetName ?? null,
    proposedByVessel: i.proposedByVessel,
    comments: i.comments ?? [],
  };
}

// ─── Sub-modal: importar del backlog ────────────────────────────────────────

const ImportModal: React.FC<{
  specId: string;
  onClose: () => void;
  onImported: (items: SpecItem[]) => void;
}> = ({ specId, onClose, onImported }) => {
  const t = useT();
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<CandidatesResponse>(`/app/pms/drydock-specs/${specId}/candidates`);
        setData(res);
        // Lo que el buque ya declaró "a varada" viene pretildado: el trabajo de
        // acá es revisarlo, no volver a buscarlo uno por uno.
        setSelected(new Set(
          (res.deferrals ?? []).filter(c => c.toNextDrydock).map(c => `${c.sourceType}:${c.id}`),
        ));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("dds.loadError"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specId]);

  const all: Candidate[] = useMemo(() => {
    if (!data) return [];
    // Los marcados a varada van arriba dentro de su grupo.
    const deferrals = data.deferrals.slice().sort(
      (a, b) => Number(b.toNextDrydock ?? false) - Number(a.toNextDrydock ?? false),
    );
    return [...deferrals, ...data.defects, ...data.workOrders];
  }, [data]);

  const toggle = (key: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const doImport = async () => {
    if (selected.size === 0) return;
    setBusy(true); setError(null);
    try {
      const sources = [...selected].map(k => {
        const [type, ...rest] = k.split(":");
        return { type: type!, id: rest.join(":") };
      });
      const res = await api.post<{ items: SpecItem[] }>(`/app/pms/drydock-specs/${specId}/items/import`, { sources });
      onImported(res.items);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-fg/10 shrink-0">
          <div>
            <h2 className="text-base font-bold text-fg">{t("dds.importTitle")}</h2>
            <p className="text-[10px] text-text-industrial/50 mt-0.5 max-w-2xl">{t("dds.importHint")}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!data && !error && (
            <div className="flex items-center justify-center py-10 text-text-industrial/50">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {data && all.length === 0 && (
            <p className="text-xs text-text-industrial/50 py-8 text-center">{t("dds.importEmpty")}</p>
          )}
          {data && all.length > 0 && (["DEFERRAL", "DEFECT", "WORK_ORDER"] as const).map(group => {
            const rows = all.filter(c => c.sourceType === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} className="space-y-2">
                <h3 className="text-[11px] font-bold text-accent uppercase tracking-wider">
                  {t(`dds.src.${group}` as TranslationKey)} ({rows.length})
                </h3>
                <div className="border border-fg/10 rounded-xl divide-y divide-fg/10">
                  {rows.map(c => {
                    const key = `${c.sourceType}:${c.id}`;
                    return (
                      <label key={key} className="flex items-start gap-3 px-3 py-2 hover:bg-fg/5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(key)}
                          className="mt-0.5 accent-accent"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-fg">{c.code}</span>
                            <span className="text-xs text-fg truncate">{c.title}</span>
                            <StatusBadge status={c.status} />
                            {c.toNextDrydock && (
                              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20">
                                {t("dds.markedForDrydock")}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-text-industrial/50 mt-0.5">
                            {[c.assetName, c.date ? fmtDate(c.date) : null].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-fg/10 shrink-0">
          <button onClick={onClose} className={`${btnCls} border border-fg/10 text-fg hover:bg-fg/5`}>
            {t("common.cancel")}
          </button>
          <button
            onClick={() => { void doImport(); }}
            disabled={busy || selected.size === 0}
            className={`${btnCls} bg-accent text-accent-fg hover:brightness-110`}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {t("dds.importSelected")} {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};

// ─── Drawer de detalle ──────────────────────────────────────────────────────

const DrydockSpecDrawer: React.FC<{
  spec: DrydockSpec | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ spec, onClose, onSaved }) => {
  const t = useT();
  const can = useCan();
  const { vessels } = useVesselContext();
  const canApprove = can("drydock.approve");

  const [live, setLive] = useState<DrydockSpec | null>(spec);
  const isNew = live === null;
  const frozen = !isNew && FROZEN.includes(live!.status);

  // Cabecera
  const [newVesselCode, setNewVesselCode] = useState("");
  const [title, setTitle] = useState(spec?.title ?? "");
  const [shipyardName, setShipyardName] = useState(spec?.shipyardName ?? "");
  const [port, setPort] = useState(spec?.port ?? "");
  const [plannedStartDate, setPlannedStartDate] = useState(spec?.plannedStartDate?.slice(0, 10) ?? "");
  const [plannedEndDate, setPlannedEndDate] = useState(spec?.plannedEndDate?.slice(0, 10) ?? "");
  const [scopeSummary, setScopeSummary] = useState(spec?.scopeSummary ?? "");

  // Líneas y conversación
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [vesselName, setVesselName] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const applyFull = (full: FullSpec) => {
    setLive(full);
    setVesselName(full.vesselName);
    setRows((full.items ?? []).map(toRow));
    setTitle(full.title);
    setShipyardName(full.shipyardName ?? "");
    setPort(full.port ?? "");
    setPlannedStartDate(full.plannedStartDate?.slice(0, 10) ?? "");
    setPlannedEndDate(full.plannedEndDate?.slice(0, 10) ?? "");
    setScopeSummary(full.scopeSummary ?? "");
  };

  const loadFull = async (id: string) => {
    try {
      applyFull(await api.get<FullSpec>(`/app/pms/drydock-specs/${id}/full`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("dds.loadError"));
    }
  };

  useEffect(() => {
    if (!isNew && live) void loadFull(live.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedItem = rows.find(r => r.id === selectedItemId) ?? null;

  const updateRow = (idx: number, patch: Partial<ItemRow>) =>
    setRows(rs => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows(rs => [...rs, {
      id: null, category: "OTHER", title: "", description: "", priority: "",
      classRelated: false, itemNo: rs.length + 1, itemStatus: "PROPOSED",
      sourceType: "MANUAL", assetName: null, proposedByVessel: true, comments: [],
    }]);

  const removeRow = (idx: number) => {
    const row = rows[idx];
    if (row?.id && row.id === selectedItemId) setSelectedItemId(null);
    setRows(rs => rs.filter((_, i) => i !== idx));
  };

  const headerPayload = () => ({
    title: title.trim(),
    shipyardName: shipyardName.trim() || null,
    port: port.trim() || null,
    plannedStartDate: plannedStartDate || null,
    plannedEndDate: plannedEndDate || null,
    scopeSummary: scopeSummary.trim() || null,
  });

  const save = async () => {
    if (!title.trim()) { setError(t("dds.titleRequired")); return; }
    if (isNew && !newVesselCode) { setError(t("dds.vesselRequired")); return; }
    if (rows.some(r => !r.title.trim())) { setError(t("dds.itemTitleRequired")); return; }

    setSaving(true); setError(null); setSavedMsg(null);
    try {
      if (isNew) {
        const created = await api.post<DrydockSpec>("/app/pms/drydock-specs", {
          vesselCode: newVesselCode,
          ...headerPayload(),
        });
        setLive(created);
        await loadFull(created.id);
      } else {
        await api.patch(`/app/pms/drydock-specs/${live!.id}`, headerPayload());
        await api.put(`/app/pms/drydock-specs/${live!.id}/items`, {
          entries: rows.map(r => ({
            id: r.id,
            category: r.category,
            title: r.title.trim(),
            description: r.description.trim() || null,
            priority: r.priority || null,
            classRelated: r.classRelated,
          })),
        });
        await loadFull(live!.id);
      }
      setSavedMsg(t("dds.saved"));
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const transition = async (next: string, extra: Record<string, unknown> = {}) => {
    if (!live) return;
    setBusyAction(true); setError(null);
    try {
      await api.post(`/app/pms/drydock-specs/${live.id}/transition`, { status: next, ...extra });
      await loadFull(live.id);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusyAction(false);
    }
  };

  const decide = async (itemId: string, itemStatus: string) => {
    setBusyAction(true); setError(null);
    try {
      await api.patch(`/app/pms/drydock-specs/items/${itemId}/decision`, { itemStatus });
      setRows(rs => rs.map(r => (r.id === itemId ? { ...r, itemStatus } : r)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusyAction(false);
    }
  };

  const sendComment = async () => {
    if (!selectedItemId || !commentDraft.trim()) return;
    setBusyAction(true); setError(null);
    try {
      const created = await api.post<SpecComment>(
        `/app/pms/drydock-specs/items/${selectedItemId}/comments`,
        { body: commentDraft.trim() },
      );
      setRows(rs => rs.map(r => (r.id === selectedItemId ? { ...r, comments: [...r.comments, created] } : r)));
      setCommentDraft("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusyAction(false);
    }
  };

  const downloadPdf = async () => {
    if (!live) return;
    setBusyAction(true); setError(null);
    try {
      await downloadAuthedFile(`/app/pms/drydock-specs/${live.id}/pdf`, `${live.specCode}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.saveError"));
    } finally {
      setBusyAction(false);
    }
  };

  // Acciones de estado disponibles según en qué punto del circuito está.
  const status = live?.status ?? "DRAFT";
  const showSubmit  = !isNew && status === "DRAFT";
  const showReview  = !isNew && status === "SUBMITTED" && canApprove;
  const showDecide  = !isNew && status === "UNDER_REVIEW" && canApprove;
  const showToDraft = !isNew && (status === "REJECTED" || status === "SUBMITTED");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full h-full bg-surface dark:bg-[#0D1B2A] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-fg/10 shrink-0">
          <div className="min-w-0">
            {isNew ? (
              <h2 className="text-base font-bold text-fg">{t("dds.newTitle")}</h2>
            ) : (
              <>
                <h2 className="text-base font-bold text-fg truncate">
                  {vesselName ?? live!.vesselCode} · {live!.title}
                </h2>
                <p className="text-[10px] text-text-industrial/40">
                  {live!.specCode} · {t(`dds.status.${live!.status}` as TranslationKey)}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {savedMsg && <span className="text-[11px] text-emerald-500 font-semibold">{savedMsg}</span>}
            {/* Si la spec se creó dentro de este panel, el padre sigue con
                detail="new": hay que refrescar la lista Y cerrar. Antes sólo
                refrescaba y la X quedaba muerta. */}
            <ModalCloseButton onClose={() => { if (spec === null && live !== null) onSaved(); onClose(); }} />
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {frozen && (
            <p className="text-[11px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              {t("dds.frozen")}
            </p>
          )}

          {/* ── Cabecera ── */}
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {isNew && (
              <div className="space-y-1.5">
                <label className={labelCls}>{t("col.vessel")} *</label>
                <select value={newVesselCode} onChange={e => setNewVesselCode(e.target.value)} className={inputCls}>
                  <option value="">{t("common.select")}</option>
                  {vessels.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5 md:col-span-2">
              <label className={labelCls}>{t("dds.title")} *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} disabled={frozen} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("dds.shipyard")}</label>
              <input value={shipyardName} onChange={e => setShipyardName(e.target.value)} disabled={frozen} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("dds.port")}</label>
              <input value={port} onChange={e => setPort(e.target.value)} disabled={frozen} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("dds.plannedStart")}</label>
              <input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} disabled={frozen} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>{t("dds.plannedEnd")}</label>
              <input type="date" value={plannedEndDate} onChange={e => setPlannedEndDate(e.target.value)} disabled={frozen} className={inputCls} />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <label className={labelCls}>{t("dds.scopeSummary")}</label>
              <AutoTextArea value={scopeSummary} onChange={e => setScopeSummary(e.target.value)} disabled={frozen} rows={2} className={inputCls} />
            </div>
          </section>

          {/* ── Trabajos ── */}
          {!isNew && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-bold text-fg uppercase tracking-wider">
                  {t("dds.items")} ({rows.length})
                </h3>
                {!frozen && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowImport(true)} className={`${btnCls} border border-fg/10 text-fg hover:bg-fg/5`}>
                      <Download className="w-3.5 h-3.5" />
                      {t("dds.importBacklog")}
                    </button>
                    <button onClick={addRow} className={`${btnCls} border border-fg/10 text-fg hover:bg-fg/5`}>
                      <Plus className="w-3.5 h-3.5" />
                      {t("dds.addItem")}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
                {/* Grilla de líneas */}
                <div className="overflow-x-auto border border-fg/10 rounded-xl">
                  <table className="w-full text-[11px]">
                    <thead className="bg-fg/5 text-text-industrial/60">
                      <tr>
                        <th className="px-2 py-1.5 text-left w-8">#</th>
                        <th className="px-2 py-1.5 text-left w-32">{t("dds.category")}</th>
                        <th className="px-2 py-1.5 text-left">{t("dds.itemTitle")}</th>
                        <th className="px-2 py-1.5 text-left w-24">{t("dds.priority")}</th>
                        <th className="px-2 py-1.5 text-center w-12">{t("dds.classRelated")}</th>
                        <th className="px-2 py-1.5 text-left w-28">{t("col.status")}</th>
                        <th className="px-2 py-1.5 w-16" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-fg/10">
                      {rows.map((r, i) => (
                        <tr
                          key={r.id ?? `new-${i}`}
                          className={`align-top ${r.id === selectedItemId ? "bg-accent/10" : "hover:bg-fg/5"}`}
                        >
                          <td className="px-2 py-1.5 text-text-industrial/50">{i + 1}</td>
                          <td className="px-2 py-1.5">
                            <select
                              value={r.category}
                              onChange={e => updateRow(i, { category: e.target.value })}
                              disabled={frozen}
                              className={inputSm}
                            >
                              {CATEGORIES.map(c => (
                                <option key={c} value={c}>{t(`dds.cat.${c}` as TranslationKey)}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 space-y-1">
                            <input
                              value={r.title}
                              onChange={e => updateRow(i, { title: e.target.value })}
                              disabled={frozen}
                              placeholder={t("dds.itemTitle")}
                              className={inputSm}
                            />
                            <input
                              value={r.description}
                              onChange={e => updateRow(i, { description: e.target.value })}
                              disabled={frozen}
                              placeholder={t("dds.itemDescription")}
                              className={inputSm}
                            />
                            <div className="flex items-center gap-1.5 text-[9px] text-text-industrial/40">
                              <span>{t(`dds.src.${r.sourceType}` as TranslationKey)}</span>
                              <span>·</span>
                              <span>{r.proposedByVessel ? t("dds.proposedByVessel") : t("dds.proposedByShore")}</span>
                              {r.assetName && <><span>·</span><span className="truncate">{r.assetName}</span></>}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={r.priority}
                              onChange={e => updateRow(i, { priority: e.target.value })}
                              disabled={frozen}
                              className={inputSm}
                            >
                              <option value="">—</option>
                              {PRIORITIES.map(p => (
                                <option key={p} value={p}>{t(`dds.prio.${p}` as TranslationKey)}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={r.classRelated}
                              onChange={e => updateRow(i, { classRelated: e.target.checked })}
                              disabled={frozen}
                              title={t("dds.classRelatedFull")}
                              className="accent-accent"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <StatusBadge status={r.itemStatus} label={t(`dds.item.${r.itemStatus}` as TranslationKey)} />
                            {r.id && canApprove && !frozen && (
                              <div className="flex items-center gap-1 mt-1">
                                {r.itemStatus !== "ACCEPTED" && (
                                  <button
                                    onClick={() => { void decide(r.id!, "ACCEPTED"); }}
                                    title={t("dds.accept")}
                                    className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                )}
                                {r.itemStatus !== "REJECTED" && (
                                  <button
                                    onClick={() => { void decide(r.id!, "REJECTED"); }}
                                    title={t("dds.discard")}
                                    className="p-1 rounded text-rose-500 hover:bg-rose-500/10"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              {r.id && (
                                <button
                                  onClick={() => { setSelectedItemId(r.id); setCommentDraft(""); }}
                                  title={t("dds.comments")}
                                  className="p-1 rounded text-accent hover:bg-accent/10 relative"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  {r.comments.length > 0 && (
                                    <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-accent text-accent-fg rounded-full w-3.5 h-3.5 flex items-center justify-center">
                                      {r.comments.length}
                                    </span>
                                  )}
                                </button>
                              )}
                              {!frozen && (
                                <button
                                  onClick={() => removeRow(i)}
                                  title={t("common.delete")}
                                  className="p-1 rounded text-rose-500 hover:bg-rose-500/10"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Conversación buque ↔ tierra sobre el trabajo elegido */}
                <div className="border border-fg/10 rounded-xl p-3 flex flex-col gap-2 min-h-[200px]">
                  <h4 className="text-[11px] font-bold text-fg uppercase tracking-wider">
                    {t("dds.commentsFor")}
                  </h4>
                  {!selectedItem && (
                    <p className="text-[11px] text-text-industrial/50 py-6 text-center">{t("dds.selectItemHint")}</p>
                  )}
                  {selectedItem && (
                    <>
                      <p className="text-[11px] font-semibold text-fg line-clamp-2">
                        #{selectedItem.itemNo} · {selectedItem.title}
                      </p>
                      <div className="flex-1 overflow-y-auto space-y-2 max-h-64">
                        {selectedItem.comments.length === 0 && (
                          <p className="text-[11px] text-text-industrial/40">{t("dds.commentsEmpty")}</p>
                        )}
                        {selectedItem.comments.map(c => (
                          <div key={c.id} className="bg-fg/5 rounded-lg px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2 text-[9px] text-text-industrial/50">
                              <span className="font-semibold truncate">{c.authorName}</span>
                              <span>{fmtDate(c.createdAt)}</span>
                            </div>
                            <p className="text-[11px] text-fg mt-0.5 whitespace-pre-wrap">{c.body}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-end gap-2">
                        <AutoTextArea
                          value={commentDraft}
                          onChange={e => setCommentDraft(e.target.value)}
                          rows={2}
                          placeholder={t("dds.commentPlaceholder")}
                          className={inputSm}
                        />
                        <button
                          onClick={() => { void sendComment(); }}
                          disabled={busyAction || !commentDraft.trim()}
                          title={t("dds.commentSend")}
                          className={`${btnCls} bg-accent text-accent-fg hover:brightness-110 shrink-0`}
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Trazabilidad ── */}
          {!isNew && (live!.submittedByName || live!.approvedByName || live!.rejectedReason) && (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
              {live!.submittedByName && (
                <div className="bg-fg/5 rounded-lg px-3 py-2">
                  <p className={labelCls}>{t("dds.submittedBy")}</p>
                  <p className="text-fg mt-0.5">{live!.submittedByName} · {fmtDate(live!.submittedAt)}</p>
                </div>
              )}
              {live!.approvedByName && (
                <div className="bg-fg/5 rounded-lg px-3 py-2">
                  <p className={labelCls}>{t("dds.approvedBy")}</p>
                  <p className="text-fg mt-0.5">{live!.approvedByName} · {fmtDate(live!.approvedAt)}</p>
                </div>
              )}
              {live!.rejectedReason && (
                <div className="bg-fg/5 rounded-lg px-3 py-2">
                  <p className={labelCls}>{t("dds.rejectReason")}</p>
                  <p className="text-fg mt-0.5 whitespace-pre-wrap">{live!.rejectedReason}</p>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-6 py-3 border-t border-fg/10 shrink-0 flex-wrap">
          <div className="flex items-center gap-2">
            {!isNew && (
              <button onClick={() => { void downloadPdf(); }} disabled={busyAction} className={`${btnCls} border border-fg/10 text-fg hover:bg-fg/5`}>
                <Download className="w-3.5 h-3.5" />
                PDF
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {showToDraft && (
              <button onClick={() => { void transition("DRAFT"); }} disabled={busyAction} className={`${btnCls} border border-fg/10 text-fg hover:bg-fg/5`}>
                {t("dds.backToDraft")}
              </button>
            )}
            {showSubmit && (
              <button onClick={() => { void transition("SUBMITTED"); }} disabled={busyAction} className={`${btnCls} bg-sky-600 text-white hover:brightness-110`}>
                <Send className="w-3.5 h-3.5" />
                {t("dds.submit")}
              </button>
            )}
            {showReview && (
              <button onClick={() => { void transition("UNDER_REVIEW"); }} disabled={busyAction} className={`${btnCls} bg-amber-600 text-white hover:brightness-110`}>
                {t("dds.startReview")}
              </button>
            )}
            {showDecide && (
              <>
                <button onClick={() => setRejectOpen(true)} disabled={busyAction} className={`${btnCls} border border-rose-500/40 text-rose-500 hover:bg-rose-500/10`}>
                  {t("dds.reject")}
                </button>
                <button onClick={() => { void transition("APPROVED"); }} disabled={busyAction} className={`${btnCls} bg-emerald-600 text-white hover:brightness-110`}>
                  <Check className="w-3.5 h-3.5" />
                  {t("dds.approve")}
                </button>
              </>
            )}
            {!frozen && (
              <button onClick={() => { void save(); }} disabled={saving} className={`${btnCls} bg-accent text-accent-fg hover:brightness-110`}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>

      {showImport && live && (
        <ImportModal
          specId={live.id}
          onClose={() => setShowImport(false)}
          onImported={items => setRows(items.map(toRow))}
        />
      )}

      {/* Devolver al buque: el motivo es obligatorio, es la respuesta que lee el buque. */}
      {rejectOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-fg">{t("dds.reject")}</h3>
              <ModalCloseButton onClose={() => setRejectOpen(false)} />
            </div>
            <label className={labelCls}>{t("dds.rejectReason")} *</label>
            <AutoTextArea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={4} className={inputCls} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejectOpen(false)} className={`${btnCls} border border-fg/10 text-fg hover:bg-fg/5`}>
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  if (!rejectReason.trim()) { setError(t("dds.rejectReasonRequired")); return; }
                  setRejectOpen(false);
                  void transition("REJECTED", { rejectedReason: rejectReason.trim() });
                }}
                className={`${btnCls} bg-rose-600 text-white hover:brightness-110`}
              >
                {t("dds.reject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};

// ─── Página ─────────────────────────────────────────────────────────────────

export const DrydockSpecsPage: React.FC = () => {
  const t = useT();
  const can = useCan();
  const [searchParams] = useSearchParams();
  const vesselFilter = searchParams.get("vesselCode") ?? "";
  const { code, open, close } = useDeepLink("/drydock-specs");

  const params = new URLSearchParams();
  if (vesselFilter) params.set("vesselCode", vesselFilter);
  const path = `/app/pms/drydock-specs${params.size ? `?${params}` : ""}`;

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [vesselFilter]);
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();
  const tmsaItems = useMemo(() => applyTmsaFilter(data?.items ?? null, tmsaFilter, r => r.id), [data, tmsaFilter]);
  const [detail, setDetail] = useState<DrydockSpec | null | "new">(null);

  // El deep-link manda: /drydock-specs/VAR-XXX abre ese documento.
  useEffect(() => {
    if (!code) { if (detail !== "new") setDetail(null); return; }
    if (detail && detail !== "new" && detail.specCode === code) return;
    const match = data?.items?.find(s => s.specCode === code);
    if (match) setDetail(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, data]);

  useCopilotEmitter(!detail ? { module: "DRYDOCK_SPECS", screen: "DRYDOCK_SPEC_LIST" } : {
    module: "DRYDOCK_SPECS",
    screen: detail === "new" ? "DRYDOCK_SPEC_CREATE" : "DRYDOCK_SPEC_EDIT",
    entityId: detail !== "new" ? detail.id : undefined,
    entityCode: detail !== "new" ? detail.specCode : undefined,
    vesselCode: detail !== "new" ? detail.vesselCode : undefined,
    workflowStage: detail !== "new" ? detail.status : undefined,
  });

  // Armar la spec la puede cualquier rol operativo; el sólo-lectura no.
  const canManage = can("wo.operate") || can("wo.manage") || can("drydock.approve");

  const COLUMNS: Column<DrydockSpec>[] = [
    { key: "specCode", header: t("dds.specCode"), render: r => <span className="font-mono font-bold text-fg text-xs">{r.specCode}</span> },
    { key: "vesselCode", header: t("col.vessel"), render: r => <VesselLabel code={r.vesselCode} className="text-xs" showCode /> },
    { key: "title", header: t("dds.title"), render: r => <span className="text-xs text-fg line-clamp-1">{r.title}</span> },
    { key: "shipyardName", header: t("dds.shipyard"), render: r => <span className="text-xs text-text-industrial/60">{r.shipyardName ?? "—"}</span> },
    { key: "plannedStartDate", header: t("dds.plannedStart"), render: r => <span className="text-xs text-text-industrial/60">{r.plannedStartDate ? fmtDate(r.plannedStartDate) : "—"}</span> },
    {
      key: "itemCount", header: t("dds.itemCount"),
      render: r => (
        <span className="text-xs text-text-industrial/60">
          {r.acceptedCount ?? 0}/{r.itemCount ?? 0}
        </span>
      ),
    },
    { key: "status", header: t("col.status"), render: r => <StatusBadge status={r.status} label={t(`dds.status.${r.status}` as TranslationKey)} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={Anchor} title={t("page.drydockSpecs")} total={data?.total} onReload={reload}>
        <ExportExcelButton module="drydock_specs" filters={{ vesselCode: vesselFilter }} />
        {canManage && (
          <button onClick={() => setDetail("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-xs font-bold hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" />
            {t("dds.new")}
          </button>
        )}
      </PageHeader>

      <TmsaFilterBanner filter={tmsaFilter} shown={tmsaItems?.length ?? 0} total={data?.items?.length ?? 0} />

      <DataTable
        columns={COLUMNS}
        data={tmsaItems}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.drydockSpecs")}
        onRowClick={r => { setDetail(r); open(r.specCode); }}
      />

      {detail !== null && (
        <DrydockSpecDrawer
          spec={detail === "new" ? null : detail}
          onClose={() => { setDetail(null); if (code) close(); }}
          onSaved={() => { reload(); }}
        />
      )}
    </div>
  );
};
