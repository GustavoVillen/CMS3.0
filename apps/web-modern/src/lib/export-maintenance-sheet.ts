// Planilla de mantenimiento en Excel (.xlsx) con el formato de papel que usa la
// flota: una banda de título con el logo del armador y el nombre del buque,
// las tareas agrupadas por GRUPO SFI (G1: Casco y Estructuras, G2: Sistemas de
// Carga…) y, dentro de cada grupo, una fila por tarea con el ítem y la
// descripción del equipo combinados verticalmente sobre su bloque.
//
//   Ítem | Descripción (equipo + modelo) | Tarea a realizar | Realizar cada |
//   Última verificación | Próximo recorrido
//
// Las tareas por HORAS muestran el horómetro (23.564 → 24.064); las de
// calendario muestran fechas (17/06/2026 → 14/12/2026). Es una foto del estado
// actual de los planes del buque, no un histórico.
//
// Semáforo: las filas de tareas VENCIDAS salen en rojo y las PRÓXIMAS A VENCER
// (por vencer, en ventana o dentro de los 30 días) en amarillo, usando el mismo
// `executionStatus` que colorea el Gantt y el resto del PMS.
//
// Se genera en el cliente con exceljs (import dinámico → chunk aparte, no
// engorda el bundle principal), igual que la exportación de la Matriz. El armado
// del workbook está en `maintenance-sheet-xlsx.ts`, compartido con la API.
//
// Cómo se AGRUPA y se ORDENA la planilla no vive acá: está en
// `maintenance-sheet-model.ts`, compartido con la planilla en pantalla
// (pages/MaintenanceSheet.tsx). Acá queda sólo cómo se dibuja en Excel.

import { api } from "./api";
import type { SheetPlan, AssetInfo } from "./maintenance-sheet-model";
import { buildMaintenanceSheet, type SheetLogo } from "./maintenance-sheet-xlsx";

export type { SheetPlan } from "./maintenance-sheet-model";

/**
 * Baja el logo del armador y lo deja listo para incrustar. Si falla (CORS, 404,
 * tenant sin logo) devuelve null: la planilla sale igual, sólo sin logo.
 */
async function loadLogo(url: string | null | undefined): Promise<SheetLogo | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const extension = blob.type.includes("jpeg") || blob.type.includes("jpg")
      ? "jpeg"
      : blob.type.includes("gif") ? "gif" : "png";
    const base64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    const ratio = await new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3);
      img.onerror = () => resolve(3);
      img.src = base64;
    });
    return { base64, extension, ratio };
  } catch {
    return null;
  }
}

export async function exportMaintenanceSheet(opts: {
  vesselCode: string;
  vesselName: string;
  /** Logo del tenant (el mismo que muestra el header). Opcional. */
  logoUrl?: string | null;
}): Promise<void> {
  const { vesselCode, vesselName, logoUrl } = opts;

  // La planilla trae su PROPIA lista completa del buque: la pantalla del Gantt
  // carga como máximo 500 planes, y exportar una planilla recortada en silencio
  // sería peor que no exportarla.
  const listed = await api.get<{ items: SheetPlan[] }>(
    `/app/pms/maintenance-plans?vesselCode=${encodeURIComponent(vesselCode)}&limit=2000`,
  );
  const plans = (listed.items ?? []).filter(p => (p as { status?: string }).status !== "INACTIVE");
  if (plans.length === 0) throw new Error("Este buque no tiene tareas de mantenimiento para exportar.");

  // Marca, modelo y código SFI salen del catálogo de equipos (la lista de planes
  // sólo trae el nombre). Si falla, la planilla igual sale: pierde esa segunda
  // línea y el grupo se deduce sólo del que trae cada plan.
  let assetById = new Map<string, AssetInfo>();
  try {
    const res = await api.get<{ items: AssetInfo[] }>(
      `/app/pms/assets?vesselCode=${encodeURIComponent(vesselCode)}&limit=500`,
    );
    assetById = new Map((res.items ?? []).map(a => [a.id, a]));
  } catch { /* sin catálogo: se muestra sólo el nombre del equipo */ }

  const logo = await loadLogo(logoUrl);
  const wb = await buildMaintenanceSheet({ plans, assetById, vesselName, vesselCode, logo });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Planilla-Mantenimiento-${vesselName || vesselCode}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
