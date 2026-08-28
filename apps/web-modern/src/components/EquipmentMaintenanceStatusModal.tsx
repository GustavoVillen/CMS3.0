// "Estado de mantenimiento de equipos" (acceso del Dashboard): semáforo con
// el peor estado entre los planes activos del equipo + el mismo historial de
// mantenimientos e inspecciones que ya se ve en la ficha del equipo
// (AssetHistory, reusado tal cual — misma fuente de datos, sin duplicar).
import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssetHistory } from "../pages/Assets";

interface PlanForStatus {
  id: string;
  status: string;
  executionStatus: string;
}

type Severity = "OVERDUE" | "UPCOMING" | "OK";

const SEVERITY_RANK: Record<string, Severity> = {
  OVERDUE: "OVERDUE",
  DUE: "UPCOMING",
  IN_WINDOW: "UPCOMING",
  UPCOMING: "UPCOMING",
  FUTURE: "OK",
  COMPLETED: "OK",
};

function worstSeverity(plans: PlanForStatus[]): Severity {
  let worst: Severity = "OK";
  for (const p of plans) {
    if (p.status !== "ACTIVE") continue;
    const sev = SEVERITY_RANK[p.executionStatus] ?? "OK";
    if (sev === "OVERDUE") return "OVERDUE";
    if (sev === "UPCOMING") worst = "UPCOMING";
  }
  return worst;
}

interface Props {
  assetId: string;
  onClose: () => void;
}

export const EquipmentMaintenanceStatusModal: React.FC<Props> = ({ assetId, onClose }) => {
  const t = useT();
  const [assetLabel, setAssetLabel] = useState<{ name: string | null; assetCode: string } | null>(null);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSeverity(null);
    setAssetLabel(null);
    Promise.all([
      api.get<{ name: string | null; assetCode: string }>(`/app/pms/assets/${encodeURIComponent(assetId)}`),
      api.get<{ items: PlanForStatus[] }>(`/app/pms/maintenance-plans?assetId=${encodeURIComponent(assetId)}&status=ACTIVE&limit=200`),
    ])
      .then(([asset, plansRes]) => {
        if (cancelled) return;
        setAssetLabel({ name: asset.name, assetCode: asset.assetCode });
        setSeverity(worstSeverity(plansRes.items ?? []));
      })
      .catch(() => { if (!cancelled) setSeverity("OK"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  const badge = {
    OVERDUE:  { icon: AlertTriangle, cls: "bg-danger/10 text-danger border-danger/25",   label: t("dashboard.equipmentStatus.overdue") },
    UPCOMING: { icon: Clock,         cls: "bg-warning/10 text-warning border-warning/25", label: t("dashboard.equipmentStatus.upcoming") },
    OK:       { icon: CheckCircle2,  cls: "bg-success/10 text-success border-success/25", label: t("dashboard.equipmentStatus.ok") },
  }[severity ?? "OK"];

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

        <div className="overflow-y-auto flex-1 min-h-0">
          <AssetHistory asset={{ id: assetId }} />
        </div>
      </div>
    </div>
  );
};
