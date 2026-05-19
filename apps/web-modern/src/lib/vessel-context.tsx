import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

interface VesselOption {
  code: string;
  name: string;
  status: string;
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
      .then(data => setVessels(data.items ?? []))
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
