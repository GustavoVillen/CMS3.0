import React, { useState } from "react";
import { User, LogOut, ChevronDown, Ship, Sun, Moon, BookOpen, LayoutDashboard, ArrowLeft } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { useTheme } from "../lib/theme";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ver campana oculta abajo
import { NotificationsBell } from "./NotificationsBell";

/**
 * Parte la lista YA ORDENADA en bloques consecutivos por tipo, conservando el
 * orden. Los que no tienen tipo quedan en un bloque sin etiqueta (van al final,
 * ver sortVessels) y se renderizan sueltos, sin encabezado.
 */
function groupVesselsByType(vessels: { code: string; name: string; vesselType?: string | null }[]) {
  const groups: { type: string | null; items: typeof vessels }[] = [];
  for (const v of vessels) {
    const type = (v.vesselType ?? "").trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.type === type) last.items.push(v);
    else groups.push({ type, items: [v] });
  }
  return groups;
}

export const Header: React.FC<{ title: string }> = ({ title }) => {
  void title;
  const { user, tenant, logout } = useAuth();
  const { vessels, selectedVesselCode, setSelectedVesselCode } = useVesselContext();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const { theme, toggleTheme } = useTheme();
  // Logo del tenant según el tema: light → logo oscuro (logoUrl), dark → claro (logoUrlLight).
  const tenantLogo = tenant
    ? (theme === "dark"
        ? (tenant.logoUrlLight || tenant.logoUrl)
        : (tenant.logoUrl || tenant.logoUrlLight))
    : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const showSelector = vessels.length > 1;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  // "Volver": una pantalla atrás. En el tablero no se muestra (ya es el punto de
  // partida). Si se entró directo por URL (link pegado, favorito) no hay pantalla
  // anterior dentro del sistema, así que el botón lleva al Dashboard en vez de
  // sacar al usuario de la aplicación.
  const isDashboard = location.pathname === "/";
  const handleBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1); else navigate("/");
  };

  return (
    <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-surface dark:bg-[#0B132B]/30 dark:backdrop-blur-md shrink-0 relative z-50">
      <div className="flex items-center gap-4">
        {!isDashboard && (
          <button
            onClick={handleBack}
            title={t("common.back")}
            className="flex items-center gap-2 text-sm font-semibold text-fg/80 border border-border rounded-full px-3 py-1.5 hover:bg-fg/[0.07] hover:text-fg hover:border-accent/40 transition-colors uppercase tracking-wide"
          >
            <ArrowLeft className="w-4 h-4 text-accent shrink-0" />
            {t("common.back")}
          </button>
        )}
        {/* Atajo al Dashboard. Ocupa el lugar donde antes iba el nombre del
            tenant: desde cualquier pantalla se vuelve al tablero con un clic,
            sin tener que buscarlo en el menú lateral. */}
        <button
          onClick={() => navigate("/")}
          title={t("nav.dashboard")}
          className="flex items-center gap-2 text-sm font-semibold text-fg/80 border border-border rounded-full px-3 py-1.5 hover:bg-fg/[0.07] hover:text-fg hover:border-accent/40 transition-colors uppercase tracking-wide"
        >
          <LayoutDashboard className="w-4 h-4 text-accent shrink-0" />
          {t("nav.dashboard")}
        </button>
      </div>

      <div className="flex items-center gap-4">
        {/* Global vessel selector */}
        {showSelector && (
          <div className="flex items-center gap-2 border border-border rounded-full px-3 py-1.5 bg-fg/[0.04] hover:bg-fg/[0.07] transition-colors">
            <Ship className="w-3.5 h-3.5 text-accent shrink-0" />
            <select
              value={selectedVesselCode ?? ""}
              onChange={e => setSelectedVesselCode(e.target.value || null)}
              className="text-xs bg-transparent text-fg focus:outline-none cursor-pointer appearance-none pr-1"
            >
              <option value="">{t("header.allVessels")}</option>
              {/* La lista ya viene ordenada por tipo y luego alfabética (ver
                  sortVessels). Se agrupa con <optgroup> para que ese orden se
                  entienda: con 30+ barcazas, una lista plana no deja ver dónde
                  empieza y termina cada tipo. */}
              {groupVesselsByType(vessels).map(g => (
                g.type
                  ? (
                    <optgroup key={g.type} label={g.type}>
                      {g.items.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
                    </optgroup>
                  )
                  : g.items.map(v => <option key={v.code} value={v.code}>{v.name}</option>)
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-fg/40 shrink-0 pointer-events-none" />
          </div>
        )}

        {/* Manual de usuario — abre el manual completo en una pestaña nueva */}
        <button
          onClick={() => window.open("/manual.html", "_blank", "noopener,noreferrer")}
          title={t("header.manual")}
          aria-label={t("header.manual")}
          className="w-9 h-9 flex items-center justify-center rounded-full text-fg/60 hover:text-fg hover:bg-fg/10 transition-all"
        >
          <BookOpen className="w-4 h-4" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? t("header.themeLight") : t("header.themeDark")}
          aria-label={theme === "dark" ? t("header.themeLight") : t("header.themeDark")}
          className="w-9 h-9 flex items-center justify-center rounded-full text-fg/60 hover:text-fg hover:bg-fg/10 transition-all"
        >
          {theme === "dark"
            ? <Sun className="w-4 h-4" />
            : <Moon className="w-4 h-4" />}
        </button>

        {/* Campana de notificaciones — OCULTA por decisión de producto (jul 2026).
            El módulo sigue completo y funcionando (NotificationsBell.tsx, el
            servicio y los endpoints); sólo se saca del header. Para reactivarla
            alcanza con descomentar esta línea: no hay nada más que tocar.
            Se oculta en vez de borrarse porque la funcionalidad no se descartó,
            se pospuso. */}
        {/* <NotificationsBell /> */}

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-3 hover:bg-fg/5 p-1 pr-3 rounded-full transition-all"
          >
            <div className="w-8 h-8 rounded-full bg-linear-to-br from-accent/30 to-fg/5 border border-accent/20 flex items-center justify-center">
              <User className="w-4 h-4 text-accent" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-fg leading-tight">
                {user?.name ?? user?.identifier ?? t("header.userFallback")}
              </span>
              <span className="text-[10px] text-fg/50 leading-tight">
                {user?.role?.replace(/_/g, " ") ?? ""}
              </span>
            </div>
            <ChevronDown className={`w-3 h-3 text-fg/40 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 w-48 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden z-200">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs text-fg/50 uppercase tracking-wider">{t("header.activeSession")}</p>
                <p className="text-sm font-medium text-fg mt-0.5">{tenant?.name}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-danger hover:bg-danger/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {t("header.logout")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
