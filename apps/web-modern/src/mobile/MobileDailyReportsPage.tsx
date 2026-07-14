// MobileDailyReportsPage — página móvil standalone SOLO de Reportes Diarios.
//
// Pensada para dar a Capitán / Jefe de Máquinas (y demás roles con permiso) un
// link directo (/m-daily-reports) que abre únicamente la carga de reportes
// diarios, sin la app completa (/m con sus tabs). Reutiliza el mismo componente
// MobileDailyReport que usa el layout móvil; solo aporta el marco mínimo:
// header con logo, selector de buque y logout. El backend sigue siendo el que
// decide quién puede guardar (daily-reports-service).

import React from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { CmsLogo } from "../components/CmsLogo";
import { MobileDailyReport } from "./MobileDailyReport";

export const MobileDailyReportsPage: React.FC = () => {
  const { tenant, logout } = useAuth();
  const { vessels, selectedVesselCode, setSelectedVesselCode, selectedVessel } = useVesselContext();

  return (
    <div className="flex flex-col h-screen bg-surface dark:bg-[#0A1A2A] overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 px-4 py-2.5 border-b border-fg/10 flex items-center gap-3 bg-surface dark:bg-[#0D1B2A]">
        <CmsLogo className="w-7 h-7 shrink-0" title={tenant?.name ?? "CMS3.0"} />

        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-widest text-accent font-bold leading-none">Reportes Diarios</span>
          {vessels.length > 1 ? (
            <select
              value={selectedVesselCode ?? ""}
              onChange={e => setSelectedVesselCode(e.target.value || null)}
              className="mt-1 bg-fg/5 border border-fg/10 rounded-lg px-2 py-1 text-xs text-fg focus:outline-none focus:border-accent/50 appearance-none min-w-0"
            >
              <option value="">— Elegí un buque —</option>
              {vessels.map(v => (
                <option key={v.code} value={v.code}>{v.name}</option>
              ))}
            </select>
          ) : selectedVessel ? (
            <span className="text-xs text-text-industrial/50 truncate">{selectedVessel.name}</span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={logout}
          className="shrink-0 p-2 -mr-1 text-text-industrial/40 hover:text-fg transition-colors"
          aria-label="Cerrar sesión"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <MobileDailyReport />
      </main>
    </div>
  );
};
