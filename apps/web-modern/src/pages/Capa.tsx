import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Loader2, ShieldCheck, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { downloadAuthedFile } from "../lib/authed-media";
import { DataTable, PriorityBadge, StatusBadge, type Column } from "../components/DataTable";
import { VesselLabel } from "../components/EntityLabels";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { useT } from "../lib/i18n";
import { useCopilotEmitter, useCopilotScreenContext } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

interface CapaRecord {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetId: string;
  assetName: string | null;
  sourceType: string;
  sourceId: string;
  /** Código humano del origen (defectCode/workOrderCode/inspectionCode). null si no se pudo resolver (fuente borrada). */
  sourceCode: string | null;
  capaCode: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  owner: string | null;
  dueDate: string | null;
  completedAt: string | null;
  /** Texto del responsable a bordo describiendo las acciones realizadas
   * cuando sugiere el cierre. Visible a Gerencia Técnica al revisar. */
  actionsTaken: string | null;
  verificationNote: string | null;
  cancelReason: string | null;
  createdAt: string;
}

interface ListResponse {
  items: CapaRecord[];
  total: number;
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  DEFECT:     "Defecto",
  WORK_ORDER: "Orden de trabajo",
  INSPECTION: "Inspección",
};

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function asDateInputValue(value: string | null): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}

interface CompleteCapaModalProps {
  capaId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CompleteCapaModal: React.FC<CompleteCapaModalProps> = ({ capaId, onClose, onSuccess }) => {
  const t = useT();
  const [actionsTaken, setActionsTaken] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!actionsTaken.trim()) {
      setActionError("Describí las acciones realizadas antes de sugerir el cierre.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/capa/${capaId}/complete`, {
        actionsTaken: actionsTaken.trim(),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [capaId, onSuccess, t, actionsTaken]);

  // ESC guard
  const isDirty = useDirtyTracker({ actionsTaken });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">Sugerir cierre de CAPA</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="rounded-xl bg-accent/[0.06] border border-accent/20 px-3 py-2">
            <p className="text-[11px] text-text-industrial/80 leading-relaxed">
              La CAPA pasará a estado <strong className="text-white">PENDIENTE DE VERIFICACIÓN</strong>.
              Gerencia Técnica revisará las acciones y aprobará el cierre.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Acciones realizadas *</label>
            <textarea
              rows={6}
              value={actionsTaken}
              onChange={e => setActionsTaken(e.target.value)}
              placeholder="Detallá las acciones correctivas/preventivas ejecutadas, fechas, recursos utilizados, evidencia disponible…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60"
            />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sugerir cierre"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CloseCapaModalProps {
  capaId: string;
  /** Acciones reportadas por el responsable a bordo. Se muestran como
   * referencia antes del input de verificación. */
  actionsTaken?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CloseCapaModal: React.FC<CloseCapaModalProps> = ({ capaId, actionsTaken, onClose, onSuccess }) => {
  const t = useT();
  const [verificationNote, setVerificationNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!verificationNote.trim()) {
      setActionError(t("capa.verificationNote"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/capa/${capaId}/close`, {
        verificationNote: verificationNote.trim(),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [capaId, onSuccess, t, verificationNote]);

  // ESC guard
  const isDirty = useDirtyTracker({ verificationNote });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("capa.close")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {actionsTaken && (
            <div className="rounded-xl bg-accent/5 border border-accent/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-accent mb-1">Acciones realizadas (informe a bordo)</p>
              <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{actionsTaken}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Verificación de Gerencia Técnica *</label>
            <textarea
              rows={4}
              value={verificationNote}
              onChange={e => setVerificationNote(e.target.value)}
              placeholder="Conformidad con las acciones reportadas, observaciones, criterio de cierre…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60"
            />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CancelCapaModalProps {
  capaId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CancelCapaModal: React.FC<CancelCapaModalProps> = ({ capaId, onClose, onSuccess }) => {
  const t = useT();
  const [cancelReason, setCancelReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onSave = useCallback(async () => {
    if (!cancelReason.trim()) {
      setActionError(t("capa.cancelReason"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/app/pms/capa/${capaId}/cancel`, {
        cancelReason: cancelReason.trim(),
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [cancelReason, capaId, onSuccess, t]);

  // ESC guard
  const isDirty = useDirtyTracker({ cancelReason });
  useEscapeGuard({ isDirty, onSave, onClose });

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("capa.cancel")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("capa.cancelReason")}</label>
            <textarea rows={4} value={cancelReason} onChange={e => setCancelReason(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CapaModalProps {
  record: CapaRecord;
  onClose: () => void;
  onSuccess: () => void;
}

const CapaModal: React.FC<CapaModalProps> = ({ record, onClose, onSuccess }) => {
  const t = useT();
  const [title, setTitle] = useState(record.title ?? "");
  const [description, setDescription] = useState(record.description ?? "");
  const [priority, setPriority] = useState(record.priority ?? "MEDIUM");
  const [owner, setOwner] = useState(record.owner ?? "");
  const [dueDate, setDueDate] = useState(asDateInputValue(record.dueDate));
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  useEffect(() => {
    setTitle(record.title ?? "");
    setDescription(record.description ?? "");
    setPriority(record.priority ?? "MEDIUM");
    setOwner(record.owner ?? "");
    setDueDate(asDateInputValue(record.dueDate));
    setActionError(null);
    setShowCompleteModal(false);
    setShowCloseModal(false);
    setShowCancelModal(false);
  }, [record]);

  const isTerminal = record.status === "CLOSED" || record.status === "CANCELLED";
  const canCancel = !isTerminal;
  const { setRequestMessage } = useCopilotScreenContext();

  useCopilotEmitter({
    module: "CAPA",
    screen: "CAPA_EDIT",
    entityId: record.id,
    entityCode: record.capaCode,
    vesselCode: record.vesselCode,
    workflowStage: record.status,
    canEdit: !isTerminal,
    fieldValues: {
      title:       title       || null,
      description: description || null,
      priority:    priority    || null,
      owner:       owner       || null,
    },
    relatedEntities: { sourceType: record.sourceType, sourceId: record.sourceId },
  });

  const onSave = useCallback(async () => {
    if (!title.trim()) {
      setActionError(t("col.title"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await api.patch(`/app/pms/capa/${record.id}`, {
        title: title.trim(),
        description: normalizeOptionalText(description),
        priority,
        owner: normalizeOptionalText(owner),
        dueDate: dueDate || null,
      });
      onSuccess();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [description, dueDate, onSuccess, owner, priority, record.id, t, title]);

  // ESC guard — comparado contra el record original
  const recordDirty = !isTerminal && (
    title       !== (record.title       ?? "") ||
    description !== (record.description ?? "") ||
    priority    !== (record.priority    ?? "MEDIUM") ||
    owner       !== (record.owner       ?? "") ||
    dueDate     !== asDateInputValue(record.dueDate)
  );
  useEscapeGuard({
    enabled: !showCompleteModal && !showCloseModal && !showCancelModal,
    isDirty: recordDirty,
    onSave,
    onClose,
  });

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-bold text-white">{t("page.capa")}</h2>
            <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
          </div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.code")}</p>
                <p className="text-sm font-mono font-bold text-white">{record.capaCode}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("col.vessel")}</p>
                <p className="text-sm"><VesselLabel code={record.vesselCode} className="text-sm" showCode /></p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Equipo</p>
                <p className="text-sm text-white">{record.assetName ?? <span className="text-text-industrial/40 italic">— sin nombre —</span>}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("capa.sourceType")}</p>
                <p className="text-sm text-white">{SOURCE_TYPE_LABEL[record.sourceType] ?? record.sourceType}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">Origen</p>
                <p className="text-sm font-mono text-white">{record.sourceCode ?? <span className="text-text-industrial/40 italic">— origen no disponible —</span>}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("status.completed")}</p>
                <p className="text-sm text-white">{fmtDate(record.completedAt)}</p>
              </div>
              {record.actionsTaken && (
                <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-accent">Acciones realizadas (sugerido por responsable a bordo)</p>
                  <p className="text-sm text-white whitespace-pre-wrap mt-1">{record.actionsTaken}</p>
                </div>
              )}
              {record.verificationNote && (
                <div className="bg-success-sea/5 border border-success-sea/20 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-success-sea">Verificación de Gerencia Técnica</p>
                  <p className="text-sm text-white whitespace-pre-wrap mt-1">{record.verificationNote}</p>
                </div>
              )}
              {record.cancelReason && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-industrial/40">{t("capa.cancelReason")}</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{record.cancelReason}</p>
                </div>
              )}
            </div>

            {!isTerminal && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                <p className="text-xs text-text-industrial/80">{t("ai.capaDisclaimer")}</p>
                <button
                  type="button"
                  onClick={() => setRequestMessage(`Analizá esta CAPA y ayúdame a refinar el título, descripción y definir el responsable y fecha límite apropiados.`)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all"
                >
                  Asistir con IA
                </button>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.title")}</label>
              <input value={title} onChange={e => setTitle(e.target.value)} disabled={isTerminal} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.description")}</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} disabled={isTerminal} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.priority")}</label>
                <select value={priority} onChange={e => setPriority(e.target.value)} disabled={isTerminal} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50 disabled:opacity-60">
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("capa.owner")}</label>
                <input value={owner} onChange={e => setOwner(e.target.value)} disabled={isTerminal} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.dueDate")}</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={isTerminal} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60" />
              </div>
            </div>
            {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
          </div>
          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-white/10">
            <button
              type="button"
              onClick={() => { void downloadAuthedFile(`/app/pms/capa/${record.id}/pdf`, `${record.capaCode}-${record.vesselCode}.pdf`); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
              title="Descargar PDF"
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
            <div className="flex items-center gap-2">
            {(record.status === "OPEN" || record.status === "IN_PROGRESS") && (
              <button onClick={() => setShowCompleteModal(true)} className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent font-bold text-xs hover:brightness-110 transition-all">
                Sugerir cierre
              </button>
            )}
            {record.status === "PENDING_VERIFICATION" && (
              <button onClick={() => setShowCloseModal(true)} className="px-4 py-2 rounded-xl bg-success-sea/10 border border-success-sea/20 text-success-sea font-bold text-xs hover:brightness-110 transition-all">
                {t("capa.close")}
              </button>
            )}
            {canCancel && (
              <button onClick={() => setShowCancelModal(true)} className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-xs hover:bg-red-500/20 transition-all">
                {t("capa.cancel")}
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
            {!isTerminal && (
              <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
              </button>
            )}
            </div>
          </div>
        </div>
      </div>

      {showCompleteModal && <CompleteCapaModal capaId={record.id} onClose={() => setShowCompleteModal(false)} onSuccess={onSuccess} />}
      {showCloseModal && <CloseCapaModal capaId={record.id} actionsTaken={record.actionsTaken} onClose={() => setShowCloseModal(false)} onSuccess={onSuccess} />}
      {showCancelModal && <CancelCapaModal capaId={record.id} onClose={() => setShowCancelModal(false)} onSuccess={onSuccess} />}
    </>
  );
};

export const CapaPage: React.FC = () => {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<CapaRecord | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useCopilotEmitter(!editing ? { module: "CAPA", screen: "CAPA_LIST" } : null);

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const priorityFilter = (searchParams.get("priority") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const [vesselInput, setVesselInput] = useState(vesselFilter);

  useEffect(() => {
    setVesselInput(vesselFilter);
  }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; priority?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextPriority = next.priority !== undefined ? next.priority : priorityFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextPriority) params.set("priority", nextPriority); else params.delete("priority");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [priorityFilter, searchParams, setSearchParams, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/capa${query ? `?${query}` : ""}`;
  }, [priorityFilter, statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);

  const openDetail = useCallback(async (row: CapaRecord) => {
    setDetailLoadingId(row.id);
    setDetailError(null);
    try {
      const detailed = await api.get<CapaRecord>(`/app/pms/capa/${row.id}`);
      setEditing(detailed);
    } catch (err) {
      setEditing(row);
      setDetailError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle del CAPA.");
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  const columns: Column<CapaRecord>[] = useMemo(() => [
    {
      key: "capaCode",
      header: t("col.code"),
      render: row => <span className="font-mono font-bold text-white text-xs">{row.capaCode}</span>,
    },
    {
      key: "title",
      header: t("col.title"),
      render: row => <span className="font-medium text-white line-clamp-1">{row.title}</span>,
    },
    {
      key: "vesselCode",
      header: t("col.vessel"),
      render: row => <VesselLabel code={row.vesselCode} className="text-xs" showCode />,
    },
    {
      key: "priority",
      header: t("col.priority"),
      render: row => <PriorityBadge priority={row.priority} />,
    },
    {
      key: "status",
      header: t("col.status"),
      render: row => <StatusBadge status={row.status} />,
    },
    {
      key: "sourceType",
      header: t("capa.sourceType"),
      render: row => row.sourceType,
    },
    {
      key: "dueDate",
      header: t("col.dueDate"),
      render: row => fmtDate(row.dueDate),
    },
  ], [t]);

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldCheck} title={t("page.capa")} total={data?.total} onReload={reload}>
        <ExportExcelButton module="capa" />
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del CAPA...</div>}
      {detailError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{detailError}</p>}

      <DataTable columns={columns} data={data?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.capa")} onRowClick={row => { void openDetail(row); }} />

      {editing && (
        <CapaModal
          record={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
};
