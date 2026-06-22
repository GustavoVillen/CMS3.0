// Descarga genérica de un documento .doc (Word) desde una ruta del backend.
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  return headers;
}

export async function downloadDoc(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) {
    console.error("Error generando .doc:", res.status, await res.text());
    alert("No se pudo generar el documento Word. Intente nuevamente.");
    return;
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
