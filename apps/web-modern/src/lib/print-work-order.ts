function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  return headers;
}

export async function printWorkOrder(wo: { id: string; workOrderCode: string }): Promise<void> {
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
  a.download = `${wo.workOrderCode}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function printOpenWorkOrdersReport(vesselCode?: string | null): Promise<void> {
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
  a.download = trimmed ? `OTs-Abiertas-${trimmed}-${today}.pdf` : `OTs-Abiertas-${today}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
