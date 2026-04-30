import React from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { CopilotoPanel } from "./CopilotoPanel";
import { Outlet, useLocation } from "react-router-dom";
import { CopilotContextProvider } from "../lib/copilot-context";

const TITLES: Record<string, string> = {
  "/":                  "Dashboard Principal",
  "/vessels":           "Gestión de Flota",
  "/assets":            "Inventario de Activos",
  "/maintenance-plans":  "Planes de Mantenimiento",
  "/maintenance-gantt":  "Gantt de Mantenimiento",
  "/work-orders":       "Órdenes de Trabajo",
  "/daily-reports":     "Reportes Diarios",
  "/defects":           "Defectos",
  "/deferrals":         "Postergaciones",
  "/inspections":       "Inspecciones",
  "/certificates":      "Certificados",
  "/spares":            "Repuestos & Stock",
  "/spare-requests":    "Solicitudes de Repuestos",
  "/spare-receipts":    "Recepción de Repuestos",
  "/providers":         "Proveedores",
  "/ai-insights":       "Inteligencia Predictiva",
  "/ai-documents":      "AI Documents",
  "/fluid-analyses":    "Análisis de Fluidos",
  "/bitacora":          "Bitácora del Sistema",
};

export const Layout: React.FC = () => {
  const location = useLocation();
  const title = TITLES[location.pathname] ?? "CMS";

  return (
    <CopilotContextProvider>
      <div className="flex h-screen bg-primary-bg text-text-industrial overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 transform-[translateZ(0)]">
          <Header title={title} />
          <main className="flex-1 overflow-y-auto p-6 bg-[#080D1D]">
            <Outlet />
          </main>
        </div>
        <CopilotoPanel />
      </div>
    </CopilotContextProvider>
  );
};
