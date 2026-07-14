import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { PlatformAuthProvider, usePlatformAuth } from "./lib/platform-auth";
import { I18nProvider, type Locale, type Vocab } from "./lib/i18n";
import { VesselProvider } from "./lib/vessel-context";
import { EscapeGuardProvider } from "./lib/escape-guard";
import { NotificationsProvider } from "./lib/notifications";
// Marco y entrada — EAGER (se necesitan de inmediato, no ganan nada lazy).
import { Layout } from "./components/Layout";
import { PlatformLayout } from "./components/PlatformLayout";
import { Login } from "./pages/Login";
import { PageLoader } from "./components/PageLoader";

// ---------------------------------------------------------------------------
// Páginas cargadas BAJO DEMANDA (code-splitting por ruta).
//
// Cada página vive en su propio chunk y se descarga sólo al entrar a esa ruta,
// no todas de golpe al abrir la app. El <Suspense> que muestra el spinner
// mientras baja el chunk está: a nivel App (para el layout mobile) y dentro de
// Layout/PlatformLayout alrededor del <Outlet> (para no parpadear el marco al
// navegar entre páginas). Como las páginas usan named export, hay que mapear a
// { default } en cada import().
// ---------------------------------------------------------------------------

// Layout mobile completo (un usuario desktop nunca descarga /m ni sus vistas, y viceversa).
const MobileLayout = React.lazy(() => import("./components/MobileLayout").then(m => ({ default: m.MobileLayout })));
// Página móvil standalone SOLO de Reportes Diarios (link directo /m-daily-reports).
const MobileDailyReportsPage = React.lazy(() => import("./mobile/MobileDailyReportsPage").then(m => ({ default: m.MobileDailyReportsPage })));

// Tenant
const Dashboard = React.lazy(() => import("./pages/Dashboard").then(m => ({ default: m.Dashboard })));
const DueItemsPage = React.lazy(() => import("./pages/DueItems").then(m => ({ default: m.DueItemsPage })));
const VesselsPage = React.lazy(() => import("./pages/Vessels").then(m => ({ default: m.VesselsPage })));
const AssetsPage = React.lazy(() => import("./pages/Assets").then(m => ({ default: m.AssetsPage })));
const WorkOrdersPage = React.lazy(() => import("./pages/WorkOrders").then(m => ({ default: m.WorkOrdersPage })));
const SparesPage = React.lazy(() => import("./pages/Spares").then(m => ({ default: m.SparesPage })));
const CertificatesPage = React.lazy(() => import("./pages/Certificates").then(m => ({ default: m.CertificatesPage })));
const InspectionsPage = React.lazy(() => import("./pages/Inspections").then(m => ({ default: m.InspectionsPage })));
const DefectsPage = React.lazy(() => import("./pages/Defects").then(m => ({ default: m.DefectsPage })));
const AiInsightsPage = React.lazy(() => import("./pages/AiInsights").then(m => ({ default: m.AiInsightsPage })));
const AiDocumentsPage = React.lazy(() => import("./pages/AiDocuments").then(m => ({ default: m.AiDocumentsPage })));
const FluidAnalysesPage = React.lazy(() => import("./pages/FluidAnalyses").then(m => ({ default: m.FluidAnalysesPage })));
const MaintenancePlansPage = React.lazy(() => import("./pages/MaintenancePlans").then(m => ({ default: m.MaintenancePlansPage })));
const MaintenanceGanttPage = React.lazy(() => import("./pages/MaintenanceGantt").then(m => ({ default: m.MaintenanceGanttPage })));
// DORMANTE — Carga de Mantenimiento: reactivar descomentando esta línea, la ruta de abajo
// y el ítem del Sidebar (nav-items.tsx).
// const MaintenanceWorkloadPage = React.lazy(() => import("./pages/MaintenanceWorkload").then(m => ({ default: m.MaintenanceWorkloadPage })));
// DORMANTE — Confiabilidad: reactivar descomentando esta línea, la ruta de abajo
// y el ítem del Sidebar (nav-items.tsx).
// const ReliabilityPage = React.lazy(() => import("./pages/Reliability").then(m => ({ default: m.ReliabilityPage })));
// DORMANTE — Modos de Falla (RCM): reactivar descomentando esta línea y la ruta de abajo.
// const FailureModesPage = React.lazy(() => import("./pages/FailureModes").then(m => ({ default: m.FailureModesPage })));
const VesselSuperintendentsPage = React.lazy(() => import("./pages/VesselSuperintendents").then(m => ({ default: m.VesselSuperintendentsPage })));
const TeamPage = React.lazy(() => import("./pages/Team").then(m => ({ default: m.TeamPage })));
const DailyReportsPage = React.lazy(() => import("./pages/DailyReports").then(m => ({ default: m.DailyReportsPage })));
const DeferralsPage = React.lazy(() => import("./pages/Deferrals").then(m => ({ default: m.DeferralsPage })));
// DORMANTE — CAPA: módulo oculto de la entrega (simplificación). Reactivar descomentando
// esta línea y las rutas /capa de abajo, + el ítem del Sidebar, + el flag CAPA_AUTO_CREATE.
// const CapaPage = React.lazy(() => import("./pages/Capa").then(m => ({ default: m.CapaPage })));
const SpareRequestsPage = React.lazy(() => import("./pages/SpareRequests").then(m => ({ default: m.SpareRequestsPage })));
const SpareReceiptsPage = React.lazy(() => import("./pages/SpareReceipts").then(m => ({ default: m.SpareReceiptsPage })));
const MonthlyReportsPage = React.lazy(() => import("./pages/MonthlyReports").then(m => ({ default: m.MonthlyReportsPage })));
const ProvidersPage = React.lazy(() => import("./pages/Providers").then(m => ({ default: m.ProvidersPage })));
const ProfilePage = React.lazy(() => import("./pages/Profile").then(m => ({ default: m.ProfilePage })));
const ConfigurationPage = React.lazy(() => import("./pages/Configuration").then(m => ({ default: m.ConfigurationPage })));
const VesselMapPage = React.lazy(() => import("./pages/VesselMap").then(m => ({ default: m.VesselMapPage })));
const BitacoraPage = React.lazy(() => import("./pages/Bitacora").then(m => ({ default: m.BitacoraPage })));
const CrewPage = React.lazy(() => import("./pages/Crew").then(m => ({ default: m.CrewPage })));
const DrillsPage = React.lazy(() => import("./pages/Drills").then(m => ({ default: m.DrillsPage })));
const PermitsPage = React.lazy(() => import("./pages/Permits").then(m => ({ default: m.PermitsPage })));
const ExternalAuditsPage = React.lazy(() => import("./pages/ExternalAudits").then(m => ({ default: m.ExternalAuditsPage })));
const NearMissPage = React.lazy(() => import("./pages/NearMiss").then(m => ({ default: m.NearMissPage })));
const RestHoursPage = React.lazy(() => import("./pages/RestHours").then(m => ({ default: m.RestHoursPage })));
const ChecklistsPage = React.lazy(() => import("./pages/Checklists").then(m => ({ default: m.ChecklistsPage })));
const CrewMatrixPage = React.lazy(() => import("./pages/CrewMatrix").then(m => ({ default: m.CrewMatrixPage })));
const RequirementsMatrixPage = React.lazy(() => import("./pages/RequirementsMatrix").then(m => ({ default: m.RequirementsMatrixPage })));
const MocPage = React.lazy(() => import("./pages/Moc").then(m => ({ default: m.MocPage })));
const TmsaPage = React.lazy(() => import("./pages/Tmsa").then(m => ({ default: m.TmsaPage })));

// Platform (sólo SUPERADMIN — un tenant normal nunca descarga estos chunks)
const PlatformLogin = React.lazy(() => import("./pages/platform/PlatformLogin").then(m => ({ default: m.PlatformLogin })));
const PlatformTenantsPage = React.lazy(() => import("./pages/platform/PlatformTenants").then(m => ({ default: m.PlatformTenantsPage })));
const PlatformUsersPage = React.lazy(() => import("./pages/platform/PlatformUsers").then(m => ({ default: m.PlatformUsersPage })));
const PlatformAuditPage = React.lazy(() => import("./pages/platform/PlatformAudit").then(m => ({ default: m.PlatformAuditPage })));
const PlatformUsagePage = React.lazy(() => import("./pages/platform/PlatformUsage").then(m => ({ default: m.PlatformUsagePage })));
const PlatformCopilotQuestionsPage = React.lazy(() => import("./pages/platform/PlatformCopilotQuestions").then(m => ({ default: m.PlatformCopilotQuestionsPage })));
const PlatformPromptsPage = React.lazy(() => import("./pages/platform/PlatformPrompts").then(m => ({ default: m.PlatformPromptsPage })));
const PlatformVesselMapPage = React.lazy(() => import("./pages/platform/PlatformVesselMap").then(m => ({ default: m.PlatformVesselMapPage })));

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
// Error boundary para chunks lazy (resiliencia post-deploy)
// ---------------------------------------------------------------------------
//
// Al desplegar una versión nueva, cada página cambia de nombre de archivo (hash).
// Un usuario con la pestaña abierta y el HTML viejo, al entrar a una página que
// todavía no había cargado, pide un chunk que ya no existe → el import() falla.
// Lo detectamos y recargamos UNA vez para tomar la versión nueva. El guard por
// tiempo (sessionStorage) evita un loop si el fallo es real y no un deploy.

class ChunkErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const isChunkError = /ChunkLoadError|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg);
    if (isChunkError) {
      const KEY = "cms3_chunk_reload_at";
      let last = 0;
      try { last = Number(sessionStorage.getItem(KEY) || 0); } catch { /* noop */ }
      if (Date.now() - last > 10_000) {
        try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* noop */ }
        window.location.reload();
        return { failed: false };
      }
    }
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-3 text-fg bg-bg">
          <h2 className="text-xl font-bold">No se pudo cargar la pantalla</h2>
          <p className="text-sm text-text-industrial/50">Revisá tu conexión e intentá de nuevo.</p>
          <button onClick={() => window.location.reload()} className="text-sm text-accent hover:underline">
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// App — flat single-level Routes, both providers always mounted
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <AuthProvider>
      <PlatformAuthProvider>
        <BrowserRouter>
          <ChunkErrorBoundary>
            <Suspense fallback={<PageLoader full />}>
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
            {/* Link directo solo de Reportes Diarios (Capitán / Jefe de Máquinas). */}
            <Route path="/m-daily-reports" element={<RequireAuth><TenantI18nWrapper><MobileDailyReportsPage /></TenantI18nWrapper></RequireAuth>} />

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
              <Route path="/mantenimiento-express" element={<MaintenancePlansPage lockedResultMode="EXPRESS" />} />
              <Route path="/maintenance-gantt" element={<MaintenanceGanttPage />} />
              {/* DORMANTE — Carga de Mantenimiento: reactivar descomentando (y el import arriba + Sidebar). */}
              {/* <Route path="/maintenance-workload" element={<MaintenanceWorkloadPage />} /> */}
              {/* DORMANTE — Confiabilidad: reactivar descomentando (y el import arriba + Sidebar). */}
              {/* <Route path="/reliability"       element={<ReliabilityPage />} /> */}
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
            </Suspense>
          </ChunkErrorBoundary>
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
