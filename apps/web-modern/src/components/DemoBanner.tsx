import React from "react";
import { FlaskConical } from "lucide-react";
import { useT } from "../lib/i18n";

/**
 * Franja fija de MODO PRÁCTICA.
 *
 * Se enciende SOLO en la instancia de demo, que se compila con
 * `VITE_DEMO_MODE=1`. En producción la variable no existe, el componente
 * devuelve null y no se inyecta ningún estilo: el sistema real queda
 * exactamente igual que sin este archivo.
 *
 * Las reglas CSS compensan la altura de la franja. La app usa `h-screen`
 * (= 100vh) en varios contenedores raíz (Layout, Sidebar, CopilotoPanel,
 * MobileLayout) y `min-h-screen` en el login; sin la compensación, la franja
 * los empujaría 34px fuera de la pantalla.
 */
const BANNER_H = 34;

export const DemoBanner: React.FC = () => {
  const t = useT();
  if (import.meta.env.VITE_DEMO_MODE !== "1") return null;

  return (
    <>
      <style>{`
        body { padding-top: ${BANNER_H}px; }
        .h-screen { height: calc(100vh - ${BANNER_H}px) !important; }
        .min-h-screen { min-height: calc(100vh - ${BANNER_H}px) !important; }
      `}</style>
      <div
        style={{ height: BANNER_H }}
        className="fixed top-0 inset-x-0 z-[9999] bg-amber-400 text-black flex items-center justify-center gap-2 px-3 select-none"
      >
        <FlaskConical className="w-4 h-4 shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wider shrink-0">
          {t("demo.banner.title")}
        </span>
        <span className="text-xs font-medium truncate">{t("demo.banner.detail")}</span>
      </div>
    </>
  );
};
