function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  return headers;
}

/** Nombre sugerido por el server en Content-Disposition, si viene. */
function filenameFromResponse(res: Response): string | null {
  const cd = res.headers.get("content-disposition");
  if (!cd) return null;
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/**
 * Descarga la respuesta como archivo.
 *
 * Detalles que importan (se perdían el nombre y la extensión, y el archivo
 * bajaba como un UUID sin `.pdf` que Windows no sabe abrir):
 *  · El `<a>` se quita del DOM y el object URL se revoca DESPUÉS de un tick, no
 *    en la misma vuelta del click: Edge descarta el atributo `download` si el
 *    anchor desaparece antes de que la descarga arranque.
 *  · El blob se re-crea con el MIME explícito — si el tipo se pierde, el
 *    navegador no infiere la extensión.
 *  · El nombre sale del Content-Disposition del server; el que se pasa acá es
 *    sólo el respaldo.
 */
async function downloadResponse(res: Response, fallbackName: string, mime = "application/pdf"): Promise<void> {
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const serverName = filenameFromResponse(res);
  let name = serverName || fallbackName;
  if (!/\.[a-z0-9]{2,4}$/i.test(name)) name += mime === "application/pdf" ? ".pdf" : "";

  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", name);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 60_000);
}

export async function printWorkOrder(wo: { id: string; workOrderCode: string; title?: string | null }): Promise<void> {
  const res = await fetch(`/app/pms/work-orders/${wo.id}/pdf`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    console.error("Error generando PDF:", res.status, await res.text());
    alert("No se pudo generar el documento PDF. Intente nuevamente.");
    return;
  }

  // Nombre: "{codigo}-{titulo}.pdf" (ej. OT-M01-26-0357-Cambio de rodamientos.pdf).
  const title = fileSafe(wo.title);
  await downloadResponse(res, `${wo.workOrderCode}${title ? `-${title}` : ""}.pdf`);
}

// Sanea un texto para usarlo como parte de un nombre de archivo.
function fileSafe(s: string | null | undefined): string {
  return (s ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * PDF de una Solicitud de Servicio (REGI-LOG-01.3). La SS es una entidad propia
 * que cuelga de una OT — por eso el documento se pide por el id de la SS, no de
 * la OT.
 */
export async function printServiceRequest(sr: { id: string; serviceRequestCode: string; title?: string | null }): Promise<void> {
  const res = await fetch(`/app/pms/service-requests/${sr.id}/pdf`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    console.error("Error generando Solicitud de servicios:", res.status, await res.text());
    alert("No se pudo generar la Solicitud de servicios. Intente nuevamente.");
    return;
  }

  // Nombre: "{codigo}-{titulo}.pdf" (ej. SS-74-M01-2026-Reparacion de bomba.pdf).
  const title = fileSafe(sr.title);
  await downloadResponse(res, `${sr.serviceRequestCode}${title ? `-${title}` : ""}.pdf`);
}

export async function printOpenWorkOrdersReport(vesselCode?: string | null, fileLabel = "OTs-Abiertas"): Promise<void> {
  const trimmed = vesselCode?.trim() || "";
  const qs = trimmed ? `?vesselCode=${encodeURIComponent(trimmed)}` : "";
  const res = await fetch(`/app/pms/work-orders/open-report.pdf${qs}`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    console.error("Error generando reporte de OTs abiertas:", res.status, await res.text());
    alert("No se pudo generar el reporte. Intente nuevamente.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  await downloadResponse(res, trimmed ? `${fileLabel}-${trimmed}-${today}.pdf` : `${fileLabel}-${today}.pdf`);
}
