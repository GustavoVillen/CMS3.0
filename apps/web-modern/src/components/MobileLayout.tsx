import React, { useState } from "react";
import { LayoutDashboard, Bot, LogOut, Wrench, AlertTriangle, ClipboardList, Package, CalendarClock } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { CopilotContextProvider } from "../lib/copilot-context";
import { MobileCopilot } from "./MobileCopilot";
import { CmsLogo } from "./CmsLogo";
import { MobileDashboard } from "../mobile/MobileDashboard";
import { MobileWorkOrders } from "../mobile/MobileWorkOrders";
import { MobileDefects, type DefectsVoicePrefill } from "../mobile/MobileDefects";
import { MobileDailyReport } from "../mobile/MobileDailyReport";
import { MobileSpares } from "../mobile/MobileSpares";
import { MobilePlans, type PlansFilter } from "../mobile/MobilePlans";
import { QuickActionFab, type QuickAction } from "./QuickActionFab";
import { VoiceReportSheet } from "./VoiceReportSheet";
import { useEscapeGuard } from "../lib/escape-guard";

type Tab = "dashboard" | "planes" | "ots" | "defectos" | "diario" | "repuestos" | "copiloto";

// Alias para los tabs accesibles desde dashboard (omite "dashboard" — no
// tiene sentido navegar a sí mismo)
type DashboardTabTarget = Exclude<Tab, "dashboard"> | "panel";

interface TabDef {
  id: Tab;
  label: string;
  Icon: React.FC<{ className?: string }>;
}

const TABS: TabDef[] = [
  { id: "dashboard", label: "Panel",     Icon: LayoutDashboard },
  { id: "planes",    label: "Planes",    Icon: CalendarClock   },
  { id: "ots",       label: "OTs",       Icon: Wrench          },
  { id: "defectos",  label: "Defectos",  Icon: AlertTriangle   },
  { id: "diario",    label: "Diario",    Icon: ClipboardList   },
  { id: "repuestos", label: "Repuestos", Icon: Package         },
  { id: "copiloto",  label: "IA",        Icon: Bot             },
];

export const MobileLayout: React.FC = () => {
  const { tenant, logout }   = useAuth();
  const { vessels, selectedVesselCode, setSelectedVesselCode, selectedVessel } = useVesselContext();
  const [tab, setTab]        = useState<Tab>("dashboard");
  // Filtro inicial para el tab Planes — lo seta el dashboard cuando navega
  // con foco específico (ej. tocar "Vencidos" → filter "due")
  const [plansFilter, setPlansFilter] = useState<PlansFilter | undefined>(undefined);

  // Voice report state — vive en el layout para que cualquier acción (FAB o
  // dentro de Defectos) pueda abrir el mismo sheet.
  const [voiceType, setVoiceType] = useState<"defect" | "near_miss" | null>(null);
  // Prefill que MobileDefects consume al recibirlo (luego notifica consumed).
  const [defectsPrefill, setDefectsPrefill] = useState<DefectsVoicePrefill | null>(null);

  const navigateFromDashboard = (target: DashboardTabTarget, opts?: { plansFilter?: PlansFilter }) => {
    if (opts?.plansFilter) setPlansFilter(opts.plansFilter);
    if (target === "panel") setTab("dashboard");
    else setTab(target);
  };

  // Back button del sistema (Android / iOS swipe): si NO estamos en dashboard,
  // volver al dashboard. Los modales/sub-vistas que estén apilados arriba
  // tienen sus propios useEscapeGuard y se cierran primero (LIFO del stack).
  useEscapeGuard({
    enabled: tab !== "dashboard",
    isDirty: false,
    onClose: () => setTab("dashboard"),
  });

  // FAB quick-action: cada acción navega al tab correspondiente.
  const handleQuickAction = (a: QuickAction) => {
    switch (a) {
      case "defect":           setTab("defectos"); break;
      case "near-miss":        setTab("defectos"); break;
      case "defect-voice":     setVoiceType("defect"); break;
      case "near-miss-voice":  setVoiceType("near_miss"); break;
      case "photo":            setTab("ots"); break;
      case "wo-progress":      setTab("ots"); break;
    }
  };

  const handleVoiceComplete = (result: { type: "defect" | "near_miss"; fields: DefectsVoicePrefill["fields"] }) => {
    setVoiceType(null);
    setDefectsPrefill({ type: result.type, fields: result.fields });
    setTab("defectos");
  };

  return (
    <CopilotContextProvider>
      <div className="flex flex-col h-screen bg-[#0A1A2A] overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="shrink-0 px-4 py-2.5 border-b border-white/10 flex items-center gap-3 bg-[#0D1B2A]">
          <CmsLogo className="w-7 h-7 shrink-0" title={tenant?.displayName ?? "CMS"} />

          {vessels.length > 1 ? (
            <select
              value={selectedVesselCode ?? ""}
              onChange={e => setSelectedVesselCode(e.target.value || null)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-accent/50 appearance-none min-w-0"
            >
              <option value="">— Todos —</option>
              {vessels.map(v => (
                <option key={v.code} value={v.code}>{v.name}</option>
              ))}
            </select>
          ) : selectedVessel ? (
            <span className="flex-1 text-xs text-text-industrial/50 truncate">{selectedVessel.name}</span>
          ) : (
            <span className="flex-1" />
          )}

          <button
            type="button"
            onClick={logout}
            className="shrink-0 p-2 -mr-1 text-text-industrial/40 hover:text-white transition-colors"
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        {/* ── Content ────────────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-hidden">
          {tab === "dashboard"  && <div className="h-full overflow-y-auto"><MobileDashboard onNavigate={navigateFromDashboard} /></div>}
          {tab === "planes"     && <div className="h-full overflow-hidden flex flex-col"><MobilePlans initialFilter={plansFilter} /></div>}
          {tab === "ots"        && <div className="h-full overflow-hidden flex flex-col"><MobileWorkOrders /></div>}
          {tab === "defectos"   && <div className="h-full overflow-hidden flex flex-col"><MobileDefects prefill={defectsPrefill} onPrefillConsumed={() => setDefectsPrefill(null)} /></div>}
          {tab === "diario"     && <div className="h-full overflow-hidden flex flex-col"><MobileDailyReport /></div>}
          {tab === "repuestos"  && <div className="h-full overflow-hidden flex flex-col"><MobileSpares /></div>}
          {tab === "copiloto"   && <MobileCopilot />}
        </main>

        {/* ── FAB Acción rápida (sobre el bottom nav) ──────────────────────── */}
        {/* Lo ocultamos en tabs que ya tienen su propio "+" para no superponer. */}
        {tab !== "defectos" && <QuickActionFab onAction={handleQuickAction} />}

        {/* ── Voice report sheet (compartido layout-wide) ──────────────────── */}
        {voiceType && (
          <VoiceReportSheet
            forcedType={voiceType}
            onClose={() => setVoiceType(null)}
            onComplete={handleVoiceComplete}
          />
        )}

        {/* ── Bottom nav ─────────────────────────────────────────────────────── */}
        <nav className="shrink-0 grid grid-cols-7 border-t border-white/10 bg-[#0D1B2A]">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-0.5 py-2.5 transition-colors min-w-0 ${
                tab === id ? "text-accent" : "text-text-industrial/40 hover:text-white/60"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider truncate w-full text-center px-0.5">{label}</span>
            </button>
          ))}
        </nav>

      </div>
    </CopilotContextProvider>
  );
};
