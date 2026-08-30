// "Estado de mantenimiento de equipos" (acceso del Dashboard): semáforo con
// el peor estado entre los planes activos del equipo, el detalle de QUÉ tareas
// están vencidas o por vencer, y el mismo historial de mantenimientos e
// inspecciones que ya se ve en la ficha del equipo (AssetHistory, reusado tal
// cual — misma fuente de datos, sin duplicar).
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate } from "../lib/utils";
import { useT, type TranslationKey } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssetHistory } from "../pages/Assets";
import { worstSeverity, SEVERITY_RANK, SEVERITY_STYLE, type Severity, type PlanForStatus } from "../lib/maintenance-severity";

interface Props {
  assetId: string;
  onClose: () => void;
}

/**
 * Los campos del plan que hacen falta para listarlo. Es el mismo registro que
 * ya se pedía para calcular el semáforo: no se agrega ninguna consulta.
 */
interface PlanRow extends PlanForStatus {
  id: string;
  taskCode: string;
  title: string;
  nextDueDate: string | null;
  nextDueHours: number | null;
}

export const EquipmentMaintenanceStatusModal: React.FC<Props> = ({ assetId, onClose }) => {
  const t = useT();
  const navigate = useNavigate();
  const [assetLabel, setAssetLabel] = useState<{ name: string | null; assetCode: string } | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSeverity(null);
    setAssetLabel(null);
    setPlans([]);
    Promise.all([
      api.get<{ name: string | null; assetCode: string }>(`/app/pms/assets/${encodeURIComponent(assetId)}`),
      api.get<{ items: PlanRow[] }>(`/app/pms/maintenance-plans?assetId=${encodeURIComponent(assetId)}&status=ACTIVE&limit=200`),
    ])
      .then(([asset, plansRes]) => {
        if (cancelled) return;
        setAssetLabel({ name: asset.name, assetCode: asset.assetCode });
        setPlans(plansRes.items ?? []);
        setSeverity(worstSeverity(plansRes.items ?? []));
      })
      .catch(() => { if (!cancelled) setSeverity("OK"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  // Se clasifican con el MISMO mapa que pinta el semáforo (SEVERITY_RANK), así
  // el cartel de arriba y la lista de abajo no pueden contradecirse.
  const { overdue, upcoming } = useMemo(() => {
    const o: PlanRow[] = [];
    const u: PlanRow[] = [];
    for (const p of plans) {
      if (p.status !== "ACTIVE") continue;
      const sev = SEVERITY_RANK[p.executionStatus] ?? "OK";
      if (sev === "OVERDUE") o.push(p);
      else if (sev === "UPCOMING") u.push(p);
    }
    // Lo más vencido primero; los que vencen por horas y no por fecha, al final.
    const byDue = (a: PlanRow, b: PlanRow) =>
      (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999");
    return { overdue: o.sort(byDue), upcoming: u.sort(byDue) };
  }, [plans]);

  const sev: Severity = severity ?? "OK";
  const icon = { OVERDUE: AlertTriangle, UPCOMING: Clock, OK: CheckCircle2 }[sev];
  const badge = {
    icon,
    cls: SEVERITY_STYLE[sev].badge,
    label: t(SEVERITY_STYLE[sev].labelKey as TranslationKey),
  };

  /** Un bloque de tareas (vencidas o próximas). Vacío = no se dibuja nada. */
  const taskList = (rows: PlanRow[], rowSev: Severity, titleKey: TranslationKey) => {
    if (rows.length === 0) return null;
    const style = SEVERITY_STYLE[rowSev];
    return (
      <div className="shrink-0 space-y-1.5">
        <p className="text-[10px] uppercase tracking-widest text-text-industrial/40 font-semibold">
          {t(titleKey)} · {rows.length}
        </p>
        <div className="border border-fg/10 rounded-xl divide-y divide-fg/5 overflow-hidden">
          {rows.map(p => (
            <button
              key={p.id}
              type="button"
              // Abre el plan en su pantalla, que es donde se lo puede ejecutar
              // o reprogramar. Mismo deep-link que usa el panel TMSA.
              onClick={() => { onClose(); navigate(`/maintenance-plans?openId=${encodeURIComponent(p.id)}`); }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-fg/[0.04] transition-colors"
            >
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${style.chip.split(" ")[0]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-mono text-text-industrial/40">{p.taskCode}</p>
                <p className="text-xs text-fg/85 truncate">{p.title}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[9px] uppercase tracking-wider text-text-industrial/35">{t("col.nextDue")}</p>
                <p className={`text-xs font-bold ${style.chip.split(" ").slice(-1)[0]}`}>
                  {p.nextDueDate
                    ? fmtDate(p.nextDueDate)
                    : p.nextDueHours != null
                      ? `${p.nextDueHours.toLocaleString("es-AR")} h`
                      : "—"}
                </p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-text-industrial/25 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-fg truncate">
              {assetLabel?.name ?? assetLabel?.assetCode ?? t("common.loading")}
            </h2>
            {assetLabel?.name && (
              <p className="text-[10px] font-mono text-text-industrial/40">{assetLabel.assetCode}</p>
            )}
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-industrial/40 shrink-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
          </div>
        ) : (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border font-bold text-sm shrink-0 ${badge.cls}`}>
            <badge.icon className="w-5 h-5 shrink-0" />
            {badge.label}
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0 space-y-4">
          {/* Qué tareas son: sin esto el cartel dice "con tareas vencidas" y no
              hay forma de saber cuáles ni de ir a resolverlas. */}
          {!loading && taskList(overdue, "OVERDUE", "eqStatus.overdueTasks")}
          {!loading && taskList(upcoming, "UPCOMING", "eqStatus.upcomingTasks")}
          <AssetHistory asset={{ id: assetId }} />
        </div>
      </div>
    </div>
  );
};
