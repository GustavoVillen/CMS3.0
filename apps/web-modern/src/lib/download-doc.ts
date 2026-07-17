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
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf], { type: "application/msword" });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.setAttribute("download", filename.endsWith(".doc") ? filename : `${filename}.doc`);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // El anchor se quita y el object URL se revoca DESPUÉS, no en la misma vuelta
  // del click: Edge descarta el atributo `download` si el anchor desaparece
  // antes de que arranque la descarga, y el archivo baja sin nombre ni extensión.
  setTimeout(() => {
    if (a.parentNode) document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
}
