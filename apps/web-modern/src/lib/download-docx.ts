// Descarga de un documento .docx (Word) desde una ruta del backend.
//
// Aparte de download-doc.ts: aquel baja el .doc (HTML que Word abre), éste baja
// el .docx real. El tipo MIME y la extensión tienen que coincidir con el
// formato o Word avisa que "el formato y la extensión no coinciden".

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  return headers;
}

export async function downloadDocx(url: string, filename: string): Promise<boolean> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) {
    console.error("Error generando .docx:", res.status, await res.text());
    return false;
  }
  const blob = new Blob([await res.arrayBuffer()], { type: DOCX_MIME });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.setAttribute("download", filename.endsWith(".docx") ? filename : `${filename}.docx`);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // El anchor se quita y el object URL se revoca DESPUÉS, no en la misma vuelta
  // del click: Edge descarta el atributo `download` si el anchor desaparece
  // antes de que arranque la descarga (mismo motivo que en download-doc.ts).
  setTimeout(() => {
    if (a.parentNode) document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
  return true;
}
