import React, { useState } from "react";
import { ScrollText, FileSpreadsheet, ExternalLink, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFetch } from "../lib/hooks";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/auth";

interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogResponse {
  items: AuditLogItem[];
  total: number;
}

const ENTITY_LABELS: Record<string, string> = {
  MaintenancePlan:     "Plan Mtto.",
  WorkOrder:           "OT",
  Vessel:              "Buque",
  Asset:               "Activo",
  Defect:              "Defecto",
  Deferral:            "Diferimiento",
  Certificate:         "Certificado",
  Spare:               "Repuesto",
  Capa:                "CAPA",
  InspectionExecution: "Inspección",
};

const ENTITY_ROUTE: Record<string, string> = {
  MaintenancePlan:     "/maintenance-plans",
  WorkOrder:           "/work-orders",
  Defect:              "/defects",
  Deferral:            "/deferrals",
  Capa:                "/capa",
  Certificate:         "/certificates",
  Spare:               "/spares",
  Vessel:              "/vessels",
  Asset:               "/assets",
  InspectionExecution: "/inspections",
};

const ENTITY_TYPES = Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }));

function actionBadgeCls(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("created"))   return "bg-green-500/10 text-green-400 border-green-500/20";
  if (a.includes("executed"))  return "bg-teal-500/10 text-teal-400 border-teal-500/20";
  if (a.includes("completed")) return "bg-teal-500/10 text-teal-400 border-teal-500/20";
  if (a.includes("closed"))    return "bg-teal-500/10 text-teal-400 border-teal-500/20";
  if (a.includes("approved"))  return "bg-green-500/10 text-green-400 border-green-500/20";
  if (a.includes("updated"))   return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (a.includes("started"))   return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  if (a.includes("held"))      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  if (a.includes("opened"))    return "bg-accent/10 text-accent border-accent/20";
  if (a.includes("cancelled")) return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  if (a.includes("deferred"))  return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  if (a.includes("rejected"))  return "bg-red-500/10 text-red-400 border-red-500/20";
  if (a.includes("deleted"))   return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-white/5 text-text-industrial/60 border-white/10";
}

function actionLabel(action: string): string {
  const dot = action.indexOf(".");
  const raw = dot !== -1 ? action.slice(dot + 1) : action;
  const map: Record<string, string> = {
    created: "CREADO", updated: "MODIFICADO", deleted: "ELIMINADO",
    executed: "EJECUTADO", completed: "COMPLETADO", started: "INICIADO",
    closed: "CERRADO", approved: "APROBADO", cancelled: "CANCELADO",
    held: "EN ESPERA", opened: "ABIERTO", deferred: "APLAZADO",
    rejected: "RECHAZADO",
  };
  const key = raw.toLowerCase();
  return map[key] ?? raw.toUpperCase();
}

function refCode(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "—";
  const val = [
    metadata.workOrderCode, metadata.taskCode, metadata.defectCode,
    metadata.deferralCode, metadata.capaCode,
    metadata.orderCode, metadata.certificateCode, metadata.assetCode,
    metadata.executionCode, metadata.requestCode, metadata.sku, metadata.code,
  ].find(v => typeof v === "string" && v.length > 0);
  return typeof val === "string" ? val : "—";
}

function vesselCode(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  return typeof metadata.vesselCode === "string" ? metadata.vesselCode : null;
}

function s(v: unknown): string { return typeof v === "string" ? v : ""; }
function n(v: unknown): number { return typeof v === "number" ? v : 0; }

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre", status: "Estado", owner: "Armador", vesselType: "Tipo",
  imo: "IMO", registration: "Matrícula", powerHp: "Potencia (HP)", dwtTons: "DWT",
  lengthM: "Eslora (m)", beamM: "Manga (m)", depthM: "Puntal (m)",
  trnTn: "TRN", trbTn: "TRB", buildYear: "Año construcción", buildCountry: "País constr.",
  incorporationDate: "Fecha incorporación", incorporationType: "Tipo incorporación",
  criticality: "Criticidad", manufacturer: "Fabricante", model: "Modelo",
  serialNumber: "N° serie", installationDate: "Fecha instalación",
  lastOverhaulDate: "Último OH", replacementDate: "Reemplazo",
  trackDailyReport: "Seguimiento diario", sfiCode: "SFI",
  issuingAuthority: "Autoridad", issueDate: "Emisión", expiryDate: "Vencimiento",
  lastInspectionDate: "Última inspección", notes: "Notas", assetId: "Equipo",
  category: "Categoría", contactName: "Contacto", contactEmail: "Email",
  contactPhone: "Teléfono", location: "Ubicación",
  unit: "Unidad", minStock: "Stock mín.", reorderPoint: "Punto reorden",
  targetStock: "Stock objetivo", leadTimeDays: "Lead time (días)",
  internalPartNumber: "P/N interno", manufacturerPartNumber: "P/N fabricante",
  longDescription: "Descripción larga",
};

function formatChanges(changes: Record<string, { from: unknown; to: unknown }>): string {
  return Object.entries(changes)
    .map(([key, { from, to }]) => {
      const label = FIELD_LABELS[key] ?? key;
      const fv = from != null ? String(from) : "—";
      const tv = to   != null ? String(to)   : "—";
      return `${label}: ${fv} → ${tv}`;
    })
    .join(" | ");
}

function detailLine(item: AuditLogItem): string {
  const m = item.metadata;
  if (!m) return "";

  // Explicit detail always wins
  if (typeof m.detail === "string" && m.detail.trim()) return m.detail.trim();

  const action = item.action;
  const entity = item.entityType;

  // Field-level diff (recorded on updated events)
  if (
    m.changes &&
    typeof m.changes === "object" &&
    !Array.isArray(m.changes) &&
    Object.keys(m.changes as object).length > 0 &&
    (action.toLowerCase().includes("updated") || action.toLowerCase().includes("modified"))
  ) {
    const changes = m.changes as Record<string, { from: unknown; to: unknown }>;
    const diffText = formatChanges(changes);
    if (diffText) return diffText;
  }

  // ── Stock adjustment ────────────────────────────────────────────────────────
  if (action === "STOCK_ADJUSTED") {
    const sku   = s(m.sku);
    const prev  = n(m.previousQty);
    const next  = n(m.newQty);
    const delta = n(m.delta);
    const unit  = s(m.unit);
    const sign  = delta >= 0 ? `+${delta}` : String(delta);
    const note  = s(m.notes);
    return [
      sku ? `[${sku}]` : "",
      `Stock ajustado: ${prev} → ${next} ${unit}`.trim(),
      `(${sign})`,
      note ? `— ${note}` : "",
    ].filter(Boolean).join(" ");
  }

  // ── Maintenance plan ────────────────────────────────────────────────────────
  if (entity === "MaintenancePlan") {
    const code  = s(m.taskCode);
    const title = s(m.title);
    if (action.includes("deleted"))   return `Plan eliminado: ${code} — ${title}`.replace(/ —\s*$/, "");
    if (action.includes("created"))   return `Plan creado: ${code} — ${title}`.replace(/ —\s*$/, "");
    if (action.includes("postponed") || action.includes("deferred"))
      return `Plan diferido: ${code}${s(m.newDueDate) ? ` → nuevo vencimiento: ${m.newDueDate}` : ""}`;
    if (action.includes("executed") || action.includes("closed"))
      return `Ejecución registrada: ${code}${s(m.result) ? ` — Resultado: ${m.result}` : ""}`;
    if (action === "OPENEDFROMPLAN" || action.includes("opened"))
      return `OT abierta desde plan ${code}${s(m.workOrderCode) ? ` → ${m.workOrderCode}` : ""}`;
    // updated (default)
    return `Plan modificado: ${code}${title ? ` — ${title}` : ""}`;
  }

  // ── Work order ───────────────────────────────────────────────────────────────
  if (entity === "WorkOrder") {
    const code  = s(m.workOrderCode ?? m.code);
    const title = s(m.title);
    const note  = s(m.holdReason ?? m.cancelReason ?? m.closeNotes ?? m.notes);
    if (action.includes("started"))   return `OT iniciada: ${code}${title ? ` — ${title}` : ""}`;
    if (action.includes("held"))      return `OT en espera: ${code}${note ? ` — ${note}` : ""}`;
    if (action.includes("cancelled")) return `OT cancelada: ${code}${note ? ` — ${note}` : ""}`;
    if (action.includes("closed"))    return `OT cerrada: ${code}${note ? ` — ${note}` : ""}`;
    if (action.includes("created") || action === "OPENEDFROMPLAN")
      return `OT creada: ${code}${title ? ` — ${title}` : ""}`;
    return `OT modificada: ${code}${title ? ` — ${title}` : ""}`;
  }

  // ── Spare ────────────────────────────────────────────────────────────────────
  if (entity === "Spare") {
    const sku  = s(m.sku);
    const name = s(m.name);
    if (action.includes("deleted")) return `Repuesto eliminado: ${sku}${name ? ` — ${name}` : ""}`;
    if (action.includes("created")) return `Repuesto dado de alta: ${sku}${name ? ` — ${name}` : ""}`;
    return `Repuesto modificado: ${sku}${name ? ` — ${name}` : ""}`;
  }

  // ── Asset ────────────────────────────────────────────────────────────────────
  if (entity === "Asset") {
    const code = s(m.assetCode);
    const name = s(m.name);
    if (action.includes("deleted")) return `Activo eliminado: ${code}${name ? ` — ${name}` : ""}`;
    if (action.includes("created")) return `Activo creado: ${code}${name ? ` — ${name}` : ""}`;
    return `Activo modificado: ${code}${name ? ` — ${name}` : ""}`;
  }

  // ── Defect ───────────────────────────────────────────────────────────────────
  if (entity === "Defect") {
    const code = s(m.defectCode ?? m.code);
    const desc = s(m.description ?? m.title ?? m.name);
    const sev  = s(m.severity);
    return [
      action.includes("created") ? "Defecto registrado" : action.includes("closed") ? "Defecto cerrado" : "Defecto modificado",
      code ? `: ${code}` : "",
      desc ? ` — ${desc}` : "",
      sev  ? ` (${sev})` : "",
    ].join("");
  }

  // ── Deferral ─────────────────────────────────────────────────────────────────
  if (entity === "Deferral") {
    const code   = s(m.deferralCode ?? m.code);
    const reason = s(m.reason ?? m.notes);
    return `Diferimiento${code ? ` ${code}` : ""}${reason ? `: ${reason}` : ""}`;
  }

  // ── Certificate ──────────────────────────────────────────────────────────────
  if (entity === "Certificate") {
    const code = s(m.certificateCode ?? m.code);
    const name = s(m.name ?? m.title);
    return `Certificado${code ? ` ${code}` : ""}${name ? ` — ${name}` : ""}`;
  }

  // ── Execution result (generic) ───────────────────────────────────────────────
  if (typeof m.result === "string") {
    const resultMap: Record<string, string> = {
      SATISFACTORIO:                "Satisfactorio",
      CON_DEFICIENCIAS:             "Con deficiencias",
      COMPLETED:                    "Completado",
      COMPLETED_WITH_OBSERVATIONS:  "Completado con observaciones",
      NOT_COMPLETED:                "No completado",
      FOLLOW_UP_REQUIRED:           "Requiere seguimiento",
    };
    const suffix = s(m.executedByName) ? ` — Por: ${m.executedByName}` : "";
    return `Resultado: ${resultMap[m.result] ?? m.result}${suffix}`;
  }

  // ── Fallback ─────────────────────────────────────────────────────────────────
  const text = s(m.holdReason ?? m.cancelReason ?? m.closeNotes ?? m.rejectionReason ?? m.title ?? m.name ?? m.notes);
  if (text.trim()) return text.trim();
  if (s(m.severity)) return `Severidad: ${m.severity}`;
  if (s(m.status))   return `Estado: ${m.status}`;
  return "";
}

const inputCls = "bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50";

function downloadAuditExcel(entityType: string, from: string, to: string) {
  const params = new URLSearchParams();
  if (entityType) params.set("entityType", entityType);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const token = localStorage.getItem("gpms_token") ?? "";
  const slug  = localStorage.getItem("gpms_tenant_slug") ?? "";
  fetch(`/app/audit/log/export?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Slug": slug },
  }).then(async r => {
    if (!r.ok) return;
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `bitacora_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  });
}

export const BitacoraPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams({ limit: "200" });
  if (entityType) params.set("entityType", entityType);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const path = `/app/audit/log?${params.toString()}`;
  const { data, loading, error, reload } = useFetch<AuditLogResponse>(path, [path]);

  if (user?.role !== "TENANT_ADMIN") {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-sm text-red-400">Acceso restringido a administradores del tenant.</p>
      </div>
    );
  }

  const clearFilters = () => { setEntityType(""); setFrom(""); setTo(""); };
  const hasFilters = !!(entityType || from || to);

  const handleRefClick = (e: React.MouseEvent, item: AuditLogItem) => {
    e.stopPropagation();
    const route = ENTITY_ROUTE[item.entityType];
    if (!route) return;
    const code = refCode(item.metadata);
    // Each page uses a different auto-open param
    if (item.entityType === "WorkOrder" && code !== "—") {
      navigate(`${route}?autoCode=${encodeURIComponent(code)}`);
    } else if (item.entityType === "Deferral" && code !== "—") {
      navigate(`${route}?autoCode=${encodeURIComponent(code)}`);
    } else if (item.entityType === "Defect" && item.entityId) {
      navigate(`${route}?defectId=${encodeURIComponent(item.entityId)}`);
    } else if (item.entityId) {
      // MaintenancePlan, Certificate, Spare, etc. — openId pattern
      navigate(`${route}?openId=${encodeURIComponent(item.entityId)}`);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={ScrollText} title="Bitácora del Sistema" total={data?.total} onReload={() => { void reload(); }}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => downloadAuditExcel(entityType, from, to)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Exportar Excel
          </button>
          <select value={entityType} onChange={e => setEntityType(e.target.value)} className={inputCls}>
            <option value="">Todos los tipos</option>
            {ENTITY_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          <span className="text-text-industrial/30 text-xs">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          {hasFilters && (
            <button onClick={clearFilters} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white transition-all">
              Limpiar
            </button>
          )}
        </div>
      </PageHeader>

      <div className="bento-card overflow-hidden p-0">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        )}
        {!loading && error && <p className="text-xs text-red-400 p-6">{error}</p>}
        {!loading && !error && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-text-industrial/40 text-[10px] uppercase tracking-widest">
                <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Fecha / Hora</th>
                <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                <th className="text-left px-4 py-3 font-semibold">Buque</th>
                <th className="text-left px-4 py-3 font-semibold">Referencia</th>
                <th className="text-left px-4 py-3 font-semibold">Acción</th>
                <th className="text-left px-4 py-3 font-semibold">Detalle</th>
                <th className="text-left px-4 py-3 font-semibold">Actor</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-industrial/30">
                    Sin registros en este período.
                  </td>
                </tr>
              ) : (
                (data?.items ?? []).map(item => {
                  const code   = refCode(item.metadata);
                  const vessel = vesselCode(item.metadata);
                  const detail = detailLine(item);
                  const canNav = !!(ENTITY_ROUTE[item.entityType] && item.entityId);

                  return (
                    <tr key={item.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-text-industrial/50">
                        <div className="text-xs">{new Date(item.createdAt).toLocaleDateString("es-AR")}</div>
                        <div className="text-[10px] text-text-industrial/30">
                          {new Date(item.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-industrial/60 whitespace-nowrap">
                        {ENTITY_LABELS[item.entityType] ?? item.entityType}
                      </td>
                      <td className="px-4 py-3">
                        {vessel
                          ? <span className="font-mono text-[10px] text-accent/80 bg-accent/5 border border-accent/10 rounded px-1.5 py-0.5">{vessel}</span>
                          : <span className="text-text-industrial/20">—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        {code !== "—" ? (
                          canNav ? (
                            <button
                              onClick={e => handleRefClick(e, item)}
                              className="flex items-center gap-1 font-mono font-bold text-[11px] text-accent hover:text-white bg-white/5 hover:bg-accent/10 border border-white/10 hover:border-accent/30 rounded px-1.5 py-0.5 transition-all"
                            >
                              {code} <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                            </button>
                          ) : (
                            <span className="font-mono font-bold text-[11px] text-white bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                              {code}
                            </span>
                          )
                        ) : (
                          <span className="text-text-industrial/20">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${actionBadgeCls(item.action)}`}>
                          {actionLabel(item.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-industrial/50 max-w-[280px]">
                        <span className="line-clamp-2 text-[11px] leading-relaxed">{detail || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-text-industrial/40 whitespace-nowrap">
                        {item.actorName ?? item.actorUserId ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
