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

export async function printOpenWorkOrdersReport(): Promise<void> {
  const res = await fetch("/app/pms/work-orders/open-report.pdf", {
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
  a.download = `OTs-Abiertas-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
