import React, { Suspense, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { CopilotoPanel } from "./CopilotoPanel";
import { PageLoader } from "./PageLoader";
import { Outlet, useLocation } from "react-router-dom";
import { CopilotContextProvider } from "../lib/copilot-context";
import { useT, type TranslationKey } from "../lib/i18n";
import { TRASH_RESTORED_EVENT } from "../lib/delete-undo";

const TITLE_KEYS: Record<string, TranslationKey> = {
  "/":                  "page.dashboard",
  "/vessels":           "page.vessels",
  "/equipment":            "page.assets",
  "/maintenance-plans": "page.maintenancePlans",
  "/maintenance-sheet": "page.maintenanceSheet",
  "/maintenance-gantt": "page.maintenanceGantt",
  "/work-orders":       "page.workOrders",
  "/daily-reports":     "page.dailyReports",
  "/voyage-tank-reports": "page.voyageTankReports",
  "/reports":           "page.monthlyReports",
  "/defects":           "page.defects",
  "/deferrals":         "page.deferrals",
  "/drydock-specs":     "page.drydockSpecs",
  "/capa":              "page.capa",
  "/inspections":       "page.inspections",
  "/certificates":      "page.certificates",
  "/spares":            "page.spares",
  "/service-requests":  "page.serviceRequests",
  "/spare-requests":    "page.spareRequests",
  "/spare-receipts":    "page.spareReceipts",
  "/providers":         "page.providers",
  "/ai-insights":       "page.aiInsights",
  "/ai-documents":      "page.aiDocuments",
  "/fluid-analyses":    "page.fluidAnalyses",
  "/bitacora":          "page.bitacora",
  "/team":              "page.team",
  "/trash":             "page.trash",
  "/configuration":     "page.configuration",
};

export const Layout: React.FC = () => {
  const location = useLocation();
  const t = useT();
  const titleKey = TITLE_KEYS[location.pathname];
  const title = titleKey ? t(titleKey) : "CMS3.0";
  // Algo volvió de la papelera (Deshacer, Papelera o copiloto): la pantalla abierta
  // se vuelve a montar para que lo restaurado aparezca sin recargar a mano.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const onRestored = () => setReloadKey(k => k + 1);
    window.addEventListener(TRASH_RESTORED_EVENT, onRestored);
    return () => window.removeEventListener(TRASH_RESTORED_EVENT, onRestored);
  }, []);

  return (
    <CopilotContextProvider>
      <div className="flex h-screen bg-bg text-fg overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 transform-[translateZ(0)]">
          <Header title={title} />
          {/* scrollbar-gutter: el lugar de la barra vertical queda reservado siempre,
              así la pantalla no se corre de costado cuando la barra aparece o desaparece. */}
          <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-6 bg-bg">
            <Suspense fallback={<PageLoader />}>
              <React.Fragment key={reloadKey}><Outlet /></React.Fragment>
            </Suspense>
          </main>
        </div>
        <CopilotoPanel />
      </div>
    </CopilotContextProvider>
  );
};
