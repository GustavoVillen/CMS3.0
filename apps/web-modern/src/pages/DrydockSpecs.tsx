// Especificación de Varada — TMSA 4.2.4 y 4.4.2.
//
// El buque arma la lista de trabajos (a mano o importando diferimientos,
// defectos y OT pendientes), la envía a tierra, la superintendencia la toma,
// acepta o descarta cada trabajo conversando con el buque, y la aprueba o la
// devuelve. Aprobada, sale el PDF para el astillero.
//
// Vista guiada (preview V26): el usuario no conoce el proceso, así que cada
// etapa dice qué toca hacer y quién lo hace.

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Anchor, BadgeCheck, BarChart3, Check, CheckCircle2, ChevronRight, CircleDashed, ClipboardList, Cog, CornerUpLeft, Cylinder, Download, FileDown,
  GitMerge, HelpCircle, History, Hourglass, Inbox, Info, LifeBuoy, Lightbulb, Link2, ListChecks, Loader2, MessageSquare, MessagesSquare, MoreHorizontal,
  Paintbrush, Pencil, Plus, Save, Search, Send, Ship, Trash2, X, Zap,
} from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { AlertDialog } from "../components/AlertDialog";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { GuideField, GuideNeedTag, GuidePill, GuideSection, RequiredMark } from "../components/GuideKit";
import { downloadAuthedFile } from "../lib/authed-media";
import { useDeepLink } from "../lib/deep-link";
import { useEscapeGuard } from "../lib/escape-guard";
import { fmtDate } from "../lib/utils";
import { useT, type TranslationKey } from "../lib/i18n";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useTmsaFilter, applyTmsaFilter, TmsaFilterBanner } from "../lib/tmsa-filter";
import { AutoTextArea } from "../components/AutoTextArea";
import { textMatches } from "../lib/text-search";

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
  reviewStartedAt?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
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
const CAT_ICON: Record<string, typeof Ship> = {
  HULL_STRUCTURE: Ship, MACHINERY: Cog, ELECTRICAL: Zap, PIPING_VALVES: GitMerge, TANKS: Cylinder,
  SAFETY_EQUIPMENT: LifeBuoy, CLASS_STATUTORY: BadgeCheck, PAINTING: Paintbrush, OTHER: MoreHorizontal,
};

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Estados en los que el documento ya no se edita (espejo del backend). */
const FROZEN = ["APPROVED", "CANCELLED"];
/** Enviada o en revisión: sólo tierra modifica el contenido (espejo del backend). */
const SHORE_SIDE = ["SUBMITTED", "UNDER_REVIEW"];

const STATUS_CHIP: Record<string, string> = {
  DRAFT: "border-fg/10 bg-fg/5 text-text-industrial/70",
  SUBMITTED: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  UNDER_REVIEW: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  REJECTED: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  CANCELLED: "border-fg/10 bg-fg/5 text-text-industrial/50",
};

const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
const fl = "flex items-center gap-1.5 text-xs font-semibold text-text-industrial/70 mb-1.5";
const btn = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-45 disabled:cursor-not-allowed";

// Fila de trabajo en edición: todo string, para inputs controlados.
interface ItemRow {
  id: string | null;
  /** Clave estable para las filas nuevas (todavía sin id). */
  key: string;
  category: string;
  title: string;
  description: string;
  priority: string;
  classRelated: boolean;
  // Sólo lectura — vienen del backend y no se editan.
  itemNo: number;
  itemStatus: string;
  sourceType: string;
  assetName: string | null;
  proposedByVessel: boolean;
  comments: SpecComment[];
}

let newRowSeq = 0;
function toRow(i: SpecItem): ItemRow {
  return {
    id: i.id,
    key: i.id,
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

/** Lo editable de la cabecera y los trabajos: sirve para saber si hay cambios sin guardar. */
function editableSnapshot(h: Record<string, string>, rows: ItemRow[]): string {
  return JSON.stringify([h, rows.map(r => [r.id, r.category, r.title, r.description, r.priority, r.classRelated])]);
}

/** Código del registro de origen: la importación lo deja al principio del título ("DEF-… — …"). */
function sourceCodeOf(r: ItemRow): string | null {
  if (r.sourceType === "MANUAL") return null;
  const code = r.title.split(" — ")[0]?.trim();
  return code && /^[A-Z]{2,}-/.test(code) ? code : null;
}
const SOURCE_ROUTE: Record<string, string> = { DEFERRAL: "/deferrals", DEFECT: "/defects", WORK_ORDER: "/work-orders" };

function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  const d = new Date(date.slice(0, 10) + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// ─── Sub-modal: traer pendientes ────────────────────────────────────────────

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
        <div className="flex items-start gap-3 px-5 py-4 border-b border-fg/10 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black text-fg">{t("dds.v26.importTitle")}</h2>
            <p className="text-xs text-text-industrial/60 mt-0.5 max-w-2xl">{t("dds.v26.importHint")}</p>
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
            <p className="text-sm text-text-industrial/50 py-8 text-center">{t("dds.importEmpty")}</p>
          )}
          {data && all.length > 0 && (["DEFERRAL", "DEFECT", "WORK_ORDER"] as const).map(group => {
            const rows = all.filter(c => c.sourceType === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} className="space-y-2">
                <h3 className="text-xs font-extrabold text-fg">
                  {t(`dds.src.${group}` as TranslationKey)} <span className="font-semibold text-text-industrial/50">({rows.length})</span>
                  <span className="block text-[11px] font-normal text-text-industrial/50">{t(`dds.v26.srcHint.${group}` as TranslationKey)}</span>
                </h3>
                <div className="border border-fg/10 rounded-xl divide-y divide-fg/10">
                  {rows.map(c => {
                    const key = `${c.sourceType}:${c.id}`;
                    return (
                      <label key={key} className={`flex items-start gap-3 px-3 py-2 cursor-pointer ${selected.has(key) ? "bg-accent/5" : "hover:bg-fg/5"}`}>
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="mt-0.5 w-4 h-4 accent-accent" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-fg">{c.code}</span>
                            <span className="text-xs text-fg truncate">{c.title}</span>
                            <StatusBadge status={c.status} />
                            {c.toNextDrydock && (
                              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full font-extrabold bg-indigo-500/10 text-indigo-700 dark:text-indigo-400">
                                {t("dds.markedForDrydock")}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-text-industrial/50 mt-0.5">
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
          <button onClick={onClose} className={`${btn} text-text-industrial hover:text-fg`}>{t("common.cancel")}</button>
          <button onClick={() => { void doImport(); }} disabled={busy || selected.size === 0} className={`${btn} bg-accent text-accent-fg hover:brightness-110`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {t("dds.importSelected")} {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
};

// ─── Ventana del documento ──────────────────────────────────────────────────

const DrydockSpecDrawer: React.FC<{
  spec: DrydockSpec | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ spec, onClose, onSaved }) => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const { vessels } = useVesselContext();
  // Tierra: quien puede aprobar la especificación.
  const canApprove = can("drydock.approve");

  const [live, setLive] = useState<DrydockSpec | null>(spec);
  const isNew = live === null;
  const status = live?.status ?? "DRAFT";
  const frozen = !isNew && FROZEN.includes(status);
  // Enviada o en revisión: sólo tierra cambia el contenido; el buque conversa.
  const canEdit = !frozen && (isNew || !SHORE_SIDE.includes(status) || canApprove);
  const canDecide = !isNew && status === "UNDER_REVIEW" && canApprove;

  // Cabecera
  const [newVesselCode, setNewVesselCode] = useState("");
  const [title, setTitle] = useState(spec?.title ?? "");
  const [shipyardName, setShipyardName] = useState(spec?.shipyardName ?? "");
  const [port, setPort] = useState(spec?.port ?? "");
  const [plannedStartDate, setPlannedStartDate] = useState(spec?.plannedStartDate?.slice(0, 10) ?? "");
  const [plannedEndDate, setPlannedEndDate] = useState(spec?.plannedEndDate?.slice(0, 10) ?? "");
  const [scopeSummary, setScopeSummary] = useState(spec?.scopeSummary ?? "");

  // Trabajos y conversación
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [vesselName, setVesselName] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(!isNew);

  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<ItemRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const header = { title, shipyardName, port, plannedStartDate, plannedEndDate, scopeSummary };
  const [baseline, setBaseline] = useState(() => editableSnapshot(header, []));
  const isDirty = canEdit && (isNew ? !!(newVesselCode || title.trim()) : editableSnapshot(header, rows) !== baseline);

  const applyFull = (full: FullSpec) => {
    const h = {
      title: full.title, shipyardName: full.shipyardName ?? "", port: full.port ?? "",
      plannedStartDate: full.plannedStartDate?.slice(0, 10) ?? "", plannedEndDate: full.plannedEndDate?.slice(0, 10) ?? "",
      scopeSummary: full.scopeSummary ?? "",
    };
    const nextRows = (full.items ?? []).map(toRow);
    setLive(full);
    setVesselName(full.vesselName);
    setRows(nextRows);
    setTitle(h.title); setShipyardName(h.shipyardName); setPort(h.port);
    setPlannedStartDate(h.plannedStartDate); setPlannedEndDate(h.plannedEndDate); setScopeSummary(h.scopeSummary);
    setBaseline(editableSnapshot(h, nextRows));
    setSelectedKey(prev => prev ?? nextRows[0]?.key ?? null);
  };

  const loadFull = async (id: string) => {
    try {
      applyFull(await api.get<FullSpec>(`/app/pms/drydock-specs/${id}/full`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("dds.loadError"));
    } finally {
      setLoadingFull(false);
    }
  };

  useEffect(() => {
    if (!isNew && live) void loadFull(live.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRow = rows.find(r => r.key === selectedKey) ?? null;

  const updateRow = (key: string, patch: Partial<ItemRow>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => {
    const key = `new-${++newRowSeq}`;
    setRows(rs => [...rs, {
      id: null, key, category: "OTHER", title: "", description: "", priority: "",
      classRelated: false, itemNo: rs.length + 1, itemStatus: "PROPOSED",
      sourceType: "MANUAL", assetName: null, proposedByVessel: !canApprove, comments: [],
    }]);
    setSelectedKey(key);
  };

  // Quitar un trabajo con conversación o ya decidido borra algo que no se recupera: se pregunta.
  const requestRemove = (row: ItemRow) => {
    if (row.comments.length > 0 || row.itemStatus !== "PROPOSED") { setConfirmRemove(row); return; }
    removeRow(row);
  };
  const removeRow = (row: ItemRow) => {
    if (row.key === selectedKey) setSelectedKey(null);
    setRows(rs => rs.filter(r => r.key !== row.key));
    setConfirmRemove(null);
  };

  const headerPayload = () => ({
    title: title.trim(),
    shipyardName: shipyardName.trim() || null,
    port: port.trim() || null,
    plannedStartDate: plannedStartDate || null,
    plannedEndDate: plannedEndDate || null,
    scopeSummary: scopeSummary.trim() || null,
  });

  /** Guarda cabecera y trabajos. Devuelve false si no se pudo (el aviso ya se mostró). */
  const save = async (quiet = false): Promise<boolean> => {
    if (!title.trim()) { setError(t("dds.titleRequired")); return false; }
    if (isNew && !newVesselCode) { setError(t("dds.vesselRequired")); return false; }
    if (rows.some(r => !r.title.trim())) { setError(t("dds.itemTitleRequired")); return false; }
    if (plannedStartDate && plannedEndDate && plannedEndDate < plannedStartDate) { setError(t("dds.v26.endBeforeStart")); return false; }

    setSaving(true); setError(null); setSavedMsg(null);
    try {
      if (isNew) {
        const created = await api.post<DrydockSpec>("/app/pms/drydock-specs", { vesselCode: newVesselCode, ...headerPayload() });
        setLive(created);
        await loadFull(created.id);
        onSaved();
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
        onSaved();
      }
      if (!quiet) { setSavedMsg(t("dds.saved")); setTimeout(() => setSavedMsg(null), 2500); }
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const transition = async (next: string, extra: Record<string, unknown> = {}) => {
    if (!live) return;
    // Enviar a tierra guarda antes: lo que no se guardó no puede quedar afuera en silencio.
    if (next === "SUBMITTED" && isDirty && !(await save(true))) return;
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

  /** Traer pendientes reemplaza la lista con la de la base: si hay cambios, se guardan primero. */
  const openImport = async () => {
    if (isDirty && !(await save(true))) return;
    setShowImport(true);
  };

  const decide = async (row: ItemRow, itemStatus: string) => {
    if (!row.id) return;
    setBusyAction(true); setError(null);
    try {
      await api.patch(`/app/pms/drydock-specs/items/${row.id}/decision`, { itemStatus });
      setRows(rs => rs.map(r => (r.key === row.key ? { ...r, itemStatus } : r)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.saveError"));
    } finally {
      setBusyAction(false);
    }
  };

  const sendComment = async () => {
    if (!selectedRow?.id || !commentDraft.trim()) return;
    setBusyAction(true); setError(null);
    try {
      const created = await api.post<SpecComment>(`/app/pms/drydock-specs/items/${selectedRow.id}/comments`, { body: commentDraft.trim() });
      setRows(rs => rs.map(r => (r.key === selectedRow.key ? { ...r, comments: [...r.comments, created] } : r)));
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

  const deleteDraft = async () => {
    if (!live) return;
    setBusyAction(true);
    try {
      await api.delete(`/app/pms/drydock-specs/${live.id}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("error.delete"));
      setBusyAction(false);
      setConfirmDelete(false);
    }
  };

  // ESC / X: pregunta si hay cambios sin guardar.
  const closeWindow = () => { if (spec === null && live !== null) onSaved(); onClose(); };
  const requestClose = useEscapeGuard({ isDirty, onSave: canEdit ? async () => { await save(); } : undefined, onClose: closeWindow });

  // ── Guía ──
  const headerMissing = { title: canEdit && !title.trim(), vessel: isNew && !newVesselCode };
  const accepted = rows.filter(r => r.itemStatus === "ACCEPTED").length;
  const discarded = rows.filter(r => r.itemStatus === "REJECTED").length;
  const pending = rows.length - accepted - discarded;
  const noPriority = rows.filter(r => !r.priority).length;
  const days = daysUntil(plannedStartDate);
  const displayVessel = vesselName ?? (live ? (vessels.find(v => v.code === live.vesselCode)?.name || live.vesselCode) : (vessels.find(v => v.code === newVesselCode)?.name ?? ""));
  const sectionHeaderMissing = Number(headerMissing.title) + Number(headerMissing.vessel);
  const byCategory = CATEGORIES.map(c => ({ c, total: rows.filter(r => r.category === c).length, acc: rows.filter(r => r.category === c && r.itemStatus === "ACCEPTED").length })).filter(x => x.total > 0);

  const check = (ok: boolean, label: string) => (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${ok ? "border-emerald-500/35 bg-surface text-emerald-700 dark:text-emerald-400" : "border-amber-400/70 bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
      {ok ? <Check className="w-3 h-3" /> : <CircleDashed className="w-3 h-3" />} {label}
    </span>
  );
  const nextCard = (tone: string, iconBox: string, Icon: typeof Ship, ttl: string, desc: string, extra: React.ReactNode, actions: React.ReactNode) => (
    <div className={`mx-4 sm:mx-6 mt-4 rounded-2xl border-[1.5px] px-3.5 py-3 space-y-2.5 ${tone}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 ${iconBox}`}><Icon className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-black text-fg">{ttl}</p>
          <p className="text-[12.5px] text-text-industrial/70">{desc}</p>
        </div>
        <div className="flex flex-wrap gap-2 ml-auto">{actions}</div>
      </div>
      {extra}
    </div>
  );
  const progress = rows.length > 0 && (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-fg/10">
        <i className="block h-full bg-emerald-600" style={{ width: `${(accepted / rows.length) * 100}%` }} />
        <i className="block h-full bg-red-600" style={{ width: `${(discarded / rows.length) * 100}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-text-industrial/60">
        {t("dds.v26.progress").replace("{acc}", String(accepted)).replace("{dis}", String(discarded))}
        {pending > 0 && <b className="text-amber-700 dark:text-amber-400"> · {t("dds.v26.pendingN").replace("{n}", String(pending))}</b>}
      </p>
    </div>
  );

  const guide = (() => {
    if (isNew) return null;
    switch (status) {
      case "DRAFT": {
        const missing = [!title.trim(), rows.length === 0, rows.some(r => !r.title.trim())].filter(Boolean).length;
        return nextCard("border-orange-400/60 bg-orange-500/[0.07]", "bg-orange-600", Pencil,
          rows.length === 0 ? t("dds.v26.draftEmptyTitle") : t("dds.v26.draftTitle"), t("dds.v26.draftDesc"),
          <div className="flex flex-wrap gap-1.5">
            {check(!!title.trim(), t("dds.title"))}
            {check(!!shipyardName.trim() && !!plannedStartDate, t("dds.v26.chkYardDates"))}
            {check(rows.length > 0, t("dds.v26.chkOneItem"))}
            {check(rows.length > 0 && rows.every(r => r.title.trim()), t("dds.v26.chkItemTitles"))}
            {rows.length > 0 && noPriority > 0 && check(false, t("dds.v26.chkNoPriority").replace("{n}", String(noPriority)))}
          </div>,
          <button type="button" disabled={busyAction || saving || missing > 0} onClick={() => { void transition("SUBMITTED"); }} className={`${btn} bg-orange-600 text-white hover:brightness-110`}>
            {busyAction || saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {t("dds.v26.saveAndSubmit")}
            {missing > 0 && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(missing))}</span>}
          </button>);
      }
      case "SUBMITTED":
        return canApprove
          ? nextCard("border-violet-400/60 bg-violet-500/[0.07]", "bg-violet-600", Inbox, t("dds.v26.subShoreTitle"), t("dds.v26.subShoreDesc"), null,
              <>
                <button type="button" disabled={busyAction} onClick={() => { void transition("DRAFT"); }} className={`${btn} border border-fg/15 bg-surface text-fg hover:border-fg/30`}><CornerUpLeft className="w-3.5 h-3.5" /> {t("dds.v26.giveBack")}</button>
                <button type="button" disabled={busyAction} onClick={() => { void transition("UNDER_REVIEW"); }} className={`${btn} bg-blue-600 text-white hover:brightness-110`}><ListChecks className="w-3.5 h-3.5" /> {t("dds.startReview")}</button>
              </>)
          : nextCard("border-violet-400/60 bg-violet-500/[0.07]", "bg-violet-600", Hourglass, t("dds.v26.subShipTitle"), t("dds.v26.subShipDesc"), null,
              <button type="button" disabled={busyAction} onClick={() => { void transition("DRAFT"); }} className={`${btn} border border-fg/15 bg-surface text-fg hover:border-fg/30`}><CornerUpLeft className="w-3.5 h-3.5" /> {t("dds.v26.withdraw")}</button>);
      case "UNDER_REVIEW":
        return canApprove
          ? nextCard("border-blue-400/60 bg-blue-500/[0.07]", "bg-blue-600", ListChecks, t("dds.v26.revShoreTitle"), t("dds.v26.revShoreDesc"), progress,
              <>
                <button type="button" disabled={busyAction} onClick={() => { setRejectReason(""); setRejectOpen(true); }} className={`${btn} border border-red-500/35 bg-surface text-red-700 dark:text-red-400 hover:bg-red-500/10`}><CornerUpLeft className="w-3.5 h-3.5" /> {t("dds.reject")}</button>
                <button type="button" disabled={busyAction || pending > 0 || accepted === 0 || isDirty} onClick={() => { void transition("APPROVED"); }}
                  title={isDirty ? t("dds.v26.saveFirst") : pending > 0 ? t("dds.v26.pendingN").replace("{n}", String(pending)) : undefined}
                  className={`${btn} bg-emerald-600 text-white hover:brightness-110`}>
                  <Check className="w-3.5 h-3.5" /> {t("dds.approve")}
                  {pending > 0 && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(pending))}</span>}
                </button>
              </>)
          : nextCard("border-blue-400/60 bg-blue-500/[0.07]", "bg-blue-600", Hourglass, t("dds.v26.revShipTitle"), t("dds.v26.revShipDesc"), progress, null);
      case "REJECTED":
        return nextCard("border-red-400/60 bg-red-500/[0.07]", "bg-red-600", CornerUpLeft, t("dds.v26.rejTitle"),
          live?.rejectedReason ? t("dds.v26.rejReason").replace("{reason}", live.rejectedReason) : t("dds.v26.rejDesc"), null,
          <button type="button" disabled={busyAction} onClick={() => { void transition("DRAFT"); }} className={`${btn} bg-orange-600 text-white hover:brightness-110`}><Pencil className="w-3.5 h-3.5" /> {t("dds.v26.backToFix")}</button>);
      case "APPROVED":
        return nextCard("border-emerald-500/40 bg-emerald-500/[0.07]", "bg-emerald-600", CheckCircle2,
          t("dds.v26.apprTitle").replace("{name}", live?.approvedByName ?? "—").replace("{date}", live?.approvedAt ? fmtDate(live.approvedAt) : "—"),
          t("dds.v26.apprDesc").replace("{n}", String(accepted)), null,
          <button type="button" disabled={busyAction} onClick={() => { void downloadPdf(); }} className={`${btn} bg-emerald-600 text-white hover:brightness-110`}><FileDown className="w-3.5 h-3.5" /> {t("dds.v26.pdfForYard")}</button>);
      default:
        return null;
    }
  })();

  const order = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED"];
  const stepIdx = status === "REJECTED" ? 0 : order.indexOf(status);
  const stepDate: Record<string, string | null | undefined> = { SUBMITTED: live?.submittedAt, UNDER_REVIEW: live?.reviewStartedAt, APPROVED: live?.approvedAt };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-7xl max-h-[94vh] bg-surface dark:bg-[#0D1B2A] border border-fg/10 border-t-4 border-t-sky-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Encabezado */}
        <div className="flex items-start gap-3 px-4 sm:px-6 py-3 border-b border-fg/10 shrink-0">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-sky-500/15 text-sky-700 dark:text-sky-300"><Anchor className="w-6 h-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-400">{t("dds.v26.kicker")}</p>
            <h2 className="text-lg font-black text-fg leading-tight truncate">{title.trim() || t("dds.newTitle")}</h2>
            {(shipyardName.trim() || port.trim() || plannedStartDate) && (
              <p className="text-xs text-text-industrial/60 truncate">
                {[shipyardName.trim(), port.trim(), plannedStartDate && `${fmtDate(plannedStartDate)}${plannedEndDate ? ` → ${fmtDate(plannedEndDate)}` : ""}`].filter(Boolean).join(" · ")}
                {days != null && days >= 0 && ` · ${t("dds.v26.daysLeft").replace("{n}", String(days))}`}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {live && <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 font-mono text-[11px] font-bold text-fg">{live.specCode}</span>}
              {/* Nombre del buque, no el código. */}
              {displayVessel && <span className="inline-flex items-center gap-1 rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70"><Ship className="w-3 h-3" />{displayVessel}</span>}
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${STATUS_CHIP[status] ?? ""}`}>{t(`dds.status.${status}` as TranslationKey)}</span>
              {rows.length > 0 && <span className="rounded-full border border-fg/10 bg-fg/5 px-2 py-0.5 text-[11px] font-bold text-text-industrial/70">{t("dds.v26.acceptedOf").replace("{acc}", String(accepted)).replace("{n}", String(rows.length))}</span>}
            </div>
          </div>
          {savedMsg && <span className="self-center text-[11px] font-bold text-emerald-600">{savedMsg}</span>}
          <ModalCloseButton onClose={requestClose} />
        </div>

        {/* Etapas */}
        {!isNew && (
          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-fg/10 bg-fg/[0.02] shrink-0">
            {order.map((s, i) => {
              const done = i < stepIdx, cur = i === stepIdx;
              return (
                <React.Fragment key={s}>
                  {i > 0 && <span className="w-5 h-px bg-fg/15" />}
                  <span className={`flex items-center gap-1.5 text-xs font-bold ${done ? "text-emerald-700 dark:text-emerald-400" : cur ? "text-fg" : "text-text-industrial/40"}`}>
                    <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] ${done ? "bg-emerald-500 border-emerald-500 text-white" : cur ? "bg-sky-700 border-sky-700 text-white" : "border-fg/25"}`}>
                      {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                    </span>
                    <span>
                      {t(`dds.v26.step.${s}` as TranslationKey)}
                      {(done || cur) && stepDate[s] && <span className="block text-[10px] font-semibold text-text-industrial/45">{fmtDate(stepDate[s]!)}</span>}
                    </span>
                  </span>
                </React.Fragment>
              );
            })}
            {status === "REJECTED" && <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${STATUS_CHIP.REJECTED}`}>{t("dds.status.REJECTED")}</span>}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loadingFull ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>
          ) : (
            <>
              {guide}
              <div className={`grid grid-cols-1 ${isNew ? "lg:grid-cols-[1.5fr_1fr]" : "lg:grid-cols-[1.5fr_1fr]"} gap-4 px-4 sm:px-6 py-4`}>
                <div className="space-y-3 min-w-0">
                  {/* 1 · Datos de la varada */}
                  <GuideSection n={1} title={t("dds.v26.sec1")} subtitle={t("dds.v26.sec1Sub")} open onToggle={() => { /* siempre abierto */ }}
                    pill={canEdit ? <GuidePill missing={sectionHeaderMissing} completeLabel={t("mp.guide.complete")} missingOne={t("mp.guide.missingOne")} missingMany={t("mp.guide.missingMany")} /> : undefined}>
                    {isNew && (
                      <GuideField id="dds-vessel" missing={headerMissing.vessel}>
                        <label className={fl}>{t("col.vessel")}<RequiredMark />{headerMissing.vessel && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                        <select value={newVesselCode} onChange={e => setNewVesselCode(e.target.value)} className={inputCls}>
                          <option value="">{t("common.select")}</option>
                          {vessels.map(v => <option key={v.code} value={v.code}>{v.name || v.code}</option>)}
                        </select>
                      </GuideField>
                    )}
                    <GuideField id="dds-title" missing={headerMissing.title}>
                      <label className={fl}>{t("dds.title")}<RequiredMark />{headerMissing.title && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                      <input value={title} onChange={e => setTitle(e.target.value)} disabled={!canEdit} className={inputCls} placeholder={t("dds.v26.titlePh")} />
                      <p className="flex gap-1 text-[11px] text-text-industrial/50"><Info className="w-3 h-3 shrink-0 mt-px" />{t("dds.v26.titleHelp")}</p>
                    </GuideField>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={fl}>{t("dds.shipyard")}</label>
                        <input value={shipyardName} onChange={e => setShipyardName(e.target.value)} disabled={!canEdit} className={inputCls} />
                        <p className="mt-1 flex gap-1 text-[11px] text-text-industrial/50"><Info className="w-3 h-3 shrink-0 mt-px" />{t("dds.v26.yardHelp")}</p>
                      </div>
                      <div><label className={fl}>{t("dds.port")}</label><input value={port} onChange={e => setPort(e.target.value)} disabled={!canEdit} className={inputCls} /></div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label className={fl}>{t("dds.v26.dockIn")}</label><input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} disabled={!canEdit} className={inputCls} /></div>
                      <div>
                        <label className={fl}>{t("dds.v26.dockOut")}</label>
                        <input type="date" value={plannedEndDate} min={plannedStartDate || undefined} onChange={e => setPlannedEndDate(e.target.value)} disabled={!canEdit} className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className={fl}>{t("dds.scopeSummary")}</label>
                      <AutoTextArea value={scopeSummary} onChange={e => setScopeSummary(e.target.value)} disabled={!canEdit} rows={2} className={inputCls} placeholder={t("dds.v26.scopePh")} />
                      <p className="mt-1 flex gap-1 text-[11px] text-text-industrial/50"><Info className="w-3 h-3 shrink-0 mt-px" />{t("dds.v26.scopeHelp")}</p>
                    </div>
                  </GuideSection>

                  {/* 2 · Trabajos */}
                  {!isNew && (
                    <section className="rounded-2xl border border-fg/10 bg-surface dark:bg-white/[0.02]">
                      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
                        <span className="w-[22px] h-[22px] rounded-full bg-fg text-surface text-[11px] font-bold flex items-center justify-center shrink-0">2</span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-extrabold text-fg">{t("dds.items")} <span className="font-semibold text-text-industrial/50">({rows.length})</span></span>
                          <span className="block text-[11px] text-text-industrial/60">{t("dds.v26.sec2Sub")}</span>
                        </span>
                        {canEdit && rows.length > 0 && (
                          <span className="ml-auto flex flex-wrap gap-2">
                            <button type="button" onClick={() => { void openImport(); }} disabled={saving} className={`${btn} border border-fg/15 text-fg hover:border-fg/30`}><Download className="w-3.5 h-3.5" /> {t("dds.v26.bringPending")}</button>
                            <button type="button" onClick={addRow} className={`${btn} border border-fg/15 text-fg hover:border-fg/30`}><Plus className="w-3.5 h-3.5" /> {t("dds.v26.addManual")}</button>
                          </span>
                        )}
                      </div>
                      <div className="px-4 pb-4 space-y-2.5">
                        {rows.length === 0 && (
                          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-fg/10 px-4 py-6 text-center">
                            <ClipboardList className="w-7 h-7 text-text-industrial/40" />
                            <b className="text-sm text-fg">{t("dds.v26.emptyTitle")}</b>
                            <p className="max-w-md text-xs text-text-industrial/60">{t("dds.v26.emptyDesc")}</p>
                            {canEdit && (
                              <div className="flex flex-wrap justify-center gap-2">
                                <button type="button" onClick={() => { void openImport(); }} disabled={saving} className={`${btn} bg-orange-600 text-white hover:brightness-110`}><Download className="w-3.5 h-3.5" /> {t("dds.v26.bringPending")}</button>
                                <button type="button" onClick={addRow} className={`${btn} border border-fg/15 text-fg hover:border-fg/30`}><Plus className="w-3.5 h-3.5" /> {t("dds.v26.addManual")}</button>
                              </div>
                            )}
                          </div>
                        )}
                        {rows.map((r, i) => {
                          const CatIcon = CAT_ICON[r.category] ?? MoreHorizontal;
                          const srcCode = sourceCodeOf(r);
                          const tone = r.itemStatus === "ACCEPTED" ? "border-l-emerald-600" : r.itemStatus === "REJECTED" ? "border-l-red-600 opacity-80" : "border-l-amber-500";
                          const missingTitle = canEdit && !r.title.trim();
                          return (
                            <div key={r.key} onClick={() => setSelectedKey(r.key)}
                              className={`rounded-xl border border-l-4 bg-surface px-3 py-2.5 space-y-2 cursor-pointer ${tone} ${selectedKey === r.key ? "border-accent ring-2 ring-accent/20" : "border-fg/10"}`}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <b className="text-xs text-text-industrial/45">#{i + 1}</b>
                                <span className="inline-flex items-center gap-1 rounded-full bg-fg/5 px-2 py-0.5 text-[10.5px] font-bold text-text-industrial/70"><CatIcon className="w-3 h-3" />{t(`dds.cat.${r.category}` as TranslationKey)}</span>
                                {srcCode ? (
                                  <button type="button" onClick={e => { e.stopPropagation(); navigate(`${SOURCE_ROUTE[r.sourceType]}/${encodeURIComponent(srcCode)}`); }}
                                    className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-bold text-accent hover:bg-accent/20">
                                    <Link2 className="w-3 h-3" />{t(`dds.src.${r.sourceType}` as TranslationKey)} {srcCode}
                                  </button>
                                ) : (
                                  <span className="rounded-full bg-fg/5 px-2 py-0.5 text-[10.5px] font-bold text-text-industrial/55">{t(`dds.v26.origin.${r.sourceType}` as TranslationKey)}</span>
                                )}
                                {r.classRelated && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300">{t("dds.v26.classChip")}</span>}
                                {r.assetName && <span className="text-[11px] text-text-industrial/50 truncate">{r.assetName}</span>}
                                <span className="ml-auto flex items-center gap-1.5">
                                  {canDecide && r.id ? (
                                    <>
                                      <button type="button" disabled={busyAction} onClick={e => { e.stopPropagation(); void decide(r, "ACCEPTED"); }}
                                        className={`inline-flex items-center gap-1 rounded-lg border-[1.5px] px-2 py-1 text-[11px] font-extrabold transition-colors ${r.itemStatus === "ACCEPTED" ? "border-emerald-600 bg-emerald-600 text-white" : "border-fg/15 text-fg hover:border-emerald-600"}`}>
                                        <Check className="w-3 h-3" /> {t("dds.accept")}
                                      </button>
                                      <button type="button" disabled={busyAction} onClick={e => { e.stopPropagation(); void decide(r, "REJECTED"); }}
                                        className={`inline-flex items-center gap-1 rounded-lg border-[1.5px] px-2 py-1 text-[11px] font-extrabold transition-colors ${r.itemStatus === "REJECTED" ? "border-red-600 bg-red-600 text-white" : "border-fg/15 text-fg hover:border-red-600"}`}>
                                        <X className="w-3 h-3" /> {t("dds.discard")}
                                      </button>
                                    </>
                                  ) : (
                                    <span className={`rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${r.itemStatus === "ACCEPTED" ? STATUS_CHIP.APPROVED : r.itemStatus === "REJECTED" ? STATUS_CHIP.REJECTED : "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
                                      {t(`dds.item.${r.itemStatus}` as TranslationKey)}
                                    </span>
                                  )}
                                </span>
                              </div>
                              <div className={missingTitle ? "rounded-lg border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-500/10 px-2 py-1.5" : ""}>
                                {missingTitle && <GuideNeedTag label={t("mp.guide.missing")} />}
                                <input value={r.title} onChange={e => updateRow(r.key, { title: e.target.value })} onClick={e => e.stopPropagation()} disabled={!canEdit}
                                  placeholder={t("dds.v26.itemTitlePh")} className={`${inputCls} font-semibold`} />
                              </div>
                              <AutoTextArea rows={1} value={r.description} onChange={e => updateRow(r.key, { description: e.target.value })} onClick={e => e.stopPropagation()} disabled={!canEdit}
                                placeholder={t("dds.v26.itemDescPh")} className={inputCls} />
                              <div className="flex flex-wrap items-center gap-2" onClick={e => e.stopPropagation()}>
                                <select value={r.category} onChange={e => updateRow(r.key, { category: e.target.value })} disabled={!canEdit} className={`${inputCls} w-auto py-1.5 text-xs`}>
                                  {CATEGORIES.map(c => <option key={c} value={c}>{t(`dds.cat.${c}` as TranslationKey)}</option>)}
                                </select>
                                <select value={r.priority} onChange={e => updateRow(r.key, { priority: e.target.value })} disabled={!canEdit}
                                  className={`${inputCls} w-auto py-1.5 text-xs ${canEdit && !r.priority ? "border-amber-400" : ""}`}>
                                  <option value="">{t("dds.v26.priorityPh")}</option>
                                  {PRIORITIES.map(p => <option key={p} value={p}>{t(`dds.prio.${p}` as TranslationKey)}</option>)}
                                </select>
                                <label className={`inline-flex items-center gap-1.5 text-xs text-text-industrial/70 ${canEdit ? "cursor-pointer" : ""}`} title={t("dds.classRelatedFull")}>
                                  <input type="checkbox" checked={r.classRelated} onChange={e => updateRow(r.key, { classRelated: e.target.checked })} disabled={!canEdit} className="w-4 h-4 accent-violet-600" />
                                  {t("dds.v26.classChip")}
                                </label>
                                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-text-industrial/55"><MessageSquare className="w-3.5 h-3.5" />{r.comments.length}</span>
                                {canEdit && (
                                  <button type="button" onClick={() => requestRemove(r)} title={t("common.delete")} className="rounded-lg p-1.5 text-red-700/70 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400/70">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>

                {/* Derecha: ayuda, conversación, resumen y recorrido */}
                <div className="space-y-3 min-w-0">
                  {(isNew || rows.length === 0) && (
                    <div className="rounded-2xl border border-fg/10 overflow-hidden">
                      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><Lightbulb className="w-4 h-4" /> {t("dds.v26.tipsTitle")}</h3>
                      <ul className="p-3 space-y-1.5 text-xs text-text-industrial/80 list-disc pl-7">
                        <li>{t("dds.v26.tip1")}</li><li>{t("dds.v26.tip2")}</li><li>{t("dds.v26.tip3")}</li><li>{t("dds.v26.tip4")}</li>
                      </ul>
                    </div>
                  )}
                  {!isNew && rows.length > 0 && (
                    <div className="rounded-2xl border border-fg/10 overflow-hidden">
                      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg">
                        <MessagesSquare className="w-4 h-4" /> {t("dds.v26.conversation")}{selectedRow ? ` · #${rows.indexOf(selectedRow) + 1}` : ""}
                      </h3>
                      <div className="p-3 space-y-2">
                        {!selectedRow && <p className="text-xs text-text-industrial/50">{t("dds.selectItemHint")}</p>}
                        {selectedRow && (
                          <>
                            <p className="text-xs font-bold text-fg line-clamp-2">{selectedRow.title || "—"}</p>
                            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                              {selectedRow.comments.length === 0 && <p className="text-xs text-text-industrial/45">{t("dds.commentsEmpty")}</p>}
                              {selectedRow.comments.map(c => {
                                const shore = ["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "PROCUREMENT_STORE"].includes(c.authorRole);
                                return (
                                  <div key={c.id} className={`max-w-[90%] rounded-xl px-2.5 py-1.5 text-xs ${shore ? "self-end bg-violet-500/10" : "self-start bg-sky-500/10"}`}>
                                    <span className="block text-[10px] font-bold text-text-industrial/55">{c.authorName} · {shore ? t("dds.proposedByShore") : t("dds.proposedByVessel")} · {fmtDate(c.createdAt)}</span>
                                    <span className="whitespace-pre-wrap text-fg">{c.body}</span>
                                  </div>
                                );
                              })}
                            </div>
                            {selectedRow.id ? (
                              <div className="flex items-end gap-2">
                                <AutoTextArea value={commentDraft} onChange={e => setCommentDraft(e.target.value)} rows={2} placeholder={t("dds.v26.commentPh")} className={inputCls} />
                                <button type="button" onClick={() => { void sendComment(); }} disabled={busyAction || !commentDraft.trim()} title={t("dds.commentSend")} className={`${btn} bg-accent text-accent-fg hover:brightness-110 shrink-0`}>
                                  <Send className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : <p className="text-[11px] text-text-industrial/50">{t("dds.v26.commentAfterSave")}</p>}
                            <p className="flex gap-1 text-[11px] text-text-industrial/45"><Info className="w-3 h-3 shrink-0 mt-px" />{t("dds.v26.commentHelp")}</p>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {byCategory.length > 0 && (
                    <div className="rounded-2xl border border-fg/10 overflow-hidden">
                      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><BarChart3 className="w-4 h-4" /> {t("dds.v26.byCategory")}</h3>
                      <div className="p-3 space-y-1.5">
                        {byCategory.map(({ c, total, acc }) => {
                          const Icon = CAT_ICON[c] ?? MoreHorizontal;
                          return <div key={c} className="flex items-center gap-2 text-xs"><Icon className="w-3.5 h-3.5 text-text-industrial/60" /><span className="flex-1 text-fg">{t(`dds.cat.${c}` as TranslationKey)}</span><b>{acc}</b><span className="text-text-industrial/50">/ {total}</span></div>;
                        })}
                        <p className="text-[10.5px] text-text-industrial/45">{t("dds.v26.byCategoryHelp")}</p>
                      </div>
                    </div>
                  )}
                  {live && (
                    <div className="rounded-2xl border border-fg/10 overflow-hidden">
                      <h3 className="flex items-center gap-1.5 px-3 py-2.5 border-b border-fg/10 text-[13.5px] font-extrabold text-fg"><History className="w-4 h-4" /> {t("dds.v26.trail")}</h3>
                      <div className="p-3 space-y-1.5 text-xs text-fg">
                        <p className="flex items-center gap-1.5"><Pencil className="w-3 h-3 text-text-industrial/50" />{t("dds.v26.trailCreated").replace("{date}", fmtDate(live.createdAt))}</p>
                        {live.submittedAt && <p className="flex items-center gap-1.5"><Send className="w-3 h-3 text-text-industrial/50" />{t("dds.v26.trailSent").replace("{name}", live.submittedByName ?? "—").replace("{date}", fmtDate(live.submittedAt))}</p>}
                        {live.reviewStartedAt && <p className="flex items-center gap-1.5"><Inbox className="w-3 h-3 text-text-industrial/50" />{t("dds.v26.trailReview").replace("{date}", fmtDate(live.reviewStartedAt))}</p>}
                        {live.rejectedAt && <p className="flex items-center gap-1.5"><CornerUpLeft className="w-3 h-3 text-text-industrial/50" />{t("dds.v26.trailRejected").replace("{date}", fmtDate(live.rejectedAt))}</p>}
                        {live.approvedAt && <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-text-industrial/50" />{t("dds.v26.trailApproved").replace("{name}", live.approvedByName ?? "—").replace("{date}", fmtDate(live.approvedAt))}</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Pie */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-t border-fg/10 shrink-0">
          {live && status === "DRAFT" && (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={busyAction} className={`${btn} border border-red-500/30 text-red-700 dark:text-red-400 hover:bg-red-500/10`}>
              <Trash2 className="w-3.5 h-3.5" /> {t("dds.v26.deleteDraft")}
            </button>
          )}
          {live && (
            <button type="button" onClick={() => { void downloadPdf(); }} disabled={busyAction} className={`${btn} border border-fg/10 text-fg hover:border-accent/30`}>
              <FileDown className="w-3.5 h-3.5" /> {status === "APPROVED" ? "PDF" : t("dds.v26.pdfDraft")}
            </button>
          )}
          <span className="flex-1" />
          {isDirty && <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-amber-700 dark:text-amber-400"><AlertTriangle className="w-3 h-3" /> {t("mp.guide.dirty")}</span>}
          {!canEdit && !frozen && !isNew && <span className="text-[11.5px] text-text-industrial/55">{t("dds.v26.shoreOnly")}</span>}
          <button type="button" onClick={requestClose} className="px-3 py-2 rounded-xl text-xs text-text-industrial hover:text-fg">{t("common.close")}</button>
          {canEdit && (
            <button type="button" onClick={() => { void save(); }} disabled={saving} className={`${btn} bg-sky-700 text-white hover:brightness-110`}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {isNew ? t("dds.v26.create") : t("common.save")}
              {sectionHeaderMissing > 0 && <span className="text-[10px] font-semibold opacity-85">{t("mp.guide.saveMissing").replace("{n}", String(sectionHeaderMissing))}</span>}
            </button>
          )}
        </div>
      </div>

      {showImport && live && (
        <ImportModal specId={live.id} onClose={() => setShowImport(false)} onImported={() => { void loadFull(live.id); }} />
      )}

      {/* Devolver al buque: el motivo es obligatorio, es la respuesta que lee el buque. */}
      {rejectOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-fg/10">
              <h3 className="text-base font-black text-fg">{t("dds.reject")}</h3>
              <ModalCloseButton onClose={() => setRejectOpen(false)} className="ml-auto" />
            </div>
            <div className="px-5 py-4 space-y-2">
              <GuideField id="dds-reject" missing={!rejectReason.trim()}>
                <label className={fl}>{t("dds.v26.rejectQ")}<RequiredMark />{!rejectReason.trim() && <GuideNeedTag label={t("mp.guide.missing")} />}</label>
                <AutoTextArea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={4} className={inputCls} placeholder={t("dds.v26.rejectPh")} autoFocus />
              </GuideField>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-fg/10">
              <button type="button" onClick={() => setRejectOpen(false)} className={`${btn} text-text-industrial hover:text-fg`}>{t("common.back")}</button>
              <button type="button"
                onClick={() => {
                  if (!rejectReason.trim()) { setError(t("dds.rejectReasonRequired")); return; }
                  setRejectOpen(false);
                  void transition("REJECTED", { rejectedReason: rejectReason.trim() });
                }}
                className={`${btn} bg-red-600 text-white hover:brightness-110`}>
                <CornerUpLeft className="w-3.5 h-3.5" /> {t("dds.reject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {(confirmRemove || confirmDelete) && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-fg/10">
              <h3 className="text-base font-black text-fg">{confirmDelete ? t("dds.v26.deleteDraft") : t("dds.v26.removeItemTitle")}</h3>
              <ModalCloseButton onClose={() => { setConfirmRemove(null); setConfirmDelete(false); }} className="ml-auto" />
            </div>
            <p className="px-5 py-4 text-sm text-fg">
              {confirmDelete ? t("dds.deleteConfirm") : t("dds.v26.removeItemQ").replace("{n}", String(confirmRemove!.comments.length))}
            </p>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-fg/10">
              <button type="button" onClick={() => { setConfirmRemove(null); setConfirmDelete(false); }} className={`${btn} text-text-industrial hover:text-fg`}>{t("common.back")}</button>
              <button type="button" disabled={busyAction} onClick={() => { if (confirmDelete) void deleteDraft(); else removeRow(confirmRemove!); }} className={`${btn} bg-red-600 text-white hover:brightness-110`}>
                <Trash2 className="w-3.5 h-3.5" /> {t("common.delete")}
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
  const { vessels } = useVesselContext();

  const params = new URLSearchParams();
  if (vesselFilter) params.set("vesselCode", vesselFilter);
  const path = `/app/pms/drydock-specs${params.size ? `?${params}` : ""}`;

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [vesselFilter]);
  // Filtro que llega desde una métrica del panel TMSA (lib/tmsa-filter.tsx).
  const tmsaFilter = useTmsaFilter();
  const tmsaItems = useMemo(() => applyTmsaFilter(data?.items ?? null, tmsaFilter, r => r.id) ?? [], [data, tmsaFilter]);
  const [detail, setDetail] = useState<DrydockSpec | null | "new">(null);
  const [search, setSearch] = useState("");
  // La explicación del proceso se puede plegar; se recuerda en este navegador.
  const [howtoOpen, setHowtoOpen] = useState(() => { try { return localStorage.getItem("dds.howto") !== "0"; } catch { return true; } });
  const toggleHowto = () => setHowtoOpen(v => { try { localStorage.setItem("dds.howto", v ? "0" : "1"); } catch { /* sin almacenamiento */ } return !v; });

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
  const canApprove = can("drydock.approve");
  const vesselName = (c: string) => vessels.find(v => v.code === c)?.name || c;

  const shown = useMemo(() => {
    let r = tmsaItems;
    const q = search.trim().toLowerCase();
    if (q) r = r.filter(s => textMatches(s.title, q) || textMatches(s.specCode, q) || textMatches(s.shipyardName ?? "", q) || textMatches(vesselName(s.vesselCode), q));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmsaItems, search, vessels]);

  const openSpec = (s: DrydockSpec) => { setDetail(s); open(s.specCode); };

  const rowAction = (s: DrydockSpec) => {
    const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors";
    const go = (e: React.MouseEvent) => { e.stopPropagation(); openSpec(s); };
    switch (s.status) {
      case "DRAFT":
      case "REJECTED":     return <button type="button" onClick={go} className={`${base} border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20`}><Pencil className="w-3 h-3" /> {t("dds.v26.actBuild")}</button>;
      case "SUBMITTED":    return canApprove ? <button type="button" onClick={go} className={`${base} border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20`}><Inbox className="w-3 h-3" /> {t("dds.startReview")}</button> : null;
      case "UNDER_REVIEW": return canApprove ? <button type="button" onClick={go} className={`${base} border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20`}><ListChecks className="w-3 h-3" /> {t("dds.v26.actDecide")}</button> : null;
      case "APPROVED":     return <button type="button" onClick={e => { e.stopPropagation(); void downloadAuthedFile(`/app/pms/drydock-specs/${s.id}/pdf`, `${s.specCode}.pdf`); }} className={`${base} border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20`}><FileDown className="w-3 h-3" /> {t("dds.v26.pdfForYard")}</button>;
      default:             return null;
    }
  };

  const COLUMNS: Column<DrydockSpec>[] = [
    {
      key: "title", header: t("dds.v26.col.doc"), sortValue: r => r.title,
      render: r => (
        <div className="min-w-0">
          <div className="text-xs font-bold text-fg line-clamp-1">{r.title}</div>
          {/* Nombre del buque, no el código. */}
          <div className="text-[10.5px] text-text-industrial/50"><span className="font-mono">{r.specCode}</span> · {vesselName(r.vesselCode)}</div>
        </div>
      ),
    },
    { key: "shipyardName", header: t("dds.v26.col.yard"), sortValue: r => r.shipyardName ?? "", render: r => <div><div className="text-xs text-fg">{r.shipyardName ?? "—"}</div><div className="text-[10.5px] text-text-industrial/50">{r.port ?? ""}</div></div> },
    {
      key: "plannedStartDate", header: t("dds.v26.col.start"), sortValue: r => r.plannedStartDate ?? "",
      render: r => {
        const d = daysUntil(r.plannedStartDate);
        return (
          <div className="whitespace-nowrap">
            <div className="text-xs text-fg">{r.plannedStartDate ? fmtDate(r.plannedStartDate) : "—"}</div>
            {d != null && r.status !== "APPROVED" && <div className={`text-[10.5px] ${d >= 0 && d < 30 ? "font-extrabold text-amber-700 dark:text-amber-400" : "text-text-industrial/50"}`}>{d >= 0 ? t("dds.v26.daysLeft").replace("{n}", String(d)) : t("dds.v26.datePassed")}</div>}
          </div>
        );
      },
    },
    {
      key: "itemCount", header: t("dds.items"), sortValue: r => r.itemCount ?? 0,
      render: r => {
        const total = r.itemCount ?? 0, acc = r.acceptedCount ?? 0;
        return (
          <div className="min-w-[130px]">
            <div className="text-xs text-fg">{t("dds.v26.acceptedOf").replace("{acc}", String(acc)).replace("{n}", String(total))}</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fg/10"><i className="block h-full bg-emerald-600" style={{ width: `${total ? (acc / total) * 100 : 0}%` }} /></div>
          </div>
        );
      },
    },
    { key: "status", header: t("dds.v26.col.stage"), render: r => <span className={`inline-block whitespace-nowrap rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${STATUS_CHIP[r.status] ?? ""}`}>{t(`dds.status.${r.status}` as TranslationKey)}</span> },
    { key: "action", header: "", render: rowAction },
  ];

  const flow: { who: "ship" | "shore" | "yard"; icon: typeof Ship; n: number }[] = [
    { who: "ship", icon: Pencil, n: 1 }, { who: "ship", icon: Send, n: 2 }, { who: "shore", icon: ListChecks, n: 3 },
    { who: "shore", icon: CheckCircle2, n: 4 }, { who: "yard", icon: FileDown, n: 5 },
  ];
  const whoCls = { ship: "text-sky-700 dark:text-sky-400", shore: "text-violet-700 dark:text-violet-400", yard: "text-emerald-700 dark:text-emerald-400" };

  return (
    <div className="space-y-4">
      <PageHeader icon={Anchor} title={t("page.drydockSpecs")} total={shown.length} onReload={reload}>
        <ExportExcelButton module="drydock_specs" filters={{ vesselCode: vesselFilter }} />
        {canManage && (
          <button onClick={() => setDetail("new")} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-bold hover:brightness-110 transition-all">
            <Plus className="w-3.5 h-3.5" /> {t("dds.new")}
          </button>
        )}
      </PageHeader>

      {/* Cómo funciona: el usuario no conoce el proceso. */}
      <div className="rounded-2xl border border-fg/10 bg-surface px-4 py-3">
        <button type="button" onClick={toggleHowto} className="flex w-full items-center gap-1.5 text-left text-sm font-extrabold text-fg">
          <HelpCircle className="w-4 h-4" /> {t("dds.v26.howtoTitle")}
          <ChevronRight className={`ml-auto w-4 h-4 text-text-industrial/50 transition-transform ${howtoOpen ? "rotate-90" : ""}`} />
        </button>
        {howtoOpen && (
          <>
            <p className="mt-1.5 mb-2.5 text-[12.5px] text-text-industrial/70">{t("dds.v26.howtoDesc")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {flow.map(f => (
                <div key={f.n} className="rounded-xl border border-fg/10 px-2.5 py-2 text-xs leading-snug">
                  <span className={`block text-[10px] font-extrabold uppercase tracking-wider ${whoCls[f.who]}`}>{t(`dds.v26.who.${f.who}` as TranslationKey)}</span>
                  <b className="flex items-center gap-1.5 text-[12.5px] text-fg"><f.icon className="w-3.5 h-3.5" />{f.n} · {t(`dds.v26.flow${f.n}` as TranslationKey)}</b>
                  <span className="text-text-industrial/70">{t(`dds.v26.flow${f.n}Desc` as TranslationKey)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 w-full sm:w-80">
        <Search className="w-3.5 h-3.5 text-text-industrial/40 shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("dds.v26.search")} className="w-full bg-transparent text-xs text-fg placeholder-text-industrial/30 focus:outline-none" />
        {search && <button type="button" onClick={() => setSearch("")} className="text-text-industrial/40 hover:text-fg"><X className="w-3 h-3" /></button>}
      </div>

      <TmsaFilterBanner filter={tmsaFilter} shown={shown.length} total={data?.items?.length ?? 0} />

      <div className="hidden md:block">
        <DataTable columns={COLUMNS} data={shown} loading={loading} error={error} keyFn={r => r.id} emptyText={t("empty.drydockSpecs")} onRowClick={openSpec} />
      </div>
      <div className="md:hidden flex flex-col gap-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>}
        {!loading && shown.length === 0 && <p className="py-8 text-center text-sm text-text-industrial/40">{t("empty.drydockSpecs")}</p>}
        {shown.map(s => (
          <div key={s.id} onClick={() => openSpec(s)} className="rounded-xl border border-fg/10 bg-surface px-3 py-2.5 space-y-1.5 cursor-pointer">
            <b className="text-[13px] text-fg">{s.title}</b>
            <p className="text-[11px] text-text-industrial/55">{vesselName(s.vesselCode)}{s.plannedStartDate ? ` · ${fmtDate(s.plannedStartDate)}` : ""}</p>
            <span className={`inline-block rounded-lg border px-2 py-0.5 text-[10.5px] font-extrabold ${STATUS_CHIP[s.status] ?? ""}`}>{t(`dds.status.${s.status}` as TranslationKey)}</span>
            {rowAction(s)}
          </div>
        ))}
      </div>

      {detail !== null && (
        <DrydockSpecDrawer
          key={detail === "new" ? "new" : detail.id}
          spec={detail === "new" ? null : detail}
          onClose={() => { setDetail(null); if (code) close(); }}
          onSaved={() => { reload(); }}
        />
      )}
    </div>
  );
};
