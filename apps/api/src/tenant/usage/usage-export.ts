/**
 * Excel export of UsageEvent log for SUPERADMIN.
 * Uses exceljs (already a dependency).
 */

import ExcelJS from "exceljs";
import { listUsageEvents, aiCostUsd, type ListUsageFilters } from "./usage-service";

export async function exportUsageEventsXlsx(filters: ListUsageFilters): Promise<Buffer> {
  const { items } = await listUsageEvents(filters);

  const wb = new ExcelJS.Workbook();
  wb.creator = "GPMS";
  wb.created = new Date();

  const ws = wb.addWorksheet("Usage Log");
  ws.columns = [
    { header: "Fecha (UTC)",       key: "createdAt",      width: 22 },
    { header: "Tenant",            key: "tenantSlug",     width: 14 },
    { header: "Usuario",           key: "userEmail",      width: 32 },
    { header: "IP",                key: "ipAddress",      width: 16 },
    { header: "Vessel",            key: "vesselCode",     width: 10 },
    { header: "Tipo",              key: "kind",           width: 14 },
    { header: "Feature",           key: "feature",        width: 16 },
    { header: "Modelo",            key: "model",          width: 30 },
    { header: "Input tokens",      key: "inputTokens",    width: 14 },
    { header: "Output tokens",     key: "outputTokens",   width: 14 },
    { header: "Cache read",        key: "cacheReadTokens",     width: 12 },
    { header: "Cache write",       key: "cacheCreationTokens", width: 12 },
    { header: "Costo IA (USD)",    key: "costUsd",        width: 14 },
    { header: "Ruta",              key: "route",          width: 40 },
    { header: "Método",            key: "method",         width: 10 },
    { header: "Status",            key: "statusCode",     width: 10 },
    { header: "Bytes in",          key: "bytesIn",        width: 12 },
    { header: "Bytes out",         key: "bytesOut",       width: 12 },
    { header: "Latencia (ms)",     key: "latencyMs",      width: 14 },
    { header: "Error",             key: "errored",        width: 8 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle" };

  for (const it of items) {
    const cost = it.kind === "ai_call"
      ? aiCostUsd(it.model ?? "", it.inputTokens, it.outputTokens, it.cacheReadTokens, it.cacheCreationTokens)
      : 0;
    ws.addRow({
      createdAt:           it.createdAt.toISOString().replace("T", " ").slice(0, 19),
      tenantSlug:          it.tenantSlug,
      userEmail:           it.userEmail,
      ipAddress:           it.ipAddress ?? "",
      vesselCode:          it.vesselCode ?? "",
      kind:                it.kind,
      feature:             it.feature ?? "",
      model:               it.model ?? "",
      inputTokens:         it.inputTokens,
      outputTokens:        it.outputTokens,
      cacheReadTokens:     it.cacheReadTokens,
      cacheCreationTokens: it.cacheCreationTokens,
      costUsd:             Number(cost.toFixed(6)),
      route:               it.route ?? "",
      method:              it.method ?? "",
      statusCode:          it.statusCode ?? "",
      bytesIn:             it.bytesIn,
      bytesOut:            it.bytesOut,
      latencyMs:           it.latencyMs ?? "",
      errored:             it.errored ? "SI" : "",
    });
  }

  // Number formats for cost column
  ws.getColumn("costUsd").numFmt = "0.000000";

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}
