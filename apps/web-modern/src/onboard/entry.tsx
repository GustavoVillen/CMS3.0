// Entrada directa a la App a bordo (decisión del usuario, Preview V30).
//
// El Capitán / Jefe de Máquinas (MAINTENANCE_MANAGER) que abre el sistema desde
// un celular cae en /abordo en vez del tablero de escritorio. Sólo se mira la
// raíz "/": un link directo a cualquier otra pantalla se respeta. Si eligió
// "Lo demás se completa en la PC", la preferencia dura la sesión del navegador.
// Desde la PC (pantalla ancha) no cambia nada.

import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

export const OB_DESKTOP_KEY = "ob_prefer_desktop";
export const ONBOARD_PATH = "/abordo";

function prefersDesktop(): boolean {
  try { return sessionStorage.getItem(OB_DESKTOP_KEY) === "1"; } catch { return false; }
}

export function OnboardEntry({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  if (pathname === "/" && phone && user?.role === "MAINTENANCE_MANAGER" && !prefersDesktop()) {
    return <Navigate to={ONBOARD_PATH} replace />;
  }
  return <>{children}</>;
}
