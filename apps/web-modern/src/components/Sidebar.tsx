import React, { useState, useEffect } from "react";
import { api } from "../lib/api";
import { UserCircle, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useResizable } from "../lib/hooks";
import { useT } from "../lib/i18n";
import { useVesselContext } from "../lib/vessel-context";
import { useTheme } from "../lib/theme";
import { NAV } from "../lib/nav-items";
import { useHiddenNavPaths } from "../lib/nav-config";

interface SidebarCounts {
  // Fase 1
  workOrdersOpen: number; defectsOpen: number; deferralsOpen: number; capaOpen: number;
  certsExpiringOrExpired: number; nearMissOpen: number; restHoursViolations: number;
  externalAuditsFindingsOpen: number; mocOpen: number;
  // Fase 2 — "acciones requeridas" en el resto del sidebar
  maintenancePlansOverdue: number; dailyReportsMissing: number;
  fluidAnalysisCritical: number; spareRequestsPending: number;
  checklistsOverdue: number;
  permitsAttention: number; crewCertsAttention: number;
  drillsOverdue: number; sparesCriticalLow: number; providerNcOpen: number;
}

/** Mapeo path → key del counts object para mostrar badge.
 *  Todos los badges usan el mismo estilo ámbar — el badge sólo indica "hay
 *  acciones pendientes". La criticidad real del item se ve dentro de la pantalla. */
const BADGE_KEY: Record<string, keyof SidebarCounts> = {
  // Fase 1
  "/work-orders":      "workOrdersOpen",
  "/defects":          "defectsOpen",
  "/deferrals":        "deferralsOpen",
  "/capa":             "capaOpen",
  "/certificates":     "certsExpiringOrExpired",
  "/near-miss":        "nearMissOpen",
  "/rest-hours":       "restHoursViolations",
  "/external-audits":  "externalAuditsFindingsOpen",
  "/moc":              "mocOpen",
  // Fase 2
  "/maintenance-plans": "maintenancePlansOverdue",
  "/daily-reports":     "dailyReportsMissing",
  "/fluid-analyses":    "fluidAnalysisCritical",
  "/spare-requests":    "spareRequestsPending",
  "/checklists":        "checklistsOverdue",
  "/permits":           "permitsAttention",
  "/crew-matrix":       "crewCertsAttention",
  "/drills":            "drillsOverdue",
  "/spares":            "sparesCriticalLow",
  "/providers":         "providerNcOpen",
};


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function navItemCls(isActive: boolean, collapsed: boolean) {
  return [
    "flex items-center gap-2.5 rounded-lg transition-all duration-150 group relative",
    collapsed ? "justify-center px-0 py-2 mx-1" : "px-3 py-2",
    isActive
      ? "bg-accent/10 text-accent border border-accent/20"
      : "text-fg/70 hover:text-fg hover:bg-fg/5 border border-transparent dark:text-fg/50",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const COLLAPSED_W = 56;

export const Sidebar: React.FC = () => {
  const { tenant, user } = useAuth();
  const t = useT();
  const { theme } = useTheme();
  // Logo del tenant según el tema: en light el logo oscuro (logoUrl, "versión oscura
  // para fondo blanco"); en dark el claro (logoUrlLight). Fallback al que exista.
  const tenantLogo = tenant
    ? (theme === "dark"
        ? (tenant.logoUrlLight || tenant.logoUrl)
        : (tenant.logoUrl || tenant.logoUrlLight))
    : null;
  const { selectedVesselCode } = useVesselContext();
  // Paths ocultos por configuración del tenant (definidos por el admin en /configuration).
  const hiddenNavPaths = useHiddenNavPaths();
  const { width, startResize } = useResizable("gpms_sidebar_width", 240, 160, 360);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("gpms_sidebar_collapsed") === "true",
  );

  const toggle = () =>
    setCollapsed(v => {
      const next = !v;
      localStorage.setItem("gpms_sidebar_collapsed", String(next));
      return next;
    });

  // ── Sections expand/collapse state (persisted) ────────────────────────────
  // Default: todas las secciones expandidas.
  const [sectionsCollapsed, setSectionsCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("gpms_sidebar_sections") ?? "{}"); }
    catch { return {}; }
  });
  const toggleSection = (key: string) => {
    setSectionsCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("gpms_sidebar_sections", JSON.stringify(next));
      return next;
    });
  };

  // ── Sidebar counts (badges) — refreshed when vessel context changes ───────
  const [counts, setCounts] = useState<SidebarCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const qs = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
    const fetchCounts = () => {
      api.get<SidebarCounts>(`/app/dashboard/sidebar-counts${qs}`)
        .then(c => { if (!cancelled) setCounts(c); })
        .catch(() => { /* silent */ });
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 120_000); // refresh cada 2 min
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedVesselCode]);

  // ── My AI usage (this month) — % del tope mensual, badge junto a "Sistemas OK".
  // Polling cada 60s + refresco inmediato ante el evento global "ai-usage:changed"
  // que emite el cliente api (acciones one-shot) y el copiloto al terminar.
  const [aiUsage, setAiUsage] = useState<{ totalTokens: number; costUsd: number; pct: number | null; blocked: boolean } | null>(null);
  useEffect(() => {
    let stopped = false;
    const fetchUsage = () => {
      api.get<{ totalTokens: number; costUsd: number; budget: { pct: number; blocked: boolean } | null }>("/app/me/ai-usage")
        .then(s => { if (!stopped) setAiUsage({ totalTokens: s.totalTokens, costUsd: s.costUsd, pct: s.budget?.pct ?? null, blocked: s.budget?.blocked ?? false }); })
        .catch(() => { /* silent — no badge if it fails */ });
    };
    fetchUsage();
    const id = setInterval(fetchUsage, 60_000);
    window.addEventListener("ai-usage:changed", fetchUsage);
    return () => { stopped = true; clearInterval(id); window.removeEventListener("ai-usage:changed", fetchUsage); };
  }, []);

  const aiPct = aiUsage?.pct ?? null;
  const aiBadgeText = aiPct != null ? `IA ${Math.min(100, Math.round(aiPct))}%` : null;
  const aiBadgeTitle = aiUsage
    ? `Consumo IA del mes — ${Math.round(aiPct ?? 0)}% del tope mensual · ${aiUsage.totalTokens.toLocaleString("es-AR")} tokens (~US$ ${aiUsage.costUsd.toFixed(4)})`
    : "";
  const aiBadgeClass = aiPct == null
    ? "text-fg/30"
    : aiPct >= 100 ? "text-danger font-bold" : aiPct >= 80 ? "text-amber-500 font-semibold" : "text-fg/30";

  const effectiveWidth = collapsed ? COLLAPSED_W : width;

  return (
    <aside
      className="relative z-70 h-screen border-r border-border flex flex-col bg-surface dark:bg-[#0B132B]/50 dark:backdrop-blur-xl shrink-0 overflow-hidden"
      style={{ width: effectiveWidth, transition: "width 200ms ease" }}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className={`flex items-center border-b border-border shrink-0 ${collapsed ? "flex-col gap-2 py-3 px-0" : "justify-between px-4 py-4"}`}>
        <div className={`flex flex-col gap-2 min-w-0 ${collapsed ? "items-center" : "flex-1"}`}>
          {/* Tenant — arriba */}
          {tenant && !collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              {tenantLogo && (
                <img
                  src={tenantLogo}
                  alt=""
                  className="w-16 h-16 object-contain shrink-0"
                />
              )}
              <p className="text-sm font-bold text-fg leading-tight truncate">{tenant.name}</p>
            </div>
          )}
          {tenant && collapsed && tenantLogo && (
            <img
              src={tenantLogo}
              alt=""
              className="w-16 h-16 object-contain shrink-0"
            />
          )}
          {/* Sistema — abajo */}
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={theme === "dark" ? "/logo-white.png" : "/logo.png"}
              alt="CMS3.0"
              className="shrink-0 object-contain"
              style={{ width: 16, height: 16 }}
            />
            {!collapsed && (
              <div className="min-w-0">
                <p className="font-bold text-[8px] tracking-widest text-teal-600 dark:text-teal-400 leading-tight uppercase">CMS3.0 · Copilot Management System</p>
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          title={collapsed ? t("header.expandMenu") : t("header.collapseMenu")}
          className="w-6 h-6 flex items-center justify-center rounded-md text-fg/30 hover:text-fg hover:bg-fg/10 transition-all shrink-0"
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 space-y-3">
        {NAV.map(section => {
          const visible = section.items.filter(
            item =>
              (!item.roles || item.roles.includes(user?.role ?? "")) &&
              !hiddenNavPaths.includes(item.path),
          );
          if (visible.length === 0) return null;

          // Suma de badges del header de la sección — para mostrar contador
          // agregado cuando la sección está colapsada.
          const sectionTotal = counts
            ? visible.reduce((acc, item) => {
                const key = BADGE_KEY[item.path];
                return key ? acc + (counts[key] ?? 0) : acc;
              }, 0)
            : 0;
          const isSectionCollapsed = !collapsed && !!sectionsCollapsed[section.titleKey];

          return (
            <div key={section.titleKey}>
              {/* Section header (clickeable cuando el sidebar está expandido) */}
              {collapsed ? (
                <div className="mx-3 border-t border-border mb-2" />
              ) : (
                <button
                  onClick={() => toggleSection(section.titleKey)}
                  className="w-full px-4 mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-fg/55 hover:text-fg/80 dark:text-fg/25 dark:hover:text-fg/60 transition-colors select-none"
                >
                  <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isSectionCollapsed ? "-rotate-90" : ""}`} />
                  <span>{t(section.titleKey)}</span>
                  {isSectionCollapsed && sectionTotal > 0 && (
                    <span className="ml-auto px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-[9px] font-bold normal-case tracking-normal">
                      {sectionTotal}
                    </span>
                  )}
                </button>
              )}

              {/* Items */}
              {!isSectionCollapsed && (
                <div className={collapsed ? "space-y-0.5" : "px-2 space-y-0.5"}>
                  {visible.map(item => {
                    const label = t(item.labelKey);
                    const badgeKey = BADGE_KEY[item.path];
                    const badge = badgeKey && counts ? counts[badgeKey] : 0;
                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.end}
                        title={collapsed ? `${label}${badge > 0 ? ` (${badge})` : ""}` : undefined}
                        className={({ isActive }) => navItemCls(isActive, collapsed)}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="text-xs font-medium truncate flex-1">{label}</span>
                            {badge > 0 && (
                              <span className="shrink-0 ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-accent/15 text-accent border border-accent/30">
                                {badge > 99 ? "99+" : badge}
                              </span>
                            )}
                          </>
                        )}
                        {collapsed && badge > 0 && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className={`border-t border-border shrink-0 ${collapsed ? "py-3 px-0" : "p-2"}`}>
        <NavLink
          to="/profile"
          title={collapsed ? t("nav.profile") : undefined}
          className={({ isActive }) => navItemCls(isActive, collapsed)}
        >
          <UserCircle className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="text-xs font-medium">{t("nav.profile")}</span>}
        </NavLink>

        {!collapsed && (
          <div className="mt-2 px-3 py-2 rounded-xl bg-linear-to-br from-accent/10 to-transparent border border-accent/10">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success-sea animate-pulse shrink-0" />
              <span className="text-[11px] text-fg/40">{t("nav.statusOk")}</span>
              {aiBadgeText && user?.role === "TENANT_ADMIN" && (
                <span className={`text-[10px] ml-auto ${aiBadgeClass}`} title={aiBadgeTitle}>
                  {aiBadgeText}
                </span>
              )}
            </div>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center mt-2">
            <div className="w-2 h-2 rounded-full bg-success-sea animate-pulse" title={t("nav.statusOk")} />
          </div>
        )}
      </div>

      {/* ── Resize handle (expanded only) ────────────────────────────────── */}
      {!collapsed && (
        <div
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10 group"
          onMouseDown={e => startResize(e, "right")}
        >
          <div className="absolute right-0 top-0 h-full w-px bg-border group-hover:bg-accent/50 transition-colors duration-150" />
        </div>
      )}
    </aside>
  );
};
