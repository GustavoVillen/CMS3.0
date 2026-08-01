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
  /**
   * Navega a `/base/:code` (deja el link en la barra).
   * `replace` sustituye la entrada actual del historial en vez de agregar una:
   * se usa para los redirectores `?autoCode=`, que son un puente y no un
   * destino — si quedaran en el historial, al cerrar el detalle se volvería a
   * ellos y el detalle se reabriría solo.
   */
  open: (code: string, opts?: { replace?: boolean }) => void;
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
    // Los redirectores son puentes, no filtros: no deben quedar pegados en la
    // URL del detalle (si quedan, al recargar/compartir vuelven a disparar la
    // apertura y duplican la entrada del historial).
    p.delete("autoCode");
    p.delete("openId");
    const qs = p.toString();
    return qs ? `?${qs}` : "";
  };

  const open = useCallback(
    (c: string, opts?: { replace?: boolean }) => {
      const path = `${basePath}/${encodeURIComponent(c)}`;
      // Abrir el detalle que YA está en la URL nunca debe apilar una segunda
      // entrada idéntica: si no, `close()` (que es un back) cae en la copia y el
      // detalle se reabre — había que cerrarlo dos veces, y el estado quedaba
      // "abierto pero invisible" (de ahí el "hago click y no abre"). Pasa al
      // guardar, que re-refleja el mismo código en la URL.
      const sameUrl = window.location.pathname === path;
      navigate(`${path}${keepSearch()}`, { replace: opts?.replace ?? sameUrl });
    },
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

  // React Router ya decodifica el param; este decode extra es por compatibilidad
  // con links viejos doblemente codificados. Va en try/catch porque un código con
  // un '%' suelto (ej. "VALV-50%") lanza URIError y tumbaría toda la pantalla
  // (pantalla en blanco = "no abre").
  let decoded: string | null = null;
  if (code) {
    try { decoded = decodeURIComponent(code); } catch { decoded = code; }
  }
  return { code: decoded, open, close };
}
