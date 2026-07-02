function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  return headers;
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

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  // Nombre: "{codigo}-{titulo}.pdf" (ej. SS-M01-26-0357-Cambio de rodamientos sellados.pdf).
  const title = fileSafe(wo.title);
  a.download = `${wo.workOrderCode}${title ? `-${title}` : ""}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Sanea un texto para usarlo como parte de un nombre de archivo.
function fileSafe(s: string | null | undefined): string {
  return (s ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

export async function printServiceRequest(wo: { id: string; workOrderCode: string; title?: string | null }): Promise<void> {
  const res = await fetch(`/app/pms/work-orders/${wo.id}/service-request.pdf`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    console.error("Error generando Solicitud de servicios:", res.status, await res.text());
    alert("No se pudo generar la Solicitud de servicios. Intente nuevamente.");
    return;
  }

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  // Nombre: "{codigo}-{titulo}.pdf" (ej. SS-M01-26-0357-Cambio de rodamientos sellados.pdf).
  const title = fileSafe(wo.title);
  a.download = `${wo.workOrderCode}${title ? `-${title}` : ""}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = trimmed ? `${fileLabel}-${trimmed}-${today}.pdf` : `${fileLabel}-${today}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
