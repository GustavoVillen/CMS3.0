import React from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { CopilotoPanel } from "./CopilotoPanel";
import { Outlet, useLocation } from "react-router-dom";
import { CopilotContextProvider } from "../lib/copilot-context";
import { useT, type TranslationKey } from "../lib/i18n";

const TITLE_KEYS: Record<string, TranslationKey> = {
  "/":                  "page.dashboard",
  "/vessels":           "page.vessels",
  "/assets":            "page.assets",
  "/maintenance-plans": "page.maintenancePlans",
  "/maintenance-gantt": "page.maintenanceGantt",
  "/work-orders":       "page.workOrders",
  "/daily-reports":     "page.dailyReports",
  "/reports":           "page.monthlyReports",
  "/defects":           "page.defects",
  "/deferrals":         "page.deferrals",
  "/capa":              "page.capa",
  "/inspections":       "page.inspections",
  "/certificates":      "page.certificates",
  "/spares":            "page.spares",
  "/spare-requests":    "page.spareRequests",
  "/spare-receipts":    "page.spareReceipts",
  "/providers":         "page.providers",
  "/ai-insights":       "page.aiInsights",
  "/ai-documents":      "page.aiDocuments",
  "/fluid-analyses":    "page.fluidAnalyses",
  "/bitacora":          "page.bitacora",
  "/team":              "page.team",
  "/configuration":     "page.configuration",
};

export const Layout: React.FC = () => {
  const location = useLocation();
  const t = useT();
  const titleKey = TITLE_KEYS[location.pathname];
  const title = titleKey ? t(titleKey) : "CMS3.0";

  return (
    <CopilotContextProvider>
      <div className="flex h-screen bg-bg text-fg overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 transform-[translateZ(0)]">
          <Header title={title} />
          <main className="flex-1 overflow-y-auto p-6 bg-bg">
            <Outlet />
          </main>
        </div>
        <CopilotoPanel />
      </div>
    </CopilotContextProvider>
  );
};
