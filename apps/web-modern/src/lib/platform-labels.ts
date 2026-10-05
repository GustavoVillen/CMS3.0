/**
 * Textos legibles para la consola de plataforma (SUPERADMIN).
 *
 * La API devuelve códigos internos (roles, estados, funciones de IA, rutas,
 * tipos de evento). La consola los muestra con estos nombres para que la pueda
 * leer alguien que no conoce el código. Si aparece un código sin entrada, cada
 * helper cae en una versión legible del propio código, nunca en vacío.
 *
 * La consola es una herramienta interna, sólo en castellano: por eso estos
 * textos no pasan por el diccionario i18n de las empresas.
 */

// ── Roles ────────────────────────────────────────────────────────────────────

export const TENANT_ROLE_LABELS: Record<string, string> = {
  TENANT_ADMIN:         "DPA / Director de Operaciones",
  FLEET_SUPERINTENDENT: "Superintendente técnico",
  MAINTENANCE_MANAGER:  "Capitán / Jefe de Máquinas",
  TECHNICIAN_OPERATOR:  "Tripulante operativo",
  INSPECTOR_COMPLIANCE: "Inspector / Auditor interno",
  PROCUREMENT_STORE:    "Compras / Logística",
  AUDITOR_READONLY:     "Auditor externo",
};

export const PLATFORM_ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: "Administrador general",
  SUPPORT:    "Soporte",
};

export const PLATFORM_ROLE_HELP: Record<string, string> = {
  SUPERADMIN: "Puede todo: crear empresas y usuarios, cambiar las instrucciones de la IA y ver toda la actividad.",
  SUPPORT:    "Cuenta de soporte. Hoy la consola sólo deja entrar al Administrador general.",
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return TENANT_ROLE_LABELS[role] ?? PLATFORM_ROLE_LABELS[role] ?? humanize(role);
}

// ── Estados ──────────────────────────────────────────────────────────────────

export type Tone = "ok" | "warn" | "bad" | "muted" | "info";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE:       { label: "Activa",        tone: "ok" },
  SUSPENDED:    { label: "Suspendida",    tone: "warn" },
  PROVISIONING: { label: "En preparación", tone: "info" },
  DISABLED:     { label: "Dada de baja",  tone: "muted" },
  REVOKED:      { label: "Sin acceso",    tone: "muted" },
  INVITED:      { label: "Invitado",      tone: "info" },
  PENDING:      { label: "Pendiente",     tone: "info" },
  ACCEPTED:     { label: "Aceptada",      tone: "ok" },
  EXPIRED:      { label: "Vencida",       tone: "muted" },
  CANCELLED:    { label: "Cancelada",     tone: "muted" },
  PUBLISHED:    { label: "En uso",        tone: "ok" },
  DRAFT:        { label: "Borrador",      tone: "warn" },
  ARCHIVED:     { label: "Archivada",     tone: "muted" },
};

/** Estado de una empresa, persona, invitación o instrucción de IA. */
export function statusInfo(status: string | null | undefined, kind: "tenant" | "person" = "tenant"): { label: string; tone: Tone } {
  if (!status) return { label: "—", tone: "muted" };
  if (kind === "person") {
    if (status === "ACTIVE") return { label: "Activo", tone: "ok" };
    if (status === "SUSPENDED") return { label: "Suspendido", tone: "warn" };
    if (status === "DISABLED") return { label: "Dado de baja", tone: "muted" };
  }
  return STATUS[status] ?? { label: humanize(status), tone: "muted" };
}

// ── Idiomas, monedas ─────────────────────────────────────────────────────────

export const LOCALE_LABELS: Record<string, string> = { es: "Español", en: "Inglés", pt: "Portugués" };
export const localeLabel = (l: string | null | undefined) => (l ? LOCALE_LABELS[l] ?? l : "—");

export const CURRENCY_LABELS: Record<string, string> = {
  ARS: "Peso argentino (ARS)", PYG: "Guaraní (PYG)", BRL: "Real (BRL)", USD: "Dólar (USD)", UYU: "Peso uruguayo (UYU)", EUR: "Euro (EUR)",
};
export const currencyLabel = (c: string | null | undefined) => (c ? CURRENCY_LABELS[c] ?? c : "—");

// ── Funciones de IA (UsageEvent.feature) ─────────────────────────────────────

export const FEATURE_LABELS: Record<string, string> = {
  copiloto:                                  "Copiloto (pregunta)",
  wo_close_audit:                            "OT: revisión al cerrar",
  sr_complete_audit:                         "SS: revisión al completar",
  wo_acceptance_criteria_suggestion:         "OT: sugerir criterios de aceptación",
  wo_plan_link_suggestion:                   "OT: sugerir tarea del plan",
  wo_asset_suggestion:                       "OT: sugerir equipo",
  wo_multi_plan_summary:                     "OT: resumen de varias tareas",
  wo_rewrite_deficiencies:                   "OT: redactar deficiencias",
  wo_scan_extraction:                        "OT: leer OT escaneada",
  wo_progress_ocr:                           "Avance de OT: leer foto o escaneo",
  wo_progress_rewrite_observations:          "Avance de OT: redactar observaciones",
  wo_progress_detect_spares:                 "Avance de OT: detectar repuestos usados",
  defect_description_suggestion:             "Defecto: redactar descripción",
  defect_photo_analysis:                     "Defecto: analizar foto",
  defect_rca_suggestion:                     "Defecto: sugerir análisis de causa",
  deficiency_detection:                      "Defecto: detectar deficiencia en el texto",
  deferral_risk_analysis_suggestion:         "Diferimiento: análisis de riesgo",
  deferral_compensatory_measures_suggestion: "Diferimiento: medidas compensatorias",
  asset_criticality_suggestion:              "Equipo: sugerir criticidad",
  asset_health_report:                       "Equipo: informe de salud",
  plan_rcm_consequence_suggestion:           "Plan: sugerir consecuencia de falla",
  fluid_analyses:                            "Laboratorio: leer informe",
  fluid_ai_insights:                         "Laboratorio: interpretar resultados",
  goods_receipt:                             "Repuestos: leer remito de recepción",
  moc_draft_suggestion:                      "Gestión del cambio: borrador",
  moc_risk_assessment_suggestion:            "Gestión del cambio: análisis de riesgo",
  maintenance_advisor_report:                "Asesor de mantenimiento: informe",
  maintenance_advisor_draft:                 "Asesor de mantenimiento: borrador",
  maintenance_advisor_reply:                 "Asesor de mantenimiento: respuesta",
  monthly_report_draft:                      "Informe mensual: borrador",
  vetting_assessment_suggestion:             "Vetting: sugerir evaluación",
  tmsa_assessment_suggestion:                "TMSA: sugerir evaluación",
  ism_assessment_suggestion:                 "ISM: sugerir evaluación",
  wo_close_audit_spares:                     "OT: revisar repuestos al cerrar",
  wo_title_suggestion:                       "OT: sugerir título",
  wo_task_steps_suggestion:                  "OT: sugerir pasos de la tarea",
  wo_risk_suggestion:                        "OT: sugerir análisis de riesgo",
  wo_loto_suggestion:                        "OT: sugerir bloqueo y etiquetado",
  plan_acceptance_criteria_suggestion:       "Plan: sugerir criterios de aceptación",
  plan_loto_suggestion:                      "Plan: sugerir bloqueo y etiquetado",
  plan_risk_suggestion:                      "Plan: sugerir análisis de riesgo",
  defect_immediate_action_suggestion:        "Defecto: sugerir acción inmediata",
  defect_classification_suggestion:          "Defecto: sugerir clasificación",
  ptw_hazards_suggestion:                    "Permiso de trabajo: sugerir peligros",
  ptw_controls_suggestion:                   "Permiso de trabajo: sugerir controles",
  ptw_ppe_suggestion:                        "Permiso de trabajo: sugerir equipo de protección",
  asset_match:                               "Equipo: reconocer equipo",
  voice_report_parse:                        "Parte por voz: interpretar",
};

export const featureLabel = (f: string | null | undefined) => (f ? FEATURE_LABELS[f] ?? humanize(f) : "Sin función indicada");

/** Opciones para un desplegable, ordenadas por nombre. */
export const FEATURE_OPTIONS = Object.entries(FEATURE_LABELS).sort((a, b) => a[1].localeCompare(b[1], "es"));

// ── Instrucciones de la IA (Prompt.capability) ───────────────────────────────

export const CAPABILITY_LABELS: Record<string, string> = {
  knowledge_assistant:     "Asistente de consultas (copiloto)",
  defect_assistant:        "Asistente de defectos",
  deferral_analysis:       "Análisis de diferimientos",
  barrier_interviewer:     "Entrevista de barreras (análisis de causa)",
  maintenance_insights:    "Análisis de mantenimiento",
  daily_executive_summary: "Resumen ejecutivo diario",
  document_summarizer:     "Resumen de documentos",
  evidence_link_assistant: "Vinculación de evidencias",
};
export const capabilityLabel = (c: string | null | undefined) => (c ? CAPABILITY_LABELS[c] ?? humanize(c) : "—");

// ── Pantallas ────────────────────────────────────────────────────────────────

const SCREEN_LABELS: Record<string, string> = {
  "work-orders": "Órdenes de trabajo", work_orders: "Órdenes de trabajo",
  "service-requests": "Solicitudes de servicio", service_requests: "Solicitudes de servicio",
  "maintenance-plans": "Planes de mantenimiento", maintenance_plans: "Planes de mantenimiento",
  assets: "Equipos", asset_hours: "Horas de equipos", "asset-hours": "Horas de equipos",
  defects: "Defectos", deferrals: "Diferimientos", spares: "Repuestos", "stock-movements": "Movimientos de stock",
  "goods-receipts": "Recepción de repuestos", "spare-requests": "Pedidos de repuestos",
  certificates: "Certificados", inspections: "Inspecciones", "inspection-logs": "Inspecciones",
  "daily-reports": "Parte diario", daily_reports: "Parte diario",
  "voyage-tank-reports": "Parte de viaje", voyage_tank_reports: "Parte de viaje",
  "fluid-analyses": "Análisis de laboratorio", fluid_analyses: "Análisis de laboratorio",
  vessels: "Buques", crew: "Tripulación", drills: "Zafarranchos", "drydock-specs": "Especificación de dique", drydock_specs: "Especificación de dique",
  providers: "Proveedores", approvals: "Seguimiento", dashboard: "Inicio", home: "Inicio",
  copiloto: "Copiloto", mobile_copilot: "Copiloto en el celular", notifications: "Avisos",
  "maintenance-advisor": "Asesor de mantenimiento", maintenance_advisor: "Asesor de mantenimiento",
  moc: "Gestión del cambio", vetting: "Vetting", tmsa: "TMSA", ism: "ISM", compliance: "Cumplimiento",
  team: "Equipo", settings: "Configuración", attachments: "Adjuntos", files: "Archivos", usage: "Consumo",
  "monthly-reports": "Informes mensuales", reports: "Informes", bitacora: "Bitácora", pms: "Mantenimiento",
  capa: "Acciones correctivas", "external-audits": "Auditorías externas", permits: "Permisos de trabajo",
  "near-miss": "Cuasi accidentes", abordo: "App a bordo", auth: "Ingreso",
  me: "Perfil", profile: "Perfil", tenant: "Configuración", "ai-insights": "Análisis de la IA",
  "rest-hours": "Horas de descanso", "checklist-executions": "Checklists", "checklist-templates": "Modelos de checklist",
  excel: "Exportación a Excel", "ai-documents": "Documentos para la IA", mocs: "Gestión del cambio", audit: "Registro de cambios",
  "vessel-positions": "Posición del buque", "crew-requirements-matrix": "Matriz de tripulación",
  "fluid-analyses-thresholds": "Límites de laboratorio", "fluid-analyses-trend": "Tendencias de laboratorio",
};

// Sub-pantalla que informa el copiloto («WORK_ORDERS / WO_EDIT»).
const SUBSCREEN_LABELS: Record<string, string> = {
  WO_WIZARD_VESSEL: "nueva OT, elegir buque", WO_WIZARD_CATEGORY: "nueva OT, elegir categoría",
  WO_WIZARD_PLAN_ITEM: "nueva OT, elegir tarea del plan", WO_WIZARD_ASSET: "nueva OT, elegir equipo",
  WO_CREATE: "nueva OT", OPEN_WO_PICKER: "elegir una OT abierta", SS_CHOOSER: "elegir tipo de SS",
  SS_NEW_FROM_WO: "nueva SS desde una OT", MAINTENANCE_SHEET: "vista planilla", MOBILE_CHAT: "chat",
};
function subscreenLabel(code: string): string | null {
  const c = code.trim();
  if (!c) return null;
  if (SUBSCREEN_LABELS[c]) return SUBSCREEN_LABELS[c];
  if (/_EDIT$/.test(c)) return "edición";
  if (/_LIST$/.test(c)) return "lista";
  if (/_DETAIL$|_VIEW$/.test(c)) return "detalle";
  if (/^[A-Z_]+$/.test(c)) return null; // código sin nombre: mejor no mostrarlo
  return c;
}

/**
 * Nombre de la pantalla a partir de la ruta de la API ("/app/work-orders/123")
 * o del contexto del copiloto ("WORK_ORDERS / Detalle").
 */
export function screenLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  if (raw.includes(" / ") || /^[A-Z_]+$/.test(raw)) {
    const [mod, ...rest] = raw.split(" / ");
    const base = SCREEN_LABELS[mod.toLowerCase()] ?? humanize(mod);
    const sub = rest.map(subscreenLabel).filter((x): x is string => !!x && x.toLowerCase() !== base.toLowerCase());
    return sub.length ? `${base} · ${sub.join(" · ")}` : base;
  }
  const parts = raw.split("?")[0].split("/").filter(Boolean).filter((p) => p !== "app" && p !== "api");
  // «pms» es un prefijo de agrupación (/app/pms/work-orders): manda lo que sigue.
  for (const p of parts.filter((x) => x !== "pms")) {
    const hit = SCREEN_LABELS[p.toLowerCase()];
    if (hit) return hit;
  }
  if (parts.includes("pms")) return SCREEN_LABELS.pms;
  return parts[0] ? humanize(parts[0]) : "Inicio";
}

// ── Motivos de rechazo de ingreso ────────────────────────────────────────────

export const FAILURE_LABELS: Record<string, string> = {
  wrong_password:      "Contraseña incorrecta",
  user_not_found:      "Ese usuario no existe",
  user_inactive:       "El usuario está dado de baja",
  invalid_credentials: "Usuario o contraseña incorrectos",
};
export const failureLabel = (r: string | null | undefined) => (r ? FAILURE_LABELS[r] ?? humanize(r) : "Usuario o contraseña incorrectos");

// ── Registro de cambios (AuditEvent) ─────────────────────────────────────────

export const ENTITY_LABELS: Record<string, string> = {
  tenant: "Empresa", tenantsetting: "Configuración de la empresa", user: "Usuario", platformuser: "Persona de la consola",
  vessel: "Buque", asset: "Equipo", assethoursreading: "Lectura de horas", maintenanceplan: "Plan de mantenimiento",
  workorder: "Orden de trabajo", servicerequest: "Solicitud de servicio", defect: "Defecto", deferral: "Diferimiento",
  spare: "Repuesto", sparerequest: "Pedido de repuestos", goodsreceipt: "Recepción de repuestos", stocklocation: "Depósito",
  stockreservation: "Reserva de stock", certificate: "Certificado", inspection: "Inspección", checklistexecution: "Checklist",
  crew: "Tripulante", crewcertification: "Certificado de tripulante", crewresthours: "Horas de descanso",
  drill: "Zafarrancho", drillrequirement: "Requisito de zafarrancho", drydockspec: "Especificación de dique",
  externalaudit: "Auditoría externa", externalauditfinding: "Hallazgo de auditoría", failuremode: "Modo de falla",
  fluidsample: "Muestra de laboratorio", fluidanalysis: "Análisis de laboratorio", maintenanceadvisoraction: "Acción del asesor",
  maintenanceadvisorreport: "Informe del asesor", mocrecord: "Gestión del cambio", moc: "Gestión del cambio",
  nearmissreport: "Cuasi accidente", permit: "Permiso de trabajo", provider: "Proveedor", capa: "Acción correctiva",
  fluidanalysisresult: "Resultado de laboratorio", checklist: "Checklist", assethours: "Horas de equipo",
  teammember: "Integrante del equipo", monthlyreport: "Informe mensual", assethealthreport: "Informe de salud del equipo",
  maintenanceadvisor: "Asesor de mantenimiento", servicerequest_: "Solicitud de servicio", service_request: "Solicitud de servicio",
  monthly_report: "Informe mensual",
};
export const entityLabel = (e: string | null | undefined) => (e ? ENTITY_LABELS[e.toLowerCase()] ?? humanize(e) : "—");

const ACTION_LABELS: Record<string, string> = {
  TENANT_LOGIN_SUCCESS:   "Ingresó al sistema",
  TENANT_LOGIN_FAILED:    "Intento de ingreso rechazado",
  PLATFORM_LOGIN_SUCCESS: "Ingresó a la consola",
  PLATFORM_LOGIN_FAILED:  "Intento de ingreso a la consola rechazado",
  PASSWORD_CHANGED:       "Cambió la contraseña",
  EMAIL_CHANGED:          "Cambió el correo",
  TENANT_CREATED:         "Creó una empresa",
  TENANT_UPDATED:         "Modificó los datos de una empresa",
  TENANT_USER_REVOKED_BY_PLATFORM_ADMIN: "Le quitó el acceso a un usuario",
  PLATFORM_USER_CREATED:  "Agregó una persona a la consola",
  ROLE_PERMISSIONS_UPDATED: "Cambió los permisos por rol",
  SERVICE_REQUEST_CREATED:  "Creó una solicitud de servicio",
  SERVICE_REQUEST_AUTHORIZED: "Autorizó una solicitud de servicio",
  SERVICE_REQUEST_CLOSED_WITH_WORK_ORDER: "Cerró una solicitud de servicio con su OT",
  SERVICE_REQUEST_SIGNATURES_EDITED: "Modificó las firmas de una solicitud de servicio",
  SERVICE_REQUEST_HOJA_RUTA_UPDATED: "Modificó la hoja de ruta de una solicitud de servicio",
  SERVICE_REQUEST_HOJA_RUTA_DELETED: "Borró la hoja de ruta de una solicitud de servicio",
  DEFECT_REPORTED:        "Reportó un defecto",
  CERTIFICATE_EXPIRED:    "Venció un certificado",
  AI_INSIGHT_CREATED:     "La IA generó un análisis",
  STOCK_ADJUSTED:         "Ajustó stock",
  SERVICE_REQUEST_DELETED: "Borró una solicitud de servicio",
  MONTHLY_REPORT_GENERATED: "Generó un informe mensual",
};

// Verbo de las acciones «Entidad.verbo» que publican los módulos.
const VERB_LABELS: Record<string, string> = {
  created: "Creó", updated: "Modificó", deleted: "Borró", closed: "Cerró", reopened: "Reabrió",
  approved: "Aprobó", authorized: "Autorizó", rejected: "Rechazó", cancelled: "Anuló", canceled: "Anuló",
  submitted: "Envió", submittedforapproval: "Envió a aprobación", requested: "Solicitó", activated: "Activó",
  held: "Puso en espera", resumed: "Retomó", executed: "Registró la ejecución de", renewed: "Renovó",
  generated: "Generó", recorded: "Registró", entered: "Cargó resultados de", overwritten: "Reemplazó",
  openedfromplan: "Abrió desde el plan", autoclosedfromplan: "Se cerró sola desde el plan",
  planlinked: "Vinculó al plan", planunlinked: "Desvinculó del plan", typechanged: "Cambió el tipo de",
  statuschanged: "Cambió el estado de", attachmentadded: "Agregó un adjunto a",
  labreportadded: "Agregó el informe del laboratorio a", labreportattached: "Agregó el informe del laboratorio a",
  executionedited: "Modificó la ejecución de", criticalalert: "Alerta crítica en",
  linkedtoworkorder: "Vinculó a una OT", createdfromworkorder: "Creó desde una OT",
  createdfromfluidanalysis: "Creó desde un análisis de laboratorio", closedwithworkorder: "Cerró con su OT",
  itemsimported: "Importó ítems a", proposalapplied: "Aplicó una propuesta de",
  maintenancedirectorgranted: "Nombró Director de Mantenimiento a", under_analysis: "Pasó a análisis",
  under_review: "Pasó a revisión", runninghoursupdated: "Actualizó las horas de",
  runninghoursfromfluidreport: "Tomó las horas del informe del laboratorio en",
  labsamplenumbers: "Cargó los números de muestra de",
};

/** Frase de lo que pasó: «Cerró · Orden de trabajo». */
export function auditActionLabel(action: string, entityType?: string | null): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const dot = action.lastIndexOf(".");
  if (dot > 0) {
    const ent = entityLabel(action.slice(0, dot));
    const verb = VERB_LABELS[action.slice(dot + 1).toLowerCase()];
    return verb ? `${verb} · ${ent}` : `${humanize(action.slice(dot + 1))} · ${ent}`;
  }
  // Formato viejo «ENTIDAD_VERBO» o verbo suelto («CREATE»).
  const m = action.match(/^(.*?)_?(CREATED?|UPDATED?|DELETED?|GENERATED|CLOSED|APPROVED)$/);
  if (m) {
    const verb = VERB_LABELS[(m[2].endsWith("D") ? m[2] : m[2] + "D").toLowerCase()] ?? humanize(m[2]);
    const ent = m[1] ? entityLabel(m[1].replace(/_/g, "")) : entityType ? entityLabel(entityType) : "";
    return ent ? `${verb} · ${ent}` : verb;
  }
  return humanize(action);
}

/** Tipo de evento, para colorear y para el filtro «Tipo». */
export function auditActionKind(action: string): "login" | "login_failed" | "config" | "data" {
  if (/LOGIN_FAILED$/.test(action)) return "login_failed";
  if (/LOGIN_SUCCESS$|PASSWORD_CHANGED|EMAIL_CHANGED/.test(action)) return "login";
  if (/^TENANT_|^PLATFORM_|ROLE_PERMISSIONS|PROMPT/.test(action)) return "config";
  return "data";
}

// ── Formatos ─────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** «hoy 08:27», «ayer 11:01», «03/10 09:28», «03/10/2025 09:28». */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return `hoy ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `ayer ${time}`;
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return d.getFullYear() === now.getFullYear() ? `${date} ${time}` : `${date}/${d.getFullYear()} ${time}`;
}

/** «hace 3 min», «hace 2 h», «hace 4 días». */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Dólares con los decimales que hagan falta para que no se lea «0,00». */
export function fmtUsd(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  const digits = n === 0 ? 2 : n < 0.01 ? 4 : 2;
  return `US$ ${n.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtBytes(b: number | null | undefined): string {
  const n = Number(b ?? 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString("es-AR", { maximumFractionDigits: 0 })} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
  return `${(n / 1024 ** 3).toLocaleString("es-AR", { maximumFractionDigits: 2 })} GB`;
}

export const fmtInt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("es-AR");

/** Último recurso para un código sin nombre: «SOME_CODE» → «Some code». */
export function humanize(code: string): string {
  const s = code.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : code;
}
