import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { PlatformAuthProvider, usePlatformAuth } from "./lib/platform-auth";
import { I18nProvider, type Locale } from "./lib/i18n";
import { Layout } from "./components/Layout";
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
import { MaintenancePlansPage } from "./pages/MaintenancePlans";
import { MaintenanceGanttPage } from "./pages/MaintenanceGantt";
import { VesselSuperintendentsPage } from "./pages/VesselSuperintendents";
import { TeamPage } from "./pages/Team";
import { DailyReportsPage } from "./pages/DailyReports";
import { DeferralsPage } from "./pages/Deferrals";
import { CapaPage } from "./pages/Capa";
import { RcaPage } from "./pages/Rca";
import { SpareOrdersPage } from "./pages/SpareOrders";
import { ProvidersPage } from "./pages/Providers";
import { ProfilePage } from "./pages/Profile";
import { PlatformLogin } from "./pages/platform/PlatformLogin";
import { PlatformTenantsPage } from "./pages/platform/PlatformTenants";
import { PlatformUsersPage } from "./pages/platform/PlatformUsers";
import { PlatformAuditPage } from "./pages/platform/PlatformAudit";
import { PlatformPromptsPage } from "./pages/platform/PlatformPrompts";
import { BitacoraPage } from "./pages/Bitacora";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequirePlatformAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = usePlatformAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/platform/login" replace />;
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
              <Route path="prompts" element={<PlatformPromptsPage />} />
            </Route>

            {/* ── Tenant ── */}
            <Route path="/login" element={<TenantLoginRedirect />} />
            <Route element={<RequireAuth><TenantI18nWrapper><Layout /></TenantI18nWrapper></RequireAuth>}>
              <Route path="/"                  element={<Dashboard />} />
              <Route path="/due-items"         element={<DueItemsPage />} />
              <Route path="/superintendents"   element={<VesselSuperintendentsPage />} />
              <Route path="/team"              element={<TeamPage />} />
              <Route path="/vessels"           element={<VesselsPage />} />
              <Route path="/assets"            element={<AssetsPage />} />
              <Route path="/maintenance-plans" element={<MaintenancePlansPage />} />
              <Route path="/maintenance-gantt" element={<MaintenanceGanttPage />} />
              <Route path="/work-orders"       element={<WorkOrdersPage />} />
              <Route path="/daily-reports"     element={<DailyReportsPage />} />
              <Route path="/defects"           element={<DefectsPage />} />
              <Route path="/deferrals"         element={<DeferralsPage />} />
              <Route path="/rca"               element={<RcaPage />} />
              <Route path="/capa"              element={<CapaPage />} />
              <Route path="/inspections"       element={<InspectionsPage />} />
              <Route path="/certificates"      element={<CertificatesPage />} />
              <Route path="/spares"            element={<SparesPage />} />
              <Route path="/spare-orders"      element={<SpareOrdersPage />} />
              <Route path="/providers"         element={<ProvidersPage />} />
              <Route path="/ai-insights"       element={<AiInsightsPage />} />
              <Route path="/ai-documents"      element={<AiDocumentsPage />} />
              <Route path="/bitacora"          element={<BitacoraPage />} />
              <Route path="/profile"           element={<ProfilePage />} />
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
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}

function TenantLoginRedirect() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : <Login />;
}
