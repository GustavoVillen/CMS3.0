// Deep-links compartibles a registros de detalle (OT, Plan, Diferimiento…).
//
// La URL es la fuente de verdad: la ruta `/base/:code` abre el detalle de ese
// código; abrir/cerrar el detalle solo cambia la URL (navigate), y un efecto en
// cada página resuelve el `:code` → abre el modal. Así el link queda en la barra
// y es compartible.
//
// Uso en una página:
//   const { code, open, close } = useDeepLink("/work-orders");
//   // click de fila:      open(row.workOrderCode)
//   // cerrar el modal:    close()
//   // resolver deep-link:
//   useEffect(() => {
//     if (!code) { setEditing(null); return; }
//     if (editing?.workOrderCode === code) return;
//     const match = data?.items?.find(w => w.workOrderCode === code);
//     if (match) void openDetail(match);
//   }, [code, data, editing]);

import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

export interface DeepLink {
  /** Código de la ruta (`:code`) ya decodeado, o null si estamos en la lista. */
  code: string | null;
  /** Navega a `/base/:code` (deja el link en la barra). */
  open: (code: string) => void;
  /** Cierra el detalle volviendo a la pantalla anterior (o a `/base`). */
  close: () => void;
}

export function useDeepLink(basePath: string): DeepLink {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const { search, key } = useLocation();

  // Se preservan los query params (filtros de la lista, autoCode se descarta).
  const keepSearch = () => {
    const p = new URLSearchParams(search);
    p.delete("autoCode");
    const qs = p.toString();
    return qs ? `?${qs}` : "";
  };

  const open = useCallback(
    (c: string) => navigate(`${basePath}/${encodeURIComponent(c)}${keepSearch()}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, basePath, search],
  );
  /**
   * Cerrar = VOLVER ATRÁS, no "ir a la lista". Como `open` empujó una entrada al
   * historial, retroceder devuelve a la pantalla desde la que se abrió el
   * detalle: una SS abierta desde una OT vuelve a la OT, y no a la lista de SS.
   *
   * Excepción: si el detalle es la PRIMERA pantalla de la sesión (link pegado en
   * el navegador, F5, o llegada desde un mail), no hay a dónde volver — y un
   * `navigate(-1)` sacaría al usuario de la aplicación. En ese caso se cae a la
   * lista, que es el comportamiento de siempre. React Router marca esa primera
   * entrada con `key === "default"`.
   */
  const close = useCallback(
    () => {
      if (key !== "default") navigate(-1);
      else navigate(`${basePath}${keepSearch()}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, basePath, search, key],
  );

  return { code: code ? decodeURIComponent(code) : null, open, close };
}
