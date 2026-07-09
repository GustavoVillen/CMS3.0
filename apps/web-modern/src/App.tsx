import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { PlatformAuthProvider, usePlatformAuth } from "./lib/platform-auth";
import { I18nProvider, type Locale, type Vocab } from "./lib/i18n";
import { VesselProvider } from "./lib/vessel-context";
import { EscapeGuardProvider } from "./lib/escape-guard";
import { NotificationsProvider } from "./lib/notifications";
import { Layout } from "./components/Layout";
import { MobileLayout } from "./components/MobileLayout";
import { PlatformLayout } from "./components/PlatformLayout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { DueItemsPage } from "./pages/DueItems";
import { VesselsPage } from "./pages/Vessels";
import { AssetsPage } from "./pages/Assets";
import { WorkOrdersPage } from "./pages/WorkOrders";
import { SparesPage } from "./pages/Spares";
import { CertificatesPage } from "./pages/Certificates";
import { InspectionsPage } from "./pages/Inspections";
import { DefectsPage } from "./pages/Defects";
import { AiInsightsPage } from "./pages/AiInsights";
import { AiDocumentsPage } from "./pages/AiDocuments";
import { FluidAnalysesPage } from "./pages/FluidAnalyses";
import { MaintenancePlansPage } from "./pages/MaintenancePlans";
import { MaintenanceGanttPage } from "./pages/MaintenanceGantt";
import { MaintenanceWorkloadPage } from "./pages/MaintenanceWorkload";
import { ReliabilityPage } from "./pages/Reliability";
// DORMANTE — Modos de Falla (RCM): reactivar descomentando este import y la ruta de abajo.
// import { FailureModesPage } from "./pages/FailureModes";
import { VesselSuperintendentsPage } from "./pages/VesselSuperintendents";
import { TeamPage } from "./pages/Team";
import { DailyReportsPage } from "./pages/DailyReports";
import { DeferralsPage } from "./pages/Deferrals";
// DORMANTE — CAPA: módulo oculto de la entrega (simplificación). Reactivar descomentando
// este import y las rutas /capa de abajo, + el ítem del Sidebar, + el flag CAPA_AUTO_CREATE.
// import { CapaPage } from "./pages/Capa";
import { SpareRequestsPage } from "./pages/SpareRequests";
import { SpareReceiptsPage } from "./pages/SpareReceipts";
import { MonthlyReportsPage } from "./pages/MonthlyReports";
import { ProvidersPage } from "./pages/Providers";
import { ProfilePage } from "./pages/Profile";
import { ConfigurationPage } from "./pages/Configuration";
import { PlatformLogin } from "./pages/platform/PlatformLogin";
import { PlatformTenantsPage } from "./pages/platform/PlatformTenants";
import { PlatformUsersPage } from "./pages/platform/PlatformUsers";
import { PlatformAuditPage } from "./pages/platform/PlatformAudit";
import { PlatformUsagePage } from "./pages/platform/PlatformUsage";
import { PlatformCopilotQuestionsPage } from "./pages/platform/PlatformCopilotQuestions";
import { PlatformPromptsPage } from "./pages/platform/PlatformPrompts";
import { PlatformVesselMapPage } from "./pages/platform/PlatformVesselMap";
import { VesselMapPage } from "./pages/VesselMap";
import { BitacoraPage } from "./pages/Bitacora";
import { CrewPage } from "./pages/Crew";
import { DrillsPage } from "./pages/Drills";
import { PermitsPage } from "./pages/Permits";
import { ExternalAuditsPage } from "./pages/ExternalAudits";
import { NearMissPage } from "./pages/NearMiss";
import { RestHoursPage } from "./pages/RestHours";
import { ChecklistsPage } from "./pages/Checklists";
import { CrewMatrixPage } from "./pages/CrewMatrix";
import { RequirementsMatrixPage } from "./pages/RequirementsMatrix";
import { MocPage } from "./pages/Moc";
import { TmsaPage } from "./pages/Tmsa";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  // Guardamos la ubicación pedida para volver a ella tras el login (deep-links).
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" state={{ from: location }} replace />;
}

function RequirePlatformAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = usePlatformAuth();
  if (!isAuthenticated) return <Navigate to="/platform/login" replace />;
  // Defense-in-depth: only SUPERADMIN can reach platform pages.
  // Backend enforces this on every request; frontend just avoids rendering
  // pages that would 403 the user immediately.
  if (user?.role !== "SUPERADMIN") return <AccessDenied />;
  return <>{children}</>;
}

/** Restrict a tenant route to a specific list of roles. */
function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <AccessDenied />;
  return <>{children}</>;
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-text-industrial/40">
      <h2 className="text-2xl font-bold text-fg">Acceso denegado</h2>
      <p className="text-sm">No tenés permiso para ver esta página.</p>
      <a href="/" className="text-xs text-accent hover:underline">Volver al inicio</a>
    </div>
  );
}

const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="flex flex-col items-center justify-center h-full text-text-industrial/20 gap-4">
    <h2 className="text-3xl font-bold">{title}</h2>
    <p className="text-sm">Este módulo estará disponible próximamente.</p>
  </div>
);

// ---------------------------------------------------------------------------
// App — flat single-level Routes, both providers always mounted
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <AuthProvider>
      <PlatformAuthProvider>
        <BrowserRouter>
          <Routes>
            {/* ── Platform super-admin ── */}
            <Route path="/platform/login" element={<PlatformLoginRedirect />} />
            <Route path="/platform" element={<RequirePlatformAuth><PlatformLayout /></RequirePlatformAuth>}>
              <Route index element={<Navigate to="/platform/tenants" replace />} />
              <Route path="tenants" element={<PlatformTenantsPage />} />
              <Route path="users"   element={<PlatformUsersPage />} />
              <Route path="audit"   element={<PlatformAuditPage />} />
              <Route path="usage"      element={<PlatformUsagePage />} />
              <Route path="copilot-questions" element={<PlatformCopilotQuestionsPage />} />
              <Route path="vessel-map" element={<PlatformVesselMapPage />} />
              <Route path="prompts"    element={<PlatformPromptsPage />} />
            </Route>

            {/* ── Tenant mobile ── */}
            <Route path="/m" element={<RequireAuth><TenantI18nWrapper><MobileLayout /></TenantI18nWrapper></RequireAuth>} />

            {/* ── Tenant ── */}
            <Route path="/login" element={<TenantLoginRedirect />} />
            <Route element={<RequireAuth><TenantI18nWrapper><Layout /></TenantI18nWrapper></RequireAuth>}>
              <Route path="/"                  element={<Dashboard />} />
              <Route path="/due-items"         element={<DueItemsPage />} />
              <Route path="/superintendents"   element={<RequireRole roles={["TENANT_ADMIN"]}><VesselSuperintendentsPage /></RequireRole>} />
              <Route path="/team"              element={<RequireRole roles={["TENANT_ADMIN"]}><TeamPage /></RequireRole>} />
              <Route path="/vessels"           element={<VesselsPage />} />
              <Route path="/assets"            element={<AssetsPage />} />
              <Route path="/maintenance-plans" element={<MaintenancePlansPage />} />
              <Route path="/maintenance-plans/:code" element={<MaintenancePlansPage />} />
              <Route path="/maintenance-gantt" element={<MaintenanceGanttPage />} />
              <Route path="/maintenance-workload" element={<MaintenanceWorkloadPage />} />
              <Route path="/reliability"       element={<ReliabilityPage />} />
              {/* DORMANTE — Modos de Falla (RCM): reactivar descomentando (y el import arriba). */}
              {/* <Route path="/failure-modes"     element={<FailureModesPage />} /> */}
              <Route path="/work-orders"       element={<WorkOrdersPage />} />
              <Route path="/work-orders/:code" element={<WorkOrdersPage />} />
              <Route path="/daily-reports"     element={<DailyReportsPage />} />
              <Route path="/defects"           element={<DefectsPage />} />
              <Route path="/defects/:code"     element={<DefectsPage />} />
              <Route path="/deferrals"         element={<DeferralsPage />} />
              <Route path="/deferrals/:code"   element={<DeferralsPage />} />
              {/* DORMANTE — CAPA: reactivar descomentando (y el import arriba + Sidebar). */}
              {/* <Route path="/capa"              element={<CapaPage />} /> */}
              {/* <Route path="/capa/:code"        element={<CapaPage />} /> */}
              <Route path="/inspections"       element={<InspectionsPage />} />
              <Route path="/certificates"      element={<CertificatesPage />} />
              <Route path="/spares"            element={<SparesPage />} />
              <Route path="/spare-requests"    element={<SpareRequestsPage />} />
              <Route path="/spare-receipts"    element={<SpareReceiptsPage />} />
              <Route path="/reports"           element={<MonthlyReportsPage />} />
              <Route path="/tmsa"              element={<RequireRole roles={["TENANT_ADMIN", "FLEET_SUPERINTENDENT", "MAINTENANCE_MANAGER"]}><TmsaPage /></RequireRole>} />
              <Route path="/providers"         element={<ProvidersPage />} />
              <Route path="/ai-insights"       element={<AiInsightsPage />} />
              <Route path="/ai-documents"      element={<AiDocumentsPage />} />
              <Route path="/fluid-analyses"    element={<FluidAnalysesPage />} />
              <Route path="/bitacora"          element={<BitacoraPage />} />
              <Route path="/crew"              element={<CrewPage />} />
              <Route path="/drills"            element={<DrillsPage />} />
              <Route path="/permits"           element={<PermitsPage />} />
              <Route path="/external-audits"   element={<ExternalAuditsPage />} />
              <Route path="/near-miss"         element={<NearMissPage />} />
              <Route path="/near-miss/:code"   element={<NearMissPage />} />
              <Route path="/rest-hours"        element={<RestHoursPage />} />
              <Route path="/checklists"        element={<ChecklistsPage />} />
              <Route path="/crew-matrix"       element={<CrewMatrixPage />} />
              <Route path="/crew-requirements-matrix" element={<RequireRole roles={["TENANT_ADMIN"]}><RequirementsMatrixPage /></RequireRole>} />
              <Route path="/moc"               element={<MocPage />} />
              <Route path="/moc/:code"         element={<MocPage />} />
              <Route path="/vessel-map"        element={<RequireRole roles={["TENANT_ADMIN"]}><VesselMapPage /></RequireRole>} />
              <Route path="/profile"           element={<ProfilePage />} />
              <Route path="/configuration"     element={<RequireRole roles={["TENANT_ADMIN"]}><ConfigurationPage /></RequireRole>} />
              <Route path="*"                  element={<PlaceholderPage title="Módulo en Desarrollo" />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PlatformAuthProvider>
    </AuthProvider>
  );
}

function PlatformLoginRedirect() {
  const { isAuthenticated } = usePlatformAuth();
  return isAuthenticated ? <Navigate to="/platform/tenants" replace /> : <PlatformLogin />;
}

function TenantI18nWrapper({ children }: { children: React.ReactNode }) {
  const { tenant } = useAuth();
  const locale = (tenant?.locale ?? "es") as Locale;
  // Mercurio gestiona las OT como "Solicitudes de Servicio" (SS) — vocabulario propio.
  const vocab: Vocab = tenant?.workOrderPdfTemplate === "MERCURIO" ? "SS" : null;
  return (
    <I18nProvider locale={locale} vocab={vocab}>
      <VesselProvider>
        <NotificationsProvider>
          <EscapeGuardProvider>
            {children}
          </EscapeGuardProvider>
        </NotificationsProvider>
      </VesselProvider>
    </I18nProvider>
  );
}

function TenantLoginRedirect() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : <Login />;
}
