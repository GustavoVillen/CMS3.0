interface WorkOrderDoc {
  workOrderCode: string;
  vesselCode: string;
  assetName: string | null;
  assetId: string;
  type: string;
  status: string;
  priority: string;
  criticality: string;
  openDate: string;
  dueDate: string | null;
  completedDate: string | null;
  title: string | null;
  description: string | null;
  assignedToUserName: string | null;
  acceptanceCriteria: string | null;
  loto: string | null;
  riskLevel: string | null;
  riskAnalysisResult: string | null;
  checklistDocUrl: string | null;
  woResult: string | null;
  executedByName: string | null;
  observations: string | null;
  supportingDocUrl: string | null;
  holdReason: string | null;
  cancelReason: string | null;
}

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  const s = value.includes("T") ? value.slice(0, 10) : value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  return value;
}

function typeLabel(t: string): string {
  if (t === "INSPECTION") return "Inspección";
  if (t === "CORRECTIVE")  return "Reparación";
  return "Mantenimiento";
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    PLANNED: "Planificada", IN_PROGRESS: "En ejecución", ON_HOLD: "Postergada",
    CLOSED: "Cerrada", CANCELLED: "Cancelada",
  };
  return map[s] ?? s;
}

function priorityLabel(p: string): string {
  const map: Record<string, string> = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" };
  return map[p] ?? p;
}

function riskLabel(r: string | null): string {
  if (!r) return "—";
  const map: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
  return map[r] ?? r;
}

function woResultLabel(r: string | null): string {
  if (!r) return "—";
  return r === "SATISFACTORY" ? "Satisfactorio" : "Con deficiencias";
}

function row(label: string, value: string, wide = false): string {
  return `<div class="field${wide ? " wide" : ""}"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function section(title: string, content: string): string {
  return `<section><h2>${title}</h2><div class="grid">${content}</div></section>`;
}

export function printWorkOrder(wo: WorkOrderDoc): void {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>OT ${wo.workOrderCode}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 18mm 15mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
  .page { max-width: 680px; margin: 0 auto; padding: 20mm 0; }
  @media print { .page { max-width: none; padding: 0; } }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a3a5c; padding-bottom: 10px; margin-bottom: 16px; }
  .doc-title { font-size: 20px; font-weight: 800; color: #1a3a5c; letter-spacing: 1px; }
  .doc-code  { font-size: 14px; font-weight: 700; color: #1a3a5c; margin-top: 2px; }
  .doc-meta  { text-align: right; font-size: 10px; color: #555; line-height: 1.6; }
  section { margin-bottom: 14px; }
  section h2 { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #fff; background: #1a3a5c; padding: 4px 8px; margin-bottom: 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; border: 1px solid #c8d4e0; border-top: none; }
  .field { padding: 6px 8px; border-right: 1px solid #c8d4e0; border-bottom: 1px solid #c8d4e0; }
  .field.wide { grid-column: span 3; }
  .field:last-child { border-right: none; }
  .label { display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7a8d; margin-bottom: 2px; }
  .value { display: block; font-size: 11px; color: #1a1a1a; white-space: pre-wrap; word-break: break-word; min-height: 14px; }
  .value.highlight { font-weight: 700; color: #1a3a5c; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; border: 1px solid #c8d4e0; margin-top: 20px; }
  .sig-box { padding: 8px; border-right: 1px solid #c8d4e0; }
  .sig-box:last-child { border-right: none; }
  .sig-box .label { display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7a8d; margin-bottom: 30px; }
  .sig-line { border-top: 1px solid #aaa; margin-top: 4px; font-size: 9px; color: #888; padding-top: 2px; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 10px; font-weight: 700; }
  .badge-open     { background: #e8f5e9; color: #2e7d32; }
  .badge-closed   { background: #e3f2fd; color: #1565c0; }
  .badge-cancelled{ background: #fce4ec; color: #c62828; }
  .badge-hold     { background: #fff8e1; color: #f57f17; }
  @media print {
    body { padding: 0; }
    @page { size: A4; margin: 18mm 15mm; }
  }
</style>
</head>
<body>
<div class="page">
<div class="doc-header">
  <div>
    <div class="doc-title">ORDEN DE TRABAJO</div>
    <div class="doc-code">${wo.workOrderCode}</div>
  </div>
  <div class="doc-meta">
    <strong>Embarcación:</strong> ${wo.vesselCode}<br/>
    <strong>Apertura:</strong> ${fmt(wo.openDate)}<br/>
    <strong>Vencimiento:</strong> ${fmt(wo.dueDate)}<br/>
    <strong>Estado:</strong> ${statusLabel(wo.status)}
  </div>
</div>

${section("Información", [
  row("Embarcación", `<span class="highlight">${wo.vesselCode}</span>`),
  row("Equipo", wo.assetName ?? wo.assetId),
  row("Tipo", typeLabel(wo.type)),
  row("Prioridad", priorityLabel(wo.priority)),
  row("Criticidad", wo.criticality),
  row("Estado", statusLabel(wo.status)),
  row("F. Apertura", fmt(wo.openDate)),
  row("F. Vencimiento", fmt(wo.dueDate)),
  row("F. Cierre", fmt(wo.completedDate)),
].join(""))}

${section("Plan", [
  row("Título / Tarea", wo.title ?? "—", true),
  row("Descripción", wo.description ?? "—", true),
  row("Responsable", wo.assignedToUserName ?? "—"),
  row("Nivel de Riesgo", riskLabel(wo.riskLevel)),
  row("LOTO", wo.loto ?? "—"),
  row("Criterios de Aceptación", wo.acceptanceCriteria ?? "—", true),
  row("Resultado Análisis de Riesgo", wo.riskAnalysisResult ?? "—", true),
  wo.checklistDocUrl ? row("Doc. Checklist", wo.checklistDocUrl, true) : "",
].join(""))}

${section("Resultado", [
  row("Resultado de la OT", woResultLabel(wo.woResult)),
  row("Ejecutado por", wo.executedByName ?? "—"),
  row("Observaciones", wo.observations ?? "—", true),
  wo.holdReason   ? row("Motivo de postergación", wo.holdReason, true)   : "",
  wo.cancelReason ? row("Motivo de cancelación",  wo.cancelReason, true) : "",
  wo.supportingDocUrl ? row("Doc. Respaldatorio", wo.supportingDocUrl, true) : "",
].join(""))}

<div class="signatures">
  <div class="sig-box"><span class="label">Responsable de ejecución</span><div class="sig-line">${wo.executedByName ?? ""}</div></div>
  <div class="sig-box"><span class="label">Supervisor / Jefe de máquinas</span><div class="sig-line">&nbsp;</div></div>
  <div class="sig-box"><span class="label">Verificado por</span><div class="sig-line">&nbsp;</div></div>
</div>

</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
