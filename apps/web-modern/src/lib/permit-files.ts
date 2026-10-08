// Descarga del permiso de trabajo (PDF o Word). Compartido por la pantalla de
// Permisos de la PC y la bandeja del celular (/m-permisos), que así no carga
// la página entera de escritorio.

/**
 * Baja el permiso como PDF o Word vía fetch + blob: window.open no carga el
 * header X-Tenant-Slug que el SPA usa para resolver el tenant, y devolvería
 * TENANT_UNRESOLVED en una tab nueva. El nombre lo decide el servidor (con
 * documento controlado lleva adelante el código del formulario).
 */
export async function downloadPermitFile(id: string, kind: "pdf" | "doc", fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("gpms_token");
  const slug  = localStorage.getItem("gpms_tenant_slug");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (slug)  headers["X-Tenant-Slug"] = slug;
  const res = await fetch(`/app/permits/${id}/${kind}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = named || fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
