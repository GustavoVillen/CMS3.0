import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

interface VesselOption {
  code: string;
  name: string;
  status: string;
  /** Ej. "Remolcador", "Barcaza Tanque - Rake". Puede faltar en buques viejos. */
  vesselType?: string | null;
}

/**
 * Orden del selector de buques: primero por TIPO de embarcación, después
 * alfabético dentro de cada tipo. Con una flota de 30+ barcazas, la lista plana
 * obligaba a leerla entera para encontrar un remolcador.
 *
 * El orden ENTRE tipos es de negocio, no alfabético: primero los REMOLCADORES
 * (las unidades propulsadas, donde se concentra la operación) y después las
 * barcazas. Alfabéticamente quedaba al revés.
 *
 * Los buques sin tipo cargado van al final: es un dato incompleto y no debe
 * encabezar la lista.
 *
 * `localeCompare` con "es" y numeric para que MGT 2 < MGT 10 (un orden de texto
 * puro pone MGT 10 antes que MGT 2) y para que las tildes no alteren el orden.
 */
function typeRank(type: string): number {
  if (!type) return 9;                          // sin tipo → al final
  if (/remolcador/i.test(type)) return 0;       // remolcadores primero
  return 1;                                     // el resto (barcazas, etc.)
}

function sortVessels(items: VesselOption[]): VesselOption[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
  return [...items].sort((a, b) => {
    const ta = (a.vesselType ?? "").trim();
    const tb = (b.vesselType ?? "").trim();
    const byRank = typeRank(ta) - typeRank(tb);
    if (byRank !== 0) return byRank;
    const byType = cmp(ta, tb);                 // dentro del mismo rango, alfabético
    if (byType !== 0) return byType;
    return cmp(a.name ?? a.code, b.name ?? b.code);
  });
}

interface VesselContextValue {
  vessels: VesselOption[];
  selectedVesselCode: string | null;
  setSelectedVesselCode: (code: string | null) => void;
  isVesselScoped: boolean;
  selectedVessel: VesselOption | null;
}

const VesselContext = createContext<VesselContextValue>({
  vessels: [],
  selectedVesselCode: null,
  setSelectedVesselCode: () => {},
  isVesselScoped: false,
  selectedVessel: null,
});

export function useVesselContext() {
  return useContext(VesselContext);
}

function lsKey(tenantSlug: string) {
  return `gpms_vessel_scope_${tenantSlug}`;
}

export function VesselProvider({ children }: { children: React.ReactNode }) {
  const { tenant, user, isAuthenticated } = useAuth();
  const [vessels, setVessels] = useState<VesselOption[]>([]);
  const [selectedVesselCode, setSelectedVesselCodeState] = useState<string | null>(() => {
    try {
      const slug = localStorage.getItem("gpms_tenant_slug") ?? "";
      return localStorage.getItem(lsKey(slug));
    } catch {
      return null;
    }
  });

  // Fetch vessel list once after auth
  useEffect(() => {
    if (!isAuthenticated) return;
    api.get<{ items: VesselOption[] }>("/app/vessels")
      .then(data => setVessels(sortVessels(data.items ?? [])))
      .catch(() => {});
  }, [isAuthenticated]);

  // Sanitizar selectedVesselCode contra la lista real del user. Si quedó en
  // localStorage un vessel del user anterior (típico cuando dos usuarios
  // comparten la misma máquina/browser), lo descartamos. Si el user tiene
  // un único vessel, lo auto-seleccionamos.
  useEffect(() => {
    if (vessels.length === 0) return;
    const allowed = vessels.some(v => v.code === selectedVesselCode);
    if (!allowed) {
      const fallback = vessels.length === 1 ? vessels[0]!.code : null;
      setSelectedVesselCodeState(fallback);
      try {
        const slug = tenant?.slug ?? localStorage.getItem("gpms_tenant_slug") ?? "";
        if (fallback) localStorage.setItem(lsKey(slug), fallback);
        else localStorage.removeItem(lsKey(slug));
      } catch {}
    }
  }, [vessels, selectedVesselCode, tenant?.slug]);

  const setSelectedVesselCode = useCallback((code: string | null) => {
    setSelectedVesselCodeState(code);
    try {
      const slug = tenant?.slug ?? localStorage.getItem("gpms_tenant_slug") ?? "";
      if (code) {
        localStorage.setItem(lsKey(slug), code);
      } else {
        localStorage.removeItem(lsKey(slug));
      }
    } catch {}
  }, [tenant?.slug]);

  const selectedVessel = vessels.find(v => v.code === selectedVesselCode) ?? null;
  const isVesselScoped = selectedVesselCode !== null;

  return (
    <VesselContext.Provider value={{ vessels, selectedVesselCode, setSelectedVesselCode, isVesselScoped, selectedVessel }}>
      {children}
    </VesselContext.Provider>
  );
}
