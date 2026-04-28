import React, { useState } from "react";
import { LayoutDashboard, Bot, LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";
import { CopilotContextProvider } from "../lib/copilot-context";
import { Dashboard } from "../pages/Dashboard";
import { MobileCopilot } from "./MobileCopilot";

type Tab = "dashboard" | "copiloto";

export const MobileLayout: React.FC = () => {
  const { tenant, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <CopilotContextProvider>
      <div className="flex flex-col h-screen bg-[#0A1A2A] overflow-hidden">
        <header className="shrink-0 px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#0D1B2A]">
          <div className="text-sm font-bold text-white truncate">
            {tenant?.displayName ?? "GPMS"}
          </div>
          <button
            type="button"
            onClick={logout}
            className="p-2 -mr-2 text-text-industrial/40 hover:text-white transition-colors"
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        <main className="flex-1 overflow-hidden">
          {tab === "dashboard" ? (
            <div className="h-full overflow-y-auto p-3">
              <Dashboard />
            </div>
          ) : (
            <MobileCopilot />
          )}
        </main>

        <nav className="shrink-0 grid grid-cols-2 border-t border-white/10 bg-[#0D1B2A]">
          <button
            type="button"
            onClick={() => setTab("dashboard")}
            className={`flex flex-col items-center gap-1 py-3 transition-colors ${
              tab === "dashboard" ? "text-accent" : "text-text-industrial/40 hover:text-white/60"
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Panel</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("copiloto")}
            className={`flex flex-col items-center gap-1 py-3 transition-colors ${
              tab === "copiloto" ? "text-accent" : "text-text-industrial/40 hover:text-white/60"
            }`}
          >
            <Bot className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Copiloto</span>
          </button>
        </nav>
      </div>
    </CopilotContextProvider>
  );
};
