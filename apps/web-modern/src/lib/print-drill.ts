function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  return headers;
}

/**
 * Lanza el error en lugar de alert() para que el caller lo muestre en su UI.
 * Si el server devolvió un JSON con `error`/`message`, lo extrae.
 */
export async function printDrill(drill: { id: string; drillCode: string }): Promise<void> {
  const res = await fetch(`/app/drills/${drill.id}/pdf`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const raw = await res.text();
    let msg = `Error ${res.status} al generar el PDF`;
    try {
      const parsed = JSON.parse(raw) as { error?: string; message?: string };
      if (parsed.message) msg = parsed.message;
      else if (parsed.error) msg = parsed.error;
    } catch { /* texto plano */
      if (raw && raw.length < 200) msg = `${msg}: ${raw}`;
    }
    console.error("[printDrill] failed", res.status, raw);
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${drill.drillCode}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
