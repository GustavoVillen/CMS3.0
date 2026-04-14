const _ensuredHeadersCache = {};

const DAILY_REPORT_MAIN_SLOT_PREFIXES = ["MP1", "MP2", "MP3", "MP4"];
const DAILY_REPORT_GENERATOR_SLOT_PREFIXES = ["MG1", "MG2", "MG3", "MG4"];
const DAILY_REPORT_FUEL_TANK_PREFIXES = ["TK_COMB_1", "TK_COMB_2", "TK_COMB_3"];
const DAILY_REPORT_OIL_TANK_PREFIXES = ["TK_ACEITE_1", "TK_ACEITE_2", "TK_ACEITE_3"];

function _buildDailyVesselConfigHeaders_(prefixes) {
  return prefixes.flatMap(function(prefix) {
    return [`${prefix}_Equipment`, `${prefix}_SFI`];
  });
}

function _buildDailyReportMachineHeaders_(prefixes) {
  return prefixes.flatMap(function(prefix) {
    return [
      `${prefix}_Equipment`,
      `${prefix}_SFI`,
      `${prefix}_Previous_Hours`,
      `${prefix}_Current_Hours`,
      `${prefix}_Operated_Hours`,
      `${prefix}_Avg_RPM`,
      `${prefix}_Avg_Load`,
      `${prefix}_General_Status`,
    ];
  });
}

function _buildDailyReportTankHeaders_(prefixes) {
  return prefixes.flatMap(function(prefix) {
    return [`${prefix}_Equipment`, `${prefix}_SFI`, `${prefix}_Sounding`];
  });
}

const DAILY_REPORT_VESSEL_CONFIG_HEADERS = [].concat(
  _buildDailyVesselConfigHeaders_(DAILY_REPORT_MAIN_SLOT_PREFIXES),
  _buildDailyVesselConfigHeaders_(DAILY_REPORT_GENERATOR_SLOT_PREFIXES),
  _buildDailyVesselConfigHeaders_(DAILY_REPORT_FUEL_TANK_PREFIXES),
  _buildDailyVesselConfigHeaders_(DAILY_REPORT_OIL_TANK_PREFIXES),
);

const DAILY_REPORT_FLAT_HEADERS = [
  "ReportID",
  "Date",
  "Time",
  "VesselName",
  "Reporter",
  "Voyage_Number",
  "Position",
  "Operational_Status",
].concat(
  _buildDailyReportMachineHeaders_(DAILY_REPORT_MAIN_SLOT_PREFIXES),
  _buildDailyReportMachineHeaders_(DAILY_REPORT_GENERATOR_SLOT_PREFIXES),
  _buildDailyReportTankHeaders_(DAILY_REPORT_FUEL_TANK_PREFIXES),
  _buildDailyReportTankHeaders_(DAILY_REPORT_OIL_TANK_PREFIXES),
  [
    "Observaciones",
    "Executive_Summary_Status",
    "Executive_Summary_Text",
    "Executive_Summary_JSON",
    "System_Recommendations_Text",
    "System_Recommendations_JSON",
    "Executive_Summary_Generated_At",
    "IA_Maintenance_Priority",
    "IA_Maintenance_Insights_Text",
    "IA_Maintenance_Recommendations_Text",
    "IA_Maintenance_Insights_JSON",
    "IA_Maintenance_Analyzed_At",
    "Report_PDF_Link",
    "Status",
    "ASSET_ID",
  ],
);

function _getExpectedHeadersForTable_(tableName) {
  const h = DB_CONFIG.HEADERS;
  const t = DB_CONFIG.TABLES;

  const mapping = {
    [t.USERS]: h.USERS,
    [t.ASSETS]: h.ASSETS,
    [t.VESSELS]: h.VESSELS,
    [t.SPARES]: h.SPARES,
    [t.INSPECTIONS]: h.INSPECTIONS,
    [t.INSPECTIONS_LOG]: h.INSPECTIONS_LOG,
    [t.RCA_LOG]: h.RCA_LOG,
    [t.CAPA_LOG]: h.CAPA_LOG,
    [t.DEFECT_LOG]: h.DEFECT_LOG,
    [t.WORK_ORDERS]: h.WORK_ORDERS,
    [t.MAINTENANCE_PLAN]: h.MAINTENANCE_PLAN,
    [t.DAILY_REPORTS]: h.DAILY_REPORTS,
    [t.CERTIFICATES]: h.CERTIFICATES,
    [t.SPARE_ORDERS]: h.SPARE_ORDERS,
    [t.PROVEEDORES]: h.PROVEEDORES,
    [t.EVAL_PROVEEDORES]: h.EVAL_PROVEEDORES,
    [t.NC_PROVEEDORES]: h.NC_PROVEEDORES,
    [t.AUDIT_LOG]: h.AUDIT_LOG,
    [t.STOCK_MOVEMENTS]: h.STOCK_MOVEMENTS,
    [t.DEFERRALS]: h.DEFERRALS,
    [t.DAILY_REPORT_MAIN_ENGINES]: h.DAILY_REPORT_MAIN_ENGINES,
    [t.DAILY_REPORT_AUXILIARIES]: h.DAILY_REPORT_AUXILIARIES,
    [t.DAILY_REPORT_CONSUMPTION]: h.DAILY_REPORT_CONSUMPTION,
    [t.DAILY_REPORT_DEFECT_EVENTS]: h.DAILY_REPORT_DEFECT_EVENTS,
    [t.DAILY_REPORT_MAINTENANCE_EVENTS]: h.DAILY_REPORT_MAINTENANCE_EVENTS,
    [t.DAILY_REPORT_BARRIERS]: h.DAILY_REPORT_BARRIERS,
  };

  return mapping[tableName] || null;
}

function _computeSpareStatus_(stockValue, minValue) {
  const stock = parseFloat(stockValue);
  const min = parseFloat(minValue);
  const safeStock = isNaN(stock) ? 0 : stock;
  const safeMin = isNaN(min) ? 0 : min;

  if (safeStock === 0) return 'ATENCION!';
  if (safeStock < safeMin) return 'CRITICO';
  if (safeStock === safeMin) return 'BAJO. Hacer Solicitud.';
  return 'OK';
}

/**
 * DB.js - Motor Controlador de Base de Datos para Google Sheets y Drive
 */

const DB_CONFIG = {
  // ARCHIVOS DE GOOGLE SHEETS (IDs)
  IDS: {
    FLEET_DB: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
    INVENTORY_DB: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
    SPARES_DB: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
    INSPECTIONS_DB: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
    MAINTENANCE_PLAN_DB: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
    CERTIFICATES_DB: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
    PROVEEDORES_DB: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
  },

  // FOLDERS DE DRIVE
  EVIDENCE_FOLDER_ID: "134HwRIadpgYzkXe6jZ3X4GGhnNQU6ton",
  CHECKLIST_FOLDER_ID: "134HwRIadpgYzkXe6jZ3X4GGhnNQU6ton", // Temporalmente la misma, el usuario puede cambiarla
  DEFECT_PDF_FOLDER_ID: "1q-Fir5AooCEqVQOWljKsI9EsLnebJ2KK",

  TABLES: {
    USERS: "_USERS",
    VESSELS: "VESSELS",
    ASSETS: "ASSETS",
    MAINTENANCE_PLAN: "MAINTENANCE_PLAN",
    WORK_ORDERS: "WORK_ORDERS",
    DEFECT_LOG: "DEFECT_LOG",
    DEFECTS: "DEFECTS",
    DEFERRALS: "DEFERRALS",
    SPARES: "SPARES",
    CONDITION_MONITORING: "CONDITION_MONITORING",
    KPI: "KPI",
    INSPECTIONS: "INSPECTIONS",
    INSPECTIONS_LOG: "INSPECTIONS_LOG",
    RCA_LOG: "RCA_LOG",
    CAPA_LOG: "CAPA_LOG",
    DAILY_REPORTS: "DAILY_REPORTS",
    DAILY_REPORT_MAIN_ENGINES: "DAILY_REPORT_MAIN_ENGINES",
    DAILY_REPORT_AUXILIARIES: "DAILY_REPORT_AUXILIARIES",
    DAILY_REPORT_CONSUMPTION: "DAILY_REPORT_CONSUMPTION",
    DAILY_REPORT_DEFECT_EVENTS: "DAILY_REPORT_DEFECT_EVENTS",
    DAILY_REPORT_MAINTENANCE_EVENTS: "DAILY_REPORT_MAINTENANCE_EVENTS",
    DAILY_REPORT_BARRIERS: "DAILY_REPORT_BARRIERS",
    CERTIFICATES: "CERTIFICATES",
    PROVEEDORES: "PROVEEDORES",
    EVAL_PROVEEDORES: "EVAL_PROVEEDORES",
    NC_PROVEEDORES: "NC_PROVEEDORES",
    SPARE_ORDERS: "SPARE_ORDERS",
    AUDIT_LOG: "_AUDIT_LOG",
    STOCK_MOVEMENTS: "_STOCK_MOVEMENTS",
    BARRIER_ASSESSMENTS: "BARRIER_ASSESSMENTS",
  },

  // CABECERAS CANÓNICAS PARA EVITAR DESCOMPAGINACIÓN
  HEADERS: {
    USERS: [
      "USER_ID",
      "EMAIL",
      "PASSWORD_HASH",
      "ROLE",
      "PERMISSIONS",
      "STATUS",
      "ASSIGNED_ASSET_ID",
      "ASSIGNED_ASSET_IDS",
      "ASSIGNED_VESSEL",
      "ASSIGNED_VESSELS",
      "ASSIGNED_UNIT_ID",
      "ASSIGNED_UNIT_IDS",
      "FAILED_ATTEMPTS",
      "LOCKED_UNTIL",
    ],
    ASSETS: [
      "SFI",
      "Equipo_ID",
      "Nombre_Funcional",
      "VesselName",
      "Fabricante",
      "Modelo",
      "N_Serie",
      "Fecha_Instalacion",
      "Localizacion",
      "Compartimento",
      "Potencia_KW",
      "Presion_bar",
      "Caudal_m3h",
      "Temperatura_C",
      "Medio_Servicio",
      "Condiciones_Operacion",
      "Criticidad",
      "Funcion_Critica",
      "Justificacion_Criticidad",
      "Evaluado_Por",
      "Fecha_Evaluacion",
      "Repuestos_Criticos_Stock",
      "Es_Equipo_Ex",
      "Certificado_Ex",
      "Ex_Tipo_Proteccion",
      "Ex_Grupo_Gas",
      "Ex_Clase_Temp",
      "Status",
    ],
    VESSELS: [
      "VesselName",
      "Codigo_Embarcacion",
      "Armador",
      "Tipo",
      "IMO",
      "Matricula",
      "Potencia_HP",
      "DWT_tons",
      "Eslora_m",
      "Manga_m",
      "Puntal_m",
      "TRN_tn",
      "TRB_tn",
      "Ano_Construcc",
      "Pais_Construccion",
      "Fecha_Incorporacion",
      "Tipo_Incorporacion",
      "Status",
      "ME1_SFI",
      "ME2_SFI",
      "G1_SFI",
      "G2_SFI",
      "CP_SFI",
      ...DAILY_REPORT_VESSEL_CONFIG_HEADERS,
    ],
    SPARES: [
      "SKU",
      "SFI",
      "Nombre_Funcional",
      "VesselName",
      "Fabricante",
      "Modelo",
      "P_N",
      "Stock_Actual",
      "MIN",
      "SS",
      "ROP",
      "Ubicacion",
      "Condicion",
      "Status",
      "Equipo/Sistema",
      "Nivel",
      "EX (Si/No)",
      "Ubicación",
      "Lead Time",
      "Fuente_Informacion",
      "Impacta trazabilidad",
      "ASSET_ID",
    ],
    INSPECTIONS: [
      "TaskID",
      "SFI",
      "Descripcion_Prueba",
      "Frecuencia",
      "FREQS",
      "FREQM",
      "Trigger_Tipo",
      "VesselName",
      "Responsable",
      "Evidencia_Requerida",
      "Criterio_Aceptacion",
      "Procedimiento_Link",
      "Activo",
      "Observaciones",
      "Ultima_Fecha",
      "Siguiente_Fecha",
      "Estado_Visible",
      "Checklist_Link",
      "ASSET_ID",
    ],
    MAINTENANCE_PLAN: [
      "TaskID",
      "VesselName",
      "SFI",
      "Equipo",
      "Tarea_Mantenimiento",
      "Trigger_Tipo",
      "Responsable",
      "Evidencia_Requerida",
      "Criterio_Aceptacion",
      "Procedimiento_Link",
      "Activo",
      "Observaciones",
      "Frecuencia_HS",
      "Frecuencia_Meses",
      "Ultima_Ejecucion_Fecha",
      "Ultima_Ejecucion_HS",
      "Siguiente_Vencimiento_Fecha",
      "Siguiente_Vencimiento_HS",
      "Status",
      // OT abierta asociada a la tarea (se mantiene solo mientras la OT no esté CERRADA)
      "OT_ID",
      "Criticidad",
      "ASSET_ID",
    ],
    INSPECTIONS_LOG: [
      "PI_ID",
      "TaskID",
      "Fecha_Ejecucion",
      "SFI",
      "Descripcion",
      "Resultado",
      "Hallazgos_Observaciones",
      "Responsable",
      "Parametros",
      "Evidencia_Link",
      "OT_Asociada",
      "VesselName",
      "ASSET_ID",
    ],
    WORK_ORDERS: [
      "OT_ID",
      "TaskID",
      "VesselName",
      "AssetID",
      "Criticidad",
      "Type",
      "Priority",
      "Status",
      "Estado_Visible",
      "OpenDate",
      "PlannedDate",
      "Fecha_Vencimiento_OT",
      "CompletedDate",
      "CompletedHours",
      "Ventana_Tolerancia",
      "Remarks",
      "Asignado_Por",
      "Responsable_Ejecutor",
      "Nombre_Responsable",
      "Verificador_Independiente",
      "Repuestos_Consumidos",
      "Resultado_Prueba",
      "Evidencia_Files",
      "Estado_Equipo_Post_OT",
      "IA_Plazo_Normal_Dias",
      "IA_Nivel_Riesgo",
      "IA_Justificacion_Plazo",
      "IA_Restriccion_Operativa",
      "Deferral_Required",
      "Deferral_Justificacion",
      "Deferral_Medida_Compensatoria",
      "Deferral_Restricciones",
      "Deferral_Aprobador",
      "Deferral_Email_Autorizante",
      "Deferral_Permite_Operacion",
      "Deferral_Declarado_NoGo",
      "Deferral_Fecha_Vencimiento",
      "Deferral_Autorizacion_Status",
      "Deferral_Comentarios_Autorizacion",
      "Deferral_Link_PDF",
      "ASSET_ID",
    ],
    RCA_LOG: [
      "RCA_ID",
      "Fecha_Evento",
      "Embarcacion",
      "Sistema_Equipo",
      "Tipo_Evento",
      "Lider_RCA",
      "Descripcion_Evento",
      "Metodologia_Usada",
      "Causa_Inmediata",
      "Causa_Contribuyente",
      "Causa_Raiz",
      "Barreras_Falladas",
      "Evidencia_Link",
      "SLA_Vencimiento",
      "Status",
      "ASSET_ID",
    ],
    CAPA_LOG: [
      "CAPA_ID",
      "Origen_ID",
      "Embarcacion",
      "Tipo",
      "Prioridad",
      "Descripcion_Accion",
      "Responsable",
      "Fecha_Compromiso",
      "Criterio_Aceptacion",
      "Requiere_Verificacion_Efectividad",
      "Evidencia_Cierre_Link",
      "Status",
      "ASSET_ID",
    ],
    DEFECT_LOG: [
      "Defecto_ID",
      "Fecha_Reporte",
      "Embarcacion",
      "SFI",
      "Clasificacion_Falla",
      "Descripcion_Sintoma",
      "Accion_Inmediata",
      "Estado_Operativo",
      "Requiere_Diferimiento",
      "Medida_Compensatoria",
      "Fecha_Vencimiento",
      "Responsable_Correccion",
      "TaskID",
      "OT_Asociada",
      "Prueba_Aceptacion_Status",
      "Evidencia_Files",
      "Status",
      "RCA_ID",
      "Link_PDF",
      "ASSET_ID",
    ],
    DAILY_REPORTS: DAILY_REPORT_FLAT_HEADERS,
    DAILY_REPORT_MAIN_ENGINES: [
      "ReportID",
      "AssetID",
      "SFI",
      "Previous_Hours",
      "Current_Hours",
      "Delta_Hours",
      "RPM",
      "Load_Percent",
      "Temperatures_JSON",
      "Alarms_Flag",
      "Abnormality_Code",
      "ASSET_ID",
    ],
    DAILY_REPORT_AUXILIARIES: [
      "ReportID",
      "AssetID",
      "SFI",
      "Status",
      "Running_Hours",
      "Alarms_Flag",
      "Failure_Flag",
      "Linked_Defect_ID",
      "ASSET_ID",
    ],
    DAILY_REPORT_CONSUMPTION: [
      "ReportID",
      "Fuel_Opening_ROB",
      "Fuel_Received",
      "Fuel_Closing_ROB",
      "Fuel_Consumed",
      "LO_Opening",
      "LO_Closing",
      "LO_Consumed",
      "Abnormal_Consumption_Flag",
      "ASSET_ID",
    ],
    DAILY_REPORT_DEFECT_EVENTS: [
      "ReportID",
      "DefectID",
      "AssetID",
      "SFI",
      "Criticality",
      "Symptom_Code",
      "Impact_Code",
      "Deferred_Flag",
      "Status",
      "ASSET_ID",
    ],
    DAILY_REPORT_MAINTENANCE_EVENTS: [
      "ReportID",
      "WorkOrderID",
      "Maintenance_Type",
      "Completed_Flag",
      "Spare_Parts_JSON",
      "Evidence_Flag",
      "ASSET_ID",
    ],
    DAILY_REPORT_BARRIERS: [
      "ReportID",
      "Steering_Status",
      "Fire_System_Status",
      "Emergency_Gen_Status",
      "Pollution_Barrier_Status",
      "Cargo_System_Status",
      "Critical_Barrier_Degraded",
      "ASSET_ID",
    ],
    CERTIFICATES: [
      "Cert_ID",
      "VesselName",
      "Certificado",
      "Numero",
      "Fecha_Emision",
      "Fecha_Vencimiento",
      "Autoridad",
      "Status",
      "Estado_Visible",
      "Link_PDF",
      "ASSET_ID",
    ],
    PROVEEDORES: [
      "ID_Proveedor",
      "Razon_Social",
      "CUIT_TaxID",
      "Categoria",
      "Es_Ex",
      "Contacto",
      "Email",
      "Telefono",
      "Score_Global",
      "Status",
      "Evidencia_Precalificacion",
      "ASSET_ID",
    ],
    EVAL_PROVEEDORES: [
      "ID_Evaluacion",
      "ID_Proveedor",
      "Fecha_Evaluacion",
      "OT_Referencia",
      "Servicio_Entregado",
      "Score_OTD",
      "Score_Calidad",
      "Score_Doc",
      "Score_EHS",
      "Score_Total",
      "Comentarios",
      "Evidencia",
      "Evaluador",
      "ASSET_ID",
    ],
    NC_PROVEEDORES: [
      "ID_NC_Proveedor",
      "Fecha",
      "ID_Proveedor",
      "Falla_Detectada",
      "Accion_Requerida",
      "Fecha_Cierre",
      "Status",
      "Responsable",
      "Evidencia",
      "ASSET_ID",
    ],
    SPARE_ORDERS: [
      "OrderID",
      "Fecha_Pedido",
      "VesselName",
      "SKU",
      "Repuesto",
      "Cantidad",
      "Proveedor",
      "Fecha_Estimada",
      "Comentarios_Solicitud",
      "Estado",
      "OT_Asociada",
      "Fecha_Recepcion",
      "Comentarios_Jefe_Maquinas",
      "ASSET_ID",
    ],
    AUDIT_LOG: [
      "Timestamp",
      "User",
      "Action",
      "Table",
      "RecordID",
      "Details",
      "ASSET_ID",
    ],
    STOCK_MOVEMENTS: [
      "Timestamp",
      "User",
      "VesselName",
      "SKU",
      "Type",
      "Quantity",
      "Balance",
      "Reference",
      "ASSET_ID",
    ],
    DEFERRALS: [
      "Deferral_ID",
      "Fecha_Solicitud",
      "Defecto_ID",
      "TaskID_Origen",
      "OT_Asociada",
      "Embarcacion",
      "SFI",
      "Clasificacion",
      "Motivo",
      "Medida_Compensatoria",
      "Restricciones_Operativas",
      "Fecha_Vencimiento",
      "Aprobador",
      "Comentarios_Autorizacion",
      "Declarado_NoGo",
      "Permite_Operacion",
      "Status",
      "Estado_Visible",
      "Notas_Cierre",
      "RCA_ID",
      "ASSET_ID",
    ],
    BARRIER_ASSESSMENTS: [
      "Defecto_ID",
      "barrier_assessment_status",
      "barrier_assessment_completed",
      "barrier_assessment_started_at",
      "barrier_assessment_completed_at",
      "barrier_assessment_completed_by",
      "barrier_domain",
      "barrier_family",
      "trigger_event",
      "barrier_affected",
      "barrier_name",
      "barrier_type",
      "barrier_status",
      "alternative_barrier_exists",
      "condition_initial",
      "acceptance_criterion",
      "test_result",
      "verification_method",
      "operational_decision",
      "operational_restriction",
      "evidence_reference",
      "compensatory_measure_required",
      "compensatory_measure_description",
      "corrective_action_required",
      "corrective_action_description",
      "reassessment_required",
      "reassessment_due_date",
      "deferral_impact",
      "rca_recommended",
      "capa_recommended",
      "assessment_basis",
      "assessment_transcript",
      "assessment_qna_log",
      "compliance_status",
      "assessment_last_updated_at",
      "assessment_last_updated_by",
      "ASSET_ID",
    ],
  },
};

// CACHE EN MEMORIA (DURA SOLO LA EJECUCIÓN DEL REQUEST)
var _cacheReadTable = {};
var _ssInstanceCache = {};
var AUTH_SESSION_TTL_SECONDS = 21600;
var AUTH_PERSISTENT_TOKEN_PREFIX = "AUTH_TOKEN::";

function _normalizeAccessKey_(value) {
  return String(value == null ? "" : value)
    .trim()
    .toUpperCase();
}

function _getSessionUserEmail_() {
  return String(Session.getActiveUser().getEmail() || "").trim();
}

function _toHexString_(bytes) {
  return bytes
    .map(function (b) {
      const normalized = b < 0 ? b + 256 : b;
      return ("0" + normalized.toString(16)).slice(-2);
    })
    .join("");
}

function _buildPasswordHash_(plainPassword, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || "") + String(plainPassword || ""),
    Utilities.Charset.UTF_8,
  );
  return "sha256$" + salt + "$" + _toHexString_(digest);
}

function _verifyPasswordHash_(plainPassword, storedHash) {
  const normalizedHash = String(storedHash || "").trim();
  if (!normalizedHash) return false;

  const parts = normalizedHash.split("$");
  if (parts.length === 3 && parts[0] === "sha256") {
    return _buildPasswordHash_(plainPassword, parts[1]) === normalizedHash;
  }

  return String(plainPassword || "") === normalizedHash;
}

function _createPasswordSalt_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 16);
}

function _getSessionBindingKey_() {
  const tempKey = String(Session.getTemporaryActiveUserKey() || "").trim();
  if (!tempKey) {
    throw new Error("Unauthorized: no browser session available");
  }
  return "AUTH_SESSION::" + tempKey;
}

function _getActiveSessionPayload_() {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(_getSessionBindingKey_());
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (e) {
    cache.remove(_getSessionBindingKey_());
    return null;
  }
}

function _saveAuthenticatedSession_(userRecord) {
  const payload = {
    userId: String(userRecord.USER_ID || "").trim(),
    createdAt: Date.now(),
  };
  CacheService.getScriptCache().put(
    _getSessionBindingKey_(),
    JSON.stringify(payload),
    AUTH_SESSION_TTL_SECONDS,
  );
}

function _clearAuthenticatedSession_() {
  CacheService.getScriptCache().remove(_getSessionBindingKey_());
}

function _getPersistentSessionStore_() {
  return PropertiesService.getScriptProperties();
}

function _buildPersistentSessionKey_(token) {
  return AUTH_PERSISTENT_TOKEN_PREFIX + String(token || "").trim();
}

function _createPersistentSessionToken_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

function _savePersistentSession_(userRecord) {
  const token = _createPersistentSessionToken_();
  const payload = {
    userId: String(userRecord.USER_ID || "").trim(),
    createdAt: Date.now(),
  };
  _getPersistentSessionStore_().setProperty(
    _buildPersistentSessionKey_(token),
    JSON.stringify(payload),
  );
  return token;
}

function _getPersistentSessionPayload_(token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return null;

  const raw = _getPersistentSessionStore_().getProperty(
    _buildPersistentSessionKey_(normalizedToken),
  );
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (e) {
    _clearPersistentSessionToken_(normalizedToken);
    return null;
  }
}

function _clearPersistentSessionToken_(token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return;
  _getPersistentSessionStore_().deleteProperty(
    _buildPersistentSessionKey_(normalizedToken),
  );
}

function _resumePersistentSession_(token) {
  const payload = _getPersistentSessionPayload_(token);
  if (!payload || !payload.userId) return null;

  const user = _findAuthorizedUserByUserId_(payload.userId);
  if (!user || user.STATUS !== "ACTIVE" || !user.ROLE) {
    _clearPersistentSessionToken_(token);
    return null;
  }

  _saveAuthenticatedSession_(user);
  return user;
}

function _getUsersSheet_() {
  const tableName = DB_CONFIG.TABLES.USERS;
  const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);
  return sheet;
}

function _readAuthorizedUsers_() {
  const sheet = _getUsersSheet_();
  const data = sheet.getDataRange().getDisplayValues();
  if (!data || data.length <= 1) return [];

  const headers = data[0].map((h) => String(h).trim());
  return data
    .slice(1)
    .map((row, idx) => {
      const record = { _rowIndex: idx + 2 };
      headers.forEach((header, colIdx) => {
        record[header] = row[colIdx];
      });
      return record;
    })
    .filter((record) => String(record.EMAIL || "").trim() !== "");
}

function _normalizeAuthorizedUserRecord_(record, sessionEmail) {
  if (!record) return null;
  return {
    USER_ID: String(record.USER_ID || "").trim(),
    EMAIL: String(record.EMAIL || sessionEmail || "").trim(),
    ROLE: _normalizeAccessKey_(record.ROLE || ""),
    PERMISSIONS: String(record.PERMISSIONS || "").trim(),
    STATUS: _normalizeAccessKey_(record.STATUS || ""),
    ASSIGNED_ASSET_ID: String(record.ASSIGNED_ASSET_ID || "").trim(),
    ASSIGNED_ASSET_IDS: String(record.ASSIGNED_ASSET_IDS || "").trim(),
    ASSIGNED_VESSEL: String(record.ASSIGNED_VESSEL || "").trim(),
    ASSIGNED_VESSELS: String(record.ASSIGNED_VESSELS || "").trim(),
    ASSIGNED_UNIT_ID: String(record.ASSIGNED_UNIT_ID || "").trim(),
    ASSIGNED_UNIT_IDS: String(record.ASSIGNED_UNIT_IDS || "").trim(),
  };
}

function _findAuthorizedUserByUserId_(userId) {
  const targetUserId = _normalizeAccessKey_(userId);
  if (!targetUserId) return null;

  const match = _readAuthorizedUsers_().find(function (record) {
    return _normalizeAccessKey_(record.USER_ID) === targetUserId;
  });

  return match ? _normalizeAuthorizedUserRecord_(match, match.EMAIL || "") : null;
}

function getAuthenticatedUser() {
  const sessionPayload = _getActiveSessionPayload_();
  if (!sessionPayload || !sessionPayload.userId) return null;

  const normalized = _findAuthorizedUserByUserId_(sessionPayload.userId);
  if (normalized.STATUS !== "ACTIVE") return null;
  if (!normalized.ROLE) return null;

  return normalized;
}

function apiLogin(userId, password) {
  const normalizedUserId = _normalizeAccessKey_(userId);
  const plainPassword = String(password || "");
  if (!normalizedUserId || !plainPassword) {
    throw new Error("Credenciales inválidas");
  }

  const user = _findAuthorizedUserByUserId_(normalizedUserId);
  if (!user || user.STATUS !== "ACTIVE") {
    throw new Error("Credenciales inválidas");
  }

  const fullRecord = _readAuthorizedUsers_().find(function (record) {
    return _normalizeAccessKey_(record.USER_ID) === normalizedUserId;
  });
  if (!fullRecord || !_verifyPasswordHash_(plainPassword, fullRecord.PASSWORD_HASH)) {
    throw new Error("Credenciales inválidas");
  }

  const persistentToken = _savePersistentSession_(user);
  _saveAuthenticatedSession_(user);

  return {
    success: true,
    userId: user.USER_ID,
    role: user.ROLE,
    assignedVessel: user.ASSIGNED_VESSEL || "",
    assignedVessels: user.ASSIGNED_VESSELS || "",
    sessionToken: persistentToken,
  };
}

function apiResumeSession(sessionToken) {
  const user = _resumePersistentSession_(sessionToken);
  if (!user) {
    throw new Error("Sesión expirada");
  }

  return {
    success: true,
    userId: user.USER_ID,
    role: user.ROLE,
    assignedVessel: user.ASSIGNED_VESSEL || "",
    assignedVessels: user.ASSIGNED_VESSELS || "",
  };
}

function apiLogout(sessionToken) {
  _clearPersistentSessionToken_(sessionToken);
  _clearAuthenticatedSession_();
  return { success: true };
}

function setUserPassword(userId, plainPassword) {
  const targetUserId = _normalizeAccessKey_(userId);
  const password = String(plainPassword || "");
  if (!targetUserId || !password) {
    throw new Error("USER_ID y contraseña son requeridos");
  }

  const sheet = _getUsersSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    throw new Error("La hoja _USERS no tiene usuarios cargados");
  }

  const headers = data[0].map(function (h) { return String(h).trim(); });
  const userIdIdx = headers.indexOf("USER_ID");
  const passwordIdx = headers.indexOf("PASSWORD_HASH");
  if (userIdIdx === -1 || passwordIdx === -1) {
    throw new Error("La hoja _USERS no contiene USER_ID o PASSWORD_HASH");
  }

  for (var i = 1; i < data.length; i++) {
    if (_normalizeAccessKey_(data[i][userIdIdx]) === targetUserId) {
      const salt = _createPasswordSalt_();
      const passwordHash = _buildPasswordHash_(password, salt);
      sheet.getRange(i + 1, passwordIdx + 1).setValue(passwordHash);
      return { success: true, userId: targetUserId };
    }
  }

  throw new Error("No se encontró USER_ID en _USERS");
}

function bootstrapUsersDirectory() {
  const sheet = _getUsersSheet_();
  const spreadsheetId = getSpreadsheetIdForTable(DB_CONFIG.TABLES.USERS);
  const headers = DB_CONFIG.HEADERS.USERS.slice();

  Logger.log(
    "USERS directory ready. Spreadsheet ID: " +
      spreadsheetId +
      " | Sheet: " +
      DB_CONFIG.TABLES.USERS,
  );
  Logger.log("Required headers: " + headers.join(", "));
  Logger.log(
    "Before real testing, add at least one row with USER_ID, EMAIL, ROLE, PERMISSIONS (optional), STATUS=ACTIVE, and any required asset/vessel/unit scopes.",
  );
  Logger.log(
    "Usa setUserPassword('USER_ID','clave-temporal') para cargar la contraseña inicial y luego getCurrentAuthorizationDiagnostics() para validar la sesión.",
  );

  return {
    success: true,
    spreadsheetId: spreadsheetId,
    sheetName: sheet.getName(),
    headers: headers,
  };
}

function getCurrentAuthorizationDiagnostics() {
  const sessionPayload = _getActiveSessionPayload_();
  const user = getAuthenticatedUser();
  const diagnostics = {
    sessionBound: !!sessionPayload,
    sessionUserId: sessionPayload ? sessionPayload.userId : null,
    usersSheetName: DB_CONFIG.TABLES.USERS,
    usersSpreadsheetId: getSpreadsheetIdForTable(DB_CONFIG.TABLES.USERS),
    authorized: !!user,
    role: user ? user.ROLE : null,
    permissions: user ? _getUserPermissionSet_(user) : [],
    status: user ? user.STATUS : null,
    assetScopes: user ? _getUserAssignedScopes_(user).asset : [],
    vesselScopes: user ? _getUserAssignedScopes_(user).vessel : [],
    unitScopes: user ? _getUserAssignedScopes_(user).unit : [],
  };

  if (!sessionPayload) {
    diagnostics.reason = "No hay sesión autenticada por USER_ID/contraseña.";
  } else if (!user) {
    diagnostics.reason = "La sesión no corresponde a un usuario ACTIVE válido en _USERS.";
  } else {
    diagnostics.reason = "Authorized app user resolved from _USERS.";
  }

  return diagnostics;
}

function _getAuthorizationResolver_() {
  return typeof getAuthenticatedUser === "function"
    ? getAuthenticatedUser
    : null;
}

function _normalizeScopeList_(rawValues) {
  const scopes = [];

  rawValues.forEach((raw) => {
    if (raw == null || raw === "") return;
    const parts = Array.isArray(raw) ? raw : String(raw).split(/[;,|]/);
    parts.forEach((part) => {
      const normalized = _normalizeAccessKey_(part);
      if (normalized && scopes.indexOf(normalized) === -1) {
        scopes.push(normalized);
      }
    });
  });

  return scopes;
}

function _requireAuthenticatedUser_() {
  const resolver = _getAuthorizationResolver_();
  if (!resolver) {
    throw new Error("Unauthorized: authorization source not configured");
  }

  const resolvedUser = resolver();
  if (!resolvedUser) {
    throw new Error("Unauthorized: no authorized app user context");
  }

  const resolvedStatus = _normalizeAccessKey_(
    resolvedUser.STATUS || resolvedUser.status || "ACTIVE",
  );
  if (resolvedStatus && resolvedStatus !== "ACTIVE") {
    throw new Error("Forbidden: inactive user");
  }

  return {
    USER_ID: String(resolvedUser.USER_ID || resolvedUser.userId || "").trim(),
    EMAIL: String(resolvedUser.EMAIL || resolvedUser.email || "").trim(),
    ROLE: _normalizeAccessKey_(resolvedUser.ROLE || resolvedUser.role || ""),
    PERMISSIONS: String(
      resolvedUser.PERMISSIONS || resolvedUser.permissions || "",
    ).trim(),
    STATUS: resolvedStatus || "ACTIVE",
    ASSIGNED_ASSET_ID: String(
      resolvedUser.ASSIGNED_ASSET_ID || resolvedUser.assignedAssetId || "",
    ).trim(),
    ASSIGNED_ASSET_IDS:
      resolvedUser.ASSIGNED_ASSET_IDS || resolvedUser.assignedAssetIds || "",
    ASSIGNED_VESSEL: String(
      resolvedUser.ASSIGNED_VESSEL ||
        resolvedUser.assignedVessel ||
        resolvedUser.VesselName ||
        "",
    ).trim(),
    ASSIGNED_VESSELS:
      resolvedUser.ASSIGNED_VESSELS || resolvedUser.assignedVessels || "",
    ASSIGNED_UNIT_ID: String(
      resolvedUser.ASSIGNED_UNIT_ID || resolvedUser.assignedUnitId || "",
    ).trim(),
    ASSIGNED_UNIT_IDS:
      resolvedUser.ASSIGNED_UNIT_IDS || resolvedUser.assignedUnitIds || "",
  };
}

function _isAdminUser_(user) {
  return _normalizeAccessKey_(user && user.ROLE) === "ADMIN";
}

function _getUserPermissionSet_(user) {
  if (_isAdminUser_(user)) {
    return [
      "VIEW_ALL_VESSELS",
      "EDIT_ALL_VESSELS",
      "MANAGE_ALL_VESSELS",
      "MANAGE_USERS",
    ];
  }

  return _normalizeScopeList_([
    user && user.PERMISSIONS,
    user && user.permissions,
  ]);
}

function _userHasPermission_(user, permission) {
  const targetPermission = _normalizeAccessKey_(permission);
  if (!targetPermission) return false;
  return _getUserPermissionSet_(user).indexOf(targetPermission) !== -1;
}

function _isReadOnlyUser_(user) {
  const role = _normalizeAccessKey_(user && user.ROLE);
  return role === "AUDITOR" || role === "READ_ONLY" || role === "READONLY";
}

function _canViewAllScopes_(user) {
  return (
    _isAdminUser_(user) ||
    _userHasPermission_(user, "VIEW_ALL_VESSELS") ||
    _userHasPermission_(user, "EDIT_ALL_VESSELS") ||
    _userHasPermission_(user, "MANAGE_ALL_VESSELS")
  );
}

function _canWriteAllScopes_(user) {
  return (
    _isAdminUser_(user) ||
    _userHasPermission_(user, "EDIT_ALL_VESSELS") ||
    _userHasPermission_(user, "MANAGE_ALL_VESSELS")
  );
}

function _assertCanWriteTable_(user, tableName) {
  const resolvedUser = user || _requireAuthenticatedUser_();

  if (_isReadOnlyUser_(resolvedUser)) {
    throw new Error("Forbidden: read-only role cannot modify data");
  }

  if (
    tableName === DB_CONFIG.TABLES.USERS &&
    !_isAdminUser_(resolvedUser) &&
    !_userHasPermission_(resolvedUser, "MANAGE_USERS")
  ) {
    throw new Error("Forbidden: user directory access denied");
  }

  return true;
}

function _getUserAssignedScopes_(user) {
  return {
    asset: _normalizeScopeList_([
      user && user.ASSIGNED_ASSET_ID,
      user && user.ASSIGNED_ASSET_IDS,
    ]),
    vessel: _normalizeScopeList_([
      user && user.ASSIGNED_VESSEL,
      user && user.ASSIGNED_VESSELS,
    ]),
    unit: _normalizeScopeList_([
      user && user.ASSIGNED_UNIT_ID,
      user && user.ASSIGNED_UNIT_IDS,
    ]),
  };
}

function _tableUsesScopedAccess_(headersOrRows) {
  if (!headersOrRows) return false;

  let keys = [];
  if (Array.isArray(headersOrRows)) {
    if (headersOrRows.length === 0) return false;
    if (typeof headersOrRows[0] === "string") {
      keys = headersOrRows;
    } else if (headersOrRows[0] && typeof headersOrRows[0] === "object") {
      keys = Object.keys(headersOrRows[0]);
    }
  } else if (typeof headersOrRows === "object") {
    keys = Object.keys(headersOrRows);
  }

  const normalizedKeys = keys.map(_normalizeAccessKey_);
  return normalizedKeys.some(
    (key) =>
      [
        "ASSET_ID",
        "ASSETID",
        "SFI",
        "VESSELNAME",
        "EMBARCACION",
        "UNIT_ID",
        "UNIDAD",
        "UNITNAME",
      ].indexOf(key) !== -1,
  );
}

function _extractRecordScopes_(recordOrScope) {
  if (recordOrScope == null) {
    return { asset: [], vessel: [], unit: [] };
  }

  if (typeof recordOrScope !== "object" || recordOrScope instanceof Date) {
    return {
      asset: _normalizeScopeList_([recordOrScope]),
      vessel: [],
      unit: [],
    };
  }

  return {
    asset: _normalizeScopeList_([
      recordOrScope.ASSET_ID,
      recordOrScope.AssetID,
      recordOrScope.SFI,
    ]),
    vessel: _normalizeScopeList_([
      recordOrScope.VesselName,
      recordOrScope.Embarcacion,
    ]),
    unit: _normalizeScopeList_([
      recordOrScope.UNIT_ID,
      recordOrScope.UnitID,
      recordOrScope.Unidad,
      recordOrScope.UnitName,
    ]),
  };
}

function _recordHasAnyScope_(scopes) {
  return (
    (scopes.asset && scopes.asset.length > 0) ||
    (scopes.vessel && scopes.vessel.length > 0) ||
    (scopes.unit && scopes.unit.length > 0)
  );
}

function _resolveScopedPayloadValue_(currentValue, allowedScopes, fallbackValue) {
  const rawCurrent = String(currentValue || "").trim();
  if (rawCurrent) {
    const normalizedCurrent = _normalizeAccessKey_(rawCurrent);
    if (!allowedScopes || allowedScopes.length === 0 || allowedScopes.indexOf(normalizedCurrent) !== -1) {
      return rawCurrent;
    }
  }
  return String(fallbackValue || "").trim();
}

function _scopesIntersect_(left, right) {
  return left.some((value) => right.indexOf(value) !== -1);
}

function _userCanAccessScopes_(userScopes, recordScopes) {
  if (
    recordScopes.asset.length > 0 &&
    userScopes.asset.length > 0 &&
    _scopesIntersect_(userScopes.asset, recordScopes.asset)
  ) {
    return true;
  }
  if (
    recordScopes.vessel.length > 0 &&
    userScopes.vessel.length > 0 &&
    _scopesIntersect_(userScopes.vessel, recordScopes.vessel)
  ) {
    return true;
  }
  if (
    recordScopes.unit.length > 0 &&
    userScopes.unit.length > 0 &&
    _scopesIntersect_(userScopes.unit, recordScopes.unit)
  ) {
    return true;
  }
  return false;
}

function _getScopeHeaderRequirements_(headers) {
  const normalizedHeaders = {};
  (headers || []).forEach((header) => {
    normalizedHeaders[_normalizeAccessKey_(header)] = true;
  });

  return {
    normalizedHeaders: normalizedHeaders,
    needsAsset: !!(
      normalizedHeaders.ASSET_ID ||
      normalizedHeaders.ASSETID ||
      normalizedHeaders.SFI
    ),
    needsVessel: !!(
      normalizedHeaders.VESSELNAME || normalizedHeaders.EMBARCACION
    ),
    needsUnit: !!(
      normalizedHeaders.UNIT_ID ||
      normalizedHeaders.UNITID ||
      normalizedHeaders.UNIDAD ||
      normalizedHeaders.UNITNAME
    ),
  };
}

function _rowToObject_(headers, row) {
  const rowObj = {};
  headers.forEach((header, idx) => {
    rowObj[String(header).trim()] = row[idx];
  });
  return rowObj;
}

function assertAssetAccess(user, recordOrAssetId) {
  const resolvedUser = user || _requireAuthenticatedUser_();
  if (_canViewAllScopes_(resolvedUser)) return true;

  const userScopes = _getUserAssignedScopes_(resolvedUser);
  if (!_recordHasAnyScope_(userScopes)) {
    throw new Error("Forbidden: no assigned scope for current user");
  }

  const recordScopes = _extractRecordScopes_(recordOrAssetId);
  if (!_recordHasAnyScope_(recordScopes)) {
    throw new Error("Forbidden: record is missing scope for access validation");
  }

  const allowed = _userCanAccessScopes_(userScopes, recordScopes);
  if (!allowed) {
    throw new Error("Forbidden: scoped access denied");
  }

  return true;
}

function filterByAsset(user, rows) {
  const resolvedUser = user || _requireAuthenticatedUser_();
  if (!rows || rows.length === 0 || _canViewAllScopes_(resolvedUser))
    return rows || [];
  if (!_tableUsesScopedAccess_(rows)) return rows;

  const userScopes = _getUserAssignedScopes_(resolvedUser);
  if (!_recordHasAnyScope_(userScopes)) {
    throw new Error("Forbidden: no assigned scope for scoped records");
  }

  return rows.filter((row) => {
    const rowScopes = _extractRecordScopes_(row);
    return (
      _recordHasAnyScope_(rowScopes) &&
      _userCanAccessScopes_(userScopes, rowScopes)
    );
  });
}

function _forcePayloadScopeToUser_(payload, headers, user) {
  if (!payload || _isAdminUser_(user)) return;

  const userScopes = _getUserAssignedScopes_(user);
  const primaryAssetScope = String(userScopes.asset[0] || "").trim();
  const primaryVesselScope = String(userScopes.vessel[0] || "").trim();
  const primaryUnitScope = String(userScopes.unit[0] || "").trim();
  const scopeRequirements = _getScopeHeaderRequirements_(headers);
  const normalizedHeaders = scopeRequirements.normalizedHeaders;

  if (scopeRequirements.needsAsset && scopeRequirements.needsVessel) {
    if (!primaryAssetScope && !primaryVesselScope) {
      throw new Error(
        "Forbidden: no assigned asset or vessel scope for current user",
      );
    }
  } else {
    if (scopeRequirements.needsAsset && !primaryAssetScope)
      throw new Error("Forbidden: no assigned asset scope for current user");
    if (scopeRequirements.needsVessel && !primaryVesselScope)
      throw new Error("Forbidden: no assigned vessel scope for current user");
  }
  if (scopeRequirements.needsUnit && !primaryUnitScope) {
    throw new Error("Forbidden: no assigned unit scope for current user");
  }

  if (
    (payload.ASSET_ID !== undefined || normalizedHeaders.ASSET_ID) &&
    primaryAssetScope
  )
    payload.ASSET_ID = _resolveScopedPayloadValue_(payload.ASSET_ID, userScopes.asset, primaryAssetScope);
  if (
    (payload.AssetID !== undefined || normalizedHeaders.ASSETID) &&
    primaryAssetScope
  )
    payload.AssetID = _resolveScopedPayloadValue_(payload.AssetID, userScopes.asset, primaryAssetScope);
  if ((payload.SFI !== undefined || normalizedHeaders.SFI) && primaryAssetScope)
    payload.SFI = _resolveScopedPayloadValue_(payload.SFI, userScopes.asset, primaryAssetScope);
  if (
    (payload.VesselName !== undefined || normalizedHeaders.VESSELNAME) &&
    primaryVesselScope
  )
    payload.VesselName = _resolveScopedPayloadValue_(payload.VesselName, userScopes.vessel, primaryVesselScope);
  if (
    (payload.Embarcacion !== undefined || normalizedHeaders.EMBARCACION) &&
    primaryVesselScope
  )
    payload.Embarcacion = _resolveScopedPayloadValue_(payload.Embarcacion, userScopes.vessel, primaryVesselScope);
  if (
    (payload.UNIT_ID !== undefined || normalizedHeaders.UNIT_ID) &&
    primaryUnitScope
  )
    payload.UNIT_ID = _resolveScopedPayloadValue_(payload.UNIT_ID, userScopes.unit, primaryUnitScope);
  if (
    (payload.UnitID !== undefined || normalizedHeaders.UNITID) &&
    primaryUnitScope
  )
    payload.UnitID = _resolveScopedPayloadValue_(payload.UnitID, userScopes.unit, primaryUnitScope);
}

function _resolveApprovedUploadFolderId_(folderId) {
  const approvedFolderIds = {};
  [DB_CONFIG.EVIDENCE_FOLDER_ID, DB_CONFIG.CHECKLIST_FOLDER_ID, DB_CONFIG.DEFECT_PDF_FOLDER_ID].forEach(
    (id) => {
      const normalized = String(id || "").trim();
      if (normalized) approvedFolderIds[normalized] = true;
    },
  );

  const targetFolderId = String(
    folderId || DB_CONFIG.CHECKLIST_FOLDER_ID || "",
  ).trim();
  if (!targetFolderId) {
    throw new Error(
      "Upload configuration error: no approved folder configured",
    );
  }
  if (!approvedFolderIds[targetFolderId]) {
    throw new Error("Forbidden: upload target folder is not approved");
  }

  return targetFolderId;
}

function _getSsInstance(id) {
  if (_ssInstanceCache[id]) return _ssInstanceCache[id];
  _ssInstanceCache[id] = SpreadsheetApp.openById(id);
  return _ssInstanceCache[id];
}

/**
 * DETERMINA EL ID DEL SPREADSHEET SEGÚN LA TABLA
 */
function getSpreadsheetIdForTable(tableName) {
  const t = DB_CONFIG.TABLES;
  const ids = DB_CONFIG.IDS;

  if (tableName === t.USERS) return ids.FLEET_DB;
  if (tableName === t.ASSETS) return ids.INVENTORY_DB;
  if (tableName === t.SPARES || tableName === t.SPARE_ORDERS)
    return ids.SPARES_DB;
  if (tableName === t.INSPECTIONS || tableName === t.INSPECTIONS_LOG)
    return ids.INSPECTIONS_DB;
  if (tableName === t.MAINTENANCE_PLAN) return ids.MAINTENANCE_PLAN_DB;
  if (tableName === t.CERTIFICATES)
    return ids.CERTIFICATES_DB &&
      ids.CERTIFICATES_DB !== "ID_DE_LA_PLANILLA_DE_CERTIFICADOS"
      ? ids.CERTIFICATES_DB
      : ids.FLEET_DB;
  if ([t.PROVEEDORES, t.EVAL_PROVEEDORES, t.NC_PROVEEDORES].includes(tableName))
    return ids.PROVEEDORES_DB &&
      ids.PROVEEDORES_DB !== "ID_NUEVO_DOCUMENTO_PROVEEDORES"
      ? ids.PROVEEDORES_DB
      : ids.FLEET_DB;
  if ([t.RCA_LOG, t.CAPA_LOG].includes(tableName)) return ids.INSPECTIONS_DB;
  if (
    [
      t.DEFECT_LOG,
      t.WORK_ORDERS,
      t.DAILY_REPORTS,
      t.DEFERRALS,
      t.DAILY_REPORT_MAIN_ENGINES,
      t.DAILY_REPORT_AUXILIARIES,
      t.DAILY_REPORT_CONSUMPTION,
      t.DAILY_REPORT_DEFECT_EVENTS,
      t.DAILY_REPORT_MAINTENANCE_EVENTS,
      t.DAILY_REPORT_BARRIERS,
    ].includes(tableName)
  )
    return ids.FLEET_DB;

  return ids.FLEET_DB; // Por defecto usa el de Flota
}

/**
 * LECTURA GENÉRICA: Lee todos los registros de una tabla dada (Nombre de Pestaña)
 * Retorna un arreglo de objetos JSON (mapeando los encabezados de la fila 1)
 */
function readTable(tableName) {
  try {
    const user = _requireAuthenticatedUser_();
    const cachedRows = _cacheReadTable[tableName];
    if (cachedRows) return cachedRows;
    const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
    let sheet = getOrCreateSheet(ss, tableName);

    const data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 1) return []; // Estructura vacía

    const headers = data[0];
    let rows = [];

    // Mapear cada fila a un objeto JSON
    for (let i = 1; i < data.length; i++) {
      let rowObj = {};
      for (let j = 0; j < headers.length; j++) {
        rowObj[headers[j].toString().trim()] = data[i][j];
      }
      rowObj["_rowIndex"] = i + 1; // Fundamental para poder editar o eliminar la fila después
      rows.push(rowObj);
    }
    rows = filterByAsset(user, rows);
    if (!_tableUsesScopedAccess_(rows)) {
      _cacheReadTable[tableName] = rows;
    }
    return rows;
  } catch (e) {
    throw new Error(
      "No se pudo abrir la tabla '" +
        tableName +
        "'. Verifica el ID y los permisos: " +
        e.message,
    );
  }
}

/**
 * Asegura que una hoja tenga todas las cabeceras definidas en DB_CONFIG.HEADERS
 */
function ensureHeaders(sheet, tableName) {
  const ensureCacheKey = sheet.getParent().getId() + '::' + tableName;
  if (_ensuredHeadersCache[ensureCacheKey]) return;
  const expectedHeaders = _getExpectedHeadersForTable_(tableName);
  if (!expectedHeaders) return;

  const data = sheet.getDataRange().getValues();
  let actualHeaders = data[0] || [];

  if (actualHeaders.length === 0 || actualHeaders[0] === "") {
    sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .setValues([expectedHeaders]);
    sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .setFontWeight("bold")
      .setBackground("#1e293b")
      .setFontColor("white");
    _ensuredHeadersCache[ensureCacheKey] = true;
    return;
  }

  // Si faltan columnas, las agregamos al final
  let modified = false;
  expectedHeaders.forEach((h) => {
    if (actualHeaders.indexOf(h) === -1) {
      actualHeaders.push(h);
      modified = true;
    }
  });

  if (modified) {
    sheet.getRange(1, 1, 1, actualHeaders.length).setValues([actualHeaders]);
    // Solo aplicar estilos si hubo cambios, para evitar escrituras innecesarias
    sheet
      .getRange(1, 1, 1, actualHeaders.length)
      .setFontWeight("bold")
      .setBackground("#1e293b")
      .setFontColor("white");
    sheet.setFrozenRows(1);
  }
  _ensuredHeadersCache[ensureCacheKey] = true;
}

/**
 * Helper para obtener o crear una hoja, manejando fallbacks para planillas externas
 */
function getOrCreateSheet(ss, tableName) {
  let sheet = ss.getSheetByName(tableName);
  if (sheet) return sheet;

  // Intento de búsqueda exhaustiva (por si hay problemas de latencia o espacios extra)
  const sheets = ss.getSheets();
  const trimmedName = tableName.toString().trim();
  for (let s of sheets) {
    if (s.getName().trim() === trimmedName) {
      return s;
    }
  }

  // Fallback seguro para planillas externas: buscar coincidencia por headers antes de crear.
  if (
    tableName === DB_CONFIG.TABLES.MAINTENANCE_PLAN ||
    tableName === DB_CONFIG.TABLES.CERTIFICATES
  ) {
    const expectedHeaders = _getExpectedHeadersForTable_(tableName) || [];
    let bestSheet = null;
    let bestScore = 0;

    for (let i = 0; i < sheets.length; i++) {
      const candidate = sheets[i];
      const firstRow = candidate.getDataRange().getValues()[0] || [];
      const normalizedRow = firstRow.map(v => String(v || '').trim());
      let score = 0;
      expectedHeaders.forEach(header => {
        if (normalizedRow.indexOf(header) !== -1) score++;
      });
      if (score > bestScore) {
        bestScore = score;
        bestSheet = candidate;
      }
    }

    if (bestSheet && bestScore > 0) {
      return bestSheet;
    }
  }

  // Si llegamos aquí para crearla, usamos un Lock para evitar que múltiples pedidos simultáneos
  // intenten crear la misma hoja a la vez (común cuando se carga el dashboard por primera vez).
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // 15 segundos máximo
    // Volvemos a chequear ahora que tenemos el lock
    sheet = ss.getSheetByName(tableName);
    if (!sheet) {
      sheet = ss.insertSheet(tableName);
    }
    return sheet;
  } catch (e) {
    // Si falla por "Nombre duplicado" a pesar de todo, intentamos recuperarla una última vez
    sheet = ss.getSheetByName(tableName);
    if (sheet) return sheet;
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ESCRITURA GENÉRICA: Inserta un nuevo registro al final de la tabla.
 */
function createRecord(tableName, payload) {
  return createRecordsBatch(tableName, [payload]);
}

/**
 * ESCRITURA POR LOTES: Inserta múltiples registros en una sola operación.
 */
function createRecordsBatch(tableName, payloads) {
  if (!payloads || payloads.length === 0) return { success: true };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
    const sheet = getOrCreateSheet(ss, tableName);

    ensureHeaders(sheet, tableName);

    const headers = sheet.getDataRange().getValues()[0];

    const user = _requireAuthenticatedUser_();
    _assertCanWriteTable_(user, tableName);
    const scopedTable = _tableUsesScopedAccess_(headers);

    const newRows = payloads.map((payload) => {
      payload = payload || {};

      if (scopedTable && !_canWriteAllScopes_(user)) {
        const payloadScopes = _extractRecordScopes_(payload);
        if (_recordHasAnyScope_(payloadScopes)) {
          assertAssetAccess(user, payload);
        }
        _forcePayloadScopeToUser_(payload, headers, user);
      }

      // Force ASSET_ID assigned
      // Normalización de estados
      if (payload.Status && _shouldNormalizeCanonicalStatus_(tableName)) {
        payload.Status = _normalizeStatus_(payload.Status);
      }
      if (
        tableName === DB_CONFIG.TABLES.DEFECT_LOG &&
        payload.Estado_Operativo
      ) {
        const opMap = {
          ABIERTO: "FALLA",
          FALLA: "FALLA",
          "FUERA DE USO": "FALLA",
          OPERATIVO: "OPERATIVO",
          "REP.TEMP": "REP.TEMP",
          "NO-GO": "NO-GO",
        };
        const u = String(payload.Estado_Operativo).trim().toUpperCase();
        payload.Estado_Operativo = opMap[u] || u;
      }

      return headers.map((h) => {
        const headerStr = h
          .toString()
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "");
        const matchingKey = Object.keys(payload).find(
          (k) => k.toUpperCase().replace(/[^A-Z0-9]/g, "") === headerStr,
        );
        return matchingKey && payload[matchingKey] !== undefined
          ? payload[matchingKey]
          : "";
      });
    });

    const lastRow = sheet.getLastRow();
    sheet
      .getRange(lastRow + 1, 1, newRows.length, headers.length)
      .setValues(newRows);

    delete _cacheReadTable[tableName]; // Invalidar cache

    // Log Audit (solo el primero del lote por brevedad)
    if (tableName !== DB_CONFIG.TABLES.AUDIT_LOG) {
      _logAudit(
        "BATCH_CREATE",
        tableName,
        payloads.length + " records",
        "Multiple rows created",
      );
    }

    return { success: true, message: "Lote registrado en " + tableName };
  } catch (e) {
    console.error("Error en createRecordsBatch:", e);
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * DRIVE: Guarda una evidencia (base64 enviada desde el frontend) a la carpeta
 */
function uploadEvidenceToDrive(base64Data, filename, mimeType) {
  _requireAuthenticatedUser_();
  const folder = DriveApp.getFolderById(
    _resolveApprovedUploadFolderId_(DB_CONFIG.EVIDENCE_FOLDER_ID),
  );
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64Data),
    mimeType,
    filename,
  );
  const file = folder.createFile(blob);

  return file.getUrl(); // Retorna el link para guardarlo en la columna EvidenceLink de WORK_ORDERS
}

function _appendLabeledParagraph_(body, label, value) {
  const p = body.appendParagraph('');
  p.appendText(label + ': ').setBold(true);
  p.appendText(String(value || '-'));
  p.setSpacingAfter(4);
   p.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);
  return p;
}

function _appendSectionTitle_(body, title) {
  const p = body.appendParagraph(String(title || ''));
  p.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  p.setForegroundColor('#0f766e');
  p.setSpacingBefore(14);
  p.setSpacingAfter(6);
  return p;
}

function _appendBulletList_(body, values) {
  const items = Array.isArray(values) ? values : String(values || "").split(/\r?\n/);
  const filtered = items.map(function(item) {
    return String(item || "").trim();
  }).filter(Boolean);

  if (!filtered.length) {
    const emptyParagraph = body.appendParagraph('-');
    emptyParagraph.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);
    return;
  }

  filtered.forEach(function(item) {
    const match = String(item || '').match(/^\[(CONFIABILIDAD|COSTO\/STOCK|CUMPLIMIENTO)\]\s*(.*)$/i);
    const listItem = body.appendListItem('');
    if (match) {
      const axis = String(match[1] || '').toUpperCase();
      const colorMap = {
        'CONFIABILIDAD': '#0f766e',
        'COSTO/STOCK': '#c2410c',
        'CUMPLIMIENTO': '#7c3aed',
      };
      listItem.appendText('[' + axis + '] ').setBold(true).setForegroundColor(colorMap[axis] || '#0f172a');
      listItem.appendText(String(match[2] || '').trim() || '-');
    } else {
      listItem.appendText(String(item || '-'));
    }
    listItem.setSpacingAfter(2);
    listItem.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);
  });
}

function _getOrCreateSubfolder_(parentFolder, folderName) {
  const targetName = String(folderName || '').trim();
  const folders = parentFolder.getFoldersByName(targetName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(targetName);
}

function _sanitizeDriveFilename_(value) {
  return String(value || '-').trim().replace(/[\\/:*?"<>|]/g, '_');
}

function _normalizeVesselCode_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function _findVesselByName_(vesselName) {
  const target = String(vesselName || '').trim().toUpperCase();
  if (!target) return null;

  const vessels = readTable(DB_CONFIG.TABLES.VESSELS);
  return vessels.find(function(item) {
    return String(item.VesselName || '').trim().toUpperCase() === target;
  }) || null;
}

function _assertUniqueVesselCode_(payload, excludedRowIndex) {
  const code = _normalizeVesselCode_(payload && payload.Codigo_Embarcacion);
  if (!code) return;

  const vessels = readTable(DB_CONFIG.TABLES.VESSELS);
  const duplicate = vessels.find(function(item) {
    if (excludedRowIndex && item._rowIndex === excludedRowIndex) return false;
    return _normalizeVesselCode_(item.Codigo_Embarcacion) === code;
  });

  if (duplicate) {
    throw new Error('Codigo_Embarcacion duplicado: ' + code + '. Ya está asignado a ' + (duplicate.VesselName || 'otra embarcación') + '.');
  }
}

function _getRequiredVesselCodeForDefect_(vesselName) {
  const vessel = _findVesselByName_(vesselName);
  if (!vessel) {
    throw new Error('No se encontró la embarcación en FLOTA: ' + String(vesselName || '-'));
  }

  const code = _normalizeVesselCode_(vessel.Codigo_Embarcacion);
  if (!code) {
    throw new Error('La embarcación ' + (vessel.VesselName || '-') + ' no tiene Codigo_Embarcacion configurado en FLOTA.');
  }
  return code;
}

function _getNextDefectId_(payload) {
  const currentYear = new Date().getFullYear();
  const vesselCode = _getRequiredVesselCodeForDefect_(payload && payload.Embarcacion);
  const prefix = 'DEF-' + vesselCode + '-' + currentYear + '-';
  return _getNextId(DB_CONFIG.TABLES.DEFECT_LOG, prefix, 'Defecto_ID', 3);
}

function _replaceDriveFileByName_(folder, fileName, blob) {
  const targetName = String(fileName || '').trim();
  const existing = folder.getFilesByName(targetName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  return folder.createFile(blob);
}

function _createWorkOrderPdfFile_(payload, options) {
  _requireAuthenticatedUser_();
  payload = payload || {};
  options = options || {};

  const otId = String(payload.OT_ID || 'OT-SIN-ID').trim();
  const taskId = String(payload.TaskID || '-').trim();
  const vessel = String(payload.VesselName || '-').trim();
  const sfi = String(payload.AssetID || '-').trim();
  const criticidad = String(payload.Criticidad || '-').trim();
  const type = String(payload.Type || '-').trim();
  const fileBaseName = options.fileBaseName || `${otId}-${vessel}-${criticidad}-${type}`;
  const fileName = _sanitizeDriveFilename_(fileBaseName) + '.pdf';
  const rootFolder = DriveApp.getFolderById(
    _resolveApprovedUploadFolderId_(DB_CONFIG.EVIDENCE_FOLDER_ID),
  );
  const folder = _getOrCreateSubfolder_(rootFolder, 'OT');

  const doc = DocumentApp.create('TMP_' + fileName.replace(/\.pdf$/i, ''));
  const body = doc.getBody();

  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginLeft(42);
  body.setMarginRight(42);

  const title = body.appendParagraph(String(options.title || 'ORDEN DE TRABAJO'));
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setBold(true);
  title.setForegroundColor('#0f172a');
  title.setSpacingAfter(2);

  const subtitle = body.appendParagraph(String(options.subtitle || 'Documento operativo'));
  subtitle.setForegroundColor('#475569');
  subtitle.setSpacingAfter(14);

  const summaryTable = body.appendTable([
    ['OT ID', otId, 'Estado', String(payload.Status || '-')],
    ['TaskID', taskId, 'Tipo', type || '-'],
    ['Embarcacion', vessel, 'Fecha Apertura', String(payload.OpenDate || '-')],
    ['SFI / Equipo', sfi, 'Fecha Planificada', String(payload.PlannedDate || '-')],
    ['Prioridad', String(payload.Priority || '-'), 'Criticidad', criticidad || '-'],
    ['Tolerancia', String(payload.Ventana_Tolerancia || '-'), 'OT Relacionada', otId]
  ]);
  summaryTable.setBorderWidth(1);

  for (var r = 0; r < summaryTable.getNumRows(); r++) {
    for (var c = 0; c < summaryTable.getRow(r).getNumCells(); c++) {
      var cell = summaryTable.getRow(r).getCell(c);
      cell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(8).setPaddingRight(8);
      if (c % 2 === 0) {
        cell.setBackgroundColor('#e2e8f0');
        cell.editAsText().setBold(true).setForegroundColor('#0f172a');
      } else {
        cell.setBackgroundColor('#ffffff');
        cell.editAsText().setForegroundColor('#1e293b');
      }
    }
  }

  _appendSectionTitle_(body, 'Asignacion');
  _appendLabeledParagraph_(body, 'Determinado / Asignado por', payload.Asignado_Por);
  _appendLabeledParagraph_(body, 'Responsable del trabajo', payload.Responsable_Ejecutor);
  _appendLabeledParagraph_(body, 'Nombre del responsable', payload.Nombre_Responsable);
  _appendLabeledParagraph_(body, 'Quien verifica', payload.Verificador_Independiente);

  _appendSectionTitle_(body, 'Descripcion de la tarea');
  const remarks = body.appendParagraph(String(payload.Remarks || '-'));
  remarks.setForegroundColor('#1e293b');
  remarks.setSpacingAfter(10);

  if (options.includeClosureSection) {
    _appendSectionTitle_(body, 'Ejecucion y cierre');
    _appendLabeledParagraph_(body, 'Fecha cierre efectivo', payload.CompletedDate);
    _appendLabeledParagraph_(body, 'Horas cierre efectivo', payload.CompletedHours);
    _appendLabeledParagraph_(body, 'Prueba de aceptacion', payload.Resultado_Prueba);
    _appendLabeledParagraph_(body, 'Estado final del equipo', payload.Estado_Equipo_Post_OT);
    _appendLabeledParagraph_(body, 'Repuestos utilizados', payload.Repuestos_Consumidos);
  }

  _appendSectionTitle_(body, 'Control documental');
  _appendLabeledParagraph_(body, 'Generado por', _requireAuthenticatedUser_().EMAIL);
  _appendLabeledParagraph_(body, 'Fecha de emision', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm'));

  const footer = body.appendParagraph('Mercurio PMS - Documento emitido para control operativo interno.');
  footer.setForegroundColor('#64748b');
  footer.setItalic(true);
  footer.setSpacingBefore(18);

  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(fileName);
  const pdfFile = folder.createFile(pdfBlob);
  docFile.setTrashed(true);

  return {
    success: true,
    fileId: pdfFile.getId(),
    name: pdfFile.getName(),
    url: pdfFile.getUrl(),
    previewUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/preview',
  };
}

function _apiGenerateWorkOrderOpeningPdf(payload) {
  return _createWorkOrderPdfFile_(payload, {
    title: 'ORDEN DE TRABAJO - APERTURA',
    subtitle: 'Notificacion formal de asignacion y apertura',
    fileBaseName: `${payload.OT_ID || 'OT-SIN-ID'}-OP-${payload.VesselName || '-'}-${payload.Criticidad || '-'}-${payload.Type || '-'}`,
    includeClosureSection: false,
  });
}

function _apiGenerateWorkOrderClosurePdf(payload) {
  return _createWorkOrderPdfFile_(payload, {
    title: 'ORDEN DE TRABAJO - CIERRE',
    subtitle: 'Notificacion formal de ejecucion y cierre',
    fileBaseName: `${payload.OT_ID || 'OT-SIN-ID'}-CL-${payload.VesselName || '-'}-${payload.Criticidad || '-'}-${payload.Type || '-'}`,
    includeClosureSection: true,
  });
}

function _apiGenerateWorkOrderDeferralRequestPdf(payload) {
  _requireAuthenticatedUser_();
  payload = payload || {};
  const requestStatus = String(payload.Deferral_Autorizacion_Status || "").trim();
  const printableRequestStatus = requestStatus && requestStatus !== "-" ? requestStatus : "PENDIENTE";

  const otId = String(payload.OT_ID || 'OT-SIN-ID').trim();
  const vessel = String(payload.VesselName || '-').trim();
  const sfi = String(payload.AssetID || '-').trim();
  const fileName = _sanitizeDriveFilename_(`${otId}-DIF-${vessel}-${sfi}`) + '.pdf';
  const rootFolder = DriveApp.getFolderById('134HwRIadpgYzkXe6jZ3X4GGhnNQU6ton');
  const folder = _getOrCreateSubfolder_(rootFolder, 'OT');

  const doc = DocumentApp.create('TMP_' + fileName.replace(/\.pdf$/i, ''));
  const body = doc.getBody();
  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginLeft(42);
  body.setMarginRight(42);

  const title = body.appendParagraph('SOLICITUD DE DIFERIMIENTO');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setBold(true);
  title.setForegroundColor('#0f172a');
  title.setSpacingAfter(2);

  const subtitle = body.appendParagraph('Documento formal para autorización de extensión de plazo');
  subtitle.setForegroundColor('#475569');
  subtitle.setSpacingAfter(14);

  const summaryTable = body.appendTable([
    ['OT ID', otId, 'TaskID', String(payload.TaskID || '-')],
    ['Embarcación', vessel, 'SFI / Equipo', sfi],
    ['Fecha Apertura', String(payload.OpenDate || '-'), 'Fecha Objetivo Inicial', String(payload.Fecha_Vencimiento_OT || payload.PlannedDate || '-')],
    ['Nueva Fecha Solicitada', String(payload.Deferral_Fecha_Vencimiento || '-'), 'Estado Solicitud', printableRequestStatus],
    ['Nombre del autorizante', String(payload.Deferral_Aprobador || '-'), 'Criticidad', String(payload.Criticidad || '-')],
  ]);
  summaryTable.setBorderWidth(1);

  for (var r = 0; r < summaryTable.getNumRows(); r++) {
    for (var c = 0; c < summaryTable.getRow(r).getNumCells(); c++) {
      var cell = summaryTable.getRow(r).getCell(c);
      cell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(8).setPaddingRight(8);
      if (c % 2 === 0) {
        cell.setBackgroundColor('#e2e8f0');
        cell.editAsText().setBold(true).setForegroundColor('#0f172a');
      } else {
        cell.setBackgroundColor('#ffffff');
        cell.editAsText().setForegroundColor('#1e293b');
      }
    }
  }

  _appendSectionTitle_(body, 'Detalle de la OT');
  _appendLabeledParagraph_(body, 'Descripción de la tarea', payload.Remarks);
  _appendLabeledParagraph_(body, 'Tipo / Criticidad / Prioridad', `${payload.Type || '-'} | ${payload.Criticidad || '-'} | ${payload.Priority || '-'}`);

  _appendSectionTitle_(body, 'Justificación del diferimiento');
  _appendLabeledParagraph_(body, 'Razón del diferimiento', payload.Deferral_Justificacion);
  _appendLabeledParagraph_(body, 'Medidas compensatorias', payload.Deferral_Medida_Compensatoria);
  _appendLabeledParagraph_(body, 'Restricciones operativas', payload.Deferral_Restricciones);

  _appendSectionTitle_(body, 'Evaluación IA');
  _appendLabeledParagraph_(body, 'Plazo normal estimado (días)', payload.IA_Plazo_Normal_Dias);
  _appendLabeledParagraph_(body, 'Nivel de riesgo', payload.IA_Nivel_Riesgo);
  _appendLabeledParagraph_(body, 'Análisis del diferimiento', payload.IA_Justificacion_Plazo);
  _appendLabeledParagraph_(body, 'Restricción operativa recomendada', payload.IA_Restriccion_Operativa);

  _appendSectionTitle_(body, 'Autorización');
  _appendLabeledParagraph_(body, 'Resultado de autorización', printableRequestStatus);
  _appendLabeledParagraph_(body, 'Comentarios', payload.Deferral_Comentarios_Autorizacion);
  _appendLabeledParagraph_(body, 'Nombre del autorizante', payload.Deferral_Aprobador);

  _appendSectionTitle_(body, 'Control documental');
  _appendLabeledParagraph_(body, 'Generado por', _requireAuthenticatedUser_().EMAIL);
  _appendLabeledParagraph_(body, 'Fecha de emisión', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm'));

  const footer = body.appendParagraph('Mercurio PMS - Solicitud de diferimiento para autorización formal.');
  footer.setForegroundColor('#64748b');
  footer.setItalic(true);
  footer.setSpacingBefore(18);

  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(fileName);
  const pdfFile = folder.createFile(pdfBlob);
  docFile.setTrashed(true);

  return {
    success: true,
    fileId: pdfFile.getId(),
    name: pdfFile.getName(),
    url: pdfFile.getUrl(),
    previewUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/preview',
  };
}

function _apiGenerateSpareOrderRequestPdf(payload) {
  _requireAuthenticatedUser_();
  payload = payload || {};

  const orderId = String(payload.OrderID || 'ORD-SIN-ID').trim();
  const vessel = String(payload.VesselName || '-').trim();
  const sku = String(payload.SKU || '-').trim();
  const fileName = _sanitizeDriveFilename_(`${orderId}-PE-${vessel}-${sku}`) + '.pdf';
  const rootFolder = DriveApp.getFolderById('134HwRIadpgYzkXe6jZ3X4GGhnNQU6ton');
  const folder = _getOrCreateSubfolder_(rootFolder, 'ORD');

  const doc = DocumentApp.create('TMP_' + fileName.replace(/\.pdf$/i, ''));
  const body = doc.getBody();

  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginLeft(42);
  body.setMarginRight(42);

  const title = body.appendParagraph('SOLICITUD DE REPUESTO');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setBold(true);
  title.setForegroundColor('#0f172a');
  title.setSpacingAfter(2);

  const subtitle = body.appendParagraph('Documento formal de pedido de repuestos');
  subtitle.setForegroundColor('#475569');
  subtitle.setSpacingAfter(14);

  const summaryTable = body.appendTable([
    ['Order ID', orderId, 'Fecha Pedido', String(payload.Fecha_Pedido || '-')],
    ['Embarcacion Destino', vessel, 'SKU', sku],
    ['Repuesto', String(payload.Repuesto || '-'), 'Cantidad', String(payload.Cantidad || '-')],
    ['Proveedor Sugerido', String(payload.Proveedor || '-'), 'ETA', String(payload.Fecha_Estimada || '-')],
    ['Estado', String(payload.Estado || 'PENDIENTE'), 'Comentario', String(payload.Comentarios_Solicitud || '-')],
  ]);
  summaryTable.setBorderWidth(1);

  for (var r = 0; r < summaryTable.getNumRows(); r++) {
    for (var c = 0; c < summaryTable.getRow(r).getNumCells(); c++) {
      var cell = summaryTable.getRow(r).getCell(c);
      cell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(8).setPaddingRight(8);
      if (c % 2 === 0) {
        cell.setBackgroundColor('#e2e8f0');
        cell.editAsText().setBold(true).setForegroundColor('#0f172a');
      } else {
        cell.setBackgroundColor('#ffffff');
        cell.editAsText().setForegroundColor('#1e293b');
      }
    }
  }

  _appendSectionTitle_(body, 'Detalle del pedido');
  _appendLabeledParagraph_(body, 'Descripcion del repuesto', payload.Repuesto);
  _appendLabeledParagraph_(body, 'Proveedor sugerido', payload.Proveedor);
  _appendLabeledParagraph_(body, 'Cantidad solicitada', payload.Cantidad);
  _appendLabeledParagraph_(body, 'ETA estimada', payload.Fecha_Estimada);
  _appendLabeledParagraph_(body, 'Comentario del solicitante', payload.Comentarios_Solicitud);

  _appendSectionTitle_(body, 'Control documental');
  _appendLabeledParagraph_(body, 'Generado por', _requireAuthenticatedUser_().EMAIL);
  _appendLabeledParagraph_(body, 'Fecha de emision', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm'));

  const footer = body.appendParagraph('Mercurio PMS - Documento emitido para control logistico interno.');
  footer.setForegroundColor('#64748b');
  footer.setItalic(true);
  footer.setSpacingBefore(18);

  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(fileName);
  const pdfFile = folder.createFile(pdfBlob);
  docFile.setTrashed(true);

  return {
    success: true,
    fileId: pdfFile.getId(),
    name: pdfFile.getName(),
    url: pdfFile.getUrl(),
    previewUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/preview',
  };
}

function _apiGenerateSpareOrderReceiptPdf(payload) {
  _requireAuthenticatedUser_();
  payload = payload || {};

  const orderId = String(payload.OrderID || 'ORD-SIN-ID').trim();
  const vessel = String(payload.VesselName || '-').trim();
  const sku = String(payload.SKU || '-').trim();
  const fileName = _sanitizeDriveFilename_(`${orderId}-RE-${vessel}-${sku}`) + '.pdf';
  const rootFolder = DriveApp.getFolderById('134HwRIadpgYzkXe6jZ3X4GGhnNQU6ton');
  const folder = _getOrCreateSubfolder_(rootFolder, 'ORD');

  const doc = DocumentApp.create('TMP_' + fileName.replace(/\.pdf$/i, ''));
  const body = doc.getBody();

  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginLeft(42);
  body.setMarginRight(42);

  const title = body.appendParagraph('CONFIRMACION DE RECEPCION DE REPUESTO');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setBold(true);
  title.setForegroundColor('#0f172a');
  title.setSpacingAfter(2);

  const subtitle = body.appendParagraph('Documento formal de recepcion de pedido');
  subtitle.setForegroundColor('#475569');
  subtitle.setSpacingAfter(14);

  const summaryTable = body.appendTable([
    ['Order ID', orderId, 'Fecha Recepcion', String(payload.Fecha_Recepcion || '-')],
    ['Embarcacion Destino', vessel, 'SKU', sku],
    ['Repuesto', String(payload.Repuesto || '-'), 'Cantidad', String(payload.Cantidad || '-')],
    ['Proveedor', String(payload.Proveedor || '-'), 'Estado', String(payload.Estado || 'RECIBIDO')],
    ['Fecha Pedido', String(payload.Fecha_Pedido || '-'), 'ETA', String(payload.Fecha_Estimada || '-')],
  ]);
  summaryTable.setBorderWidth(1);

  for (var r = 0; r < summaryTable.getNumRows(); r++) {
    for (var c = 0; c < summaryTable.getRow(r).getNumCells(); c++) {
      var cell = summaryTable.getRow(r).getCell(c);
      cell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(8).setPaddingRight(8);
      if (c % 2 === 0) {
        cell.setBackgroundColor('#e2e8f0');
        cell.editAsText().setBold(true).setForegroundColor('#0f172a');
      } else {
        cell.setBackgroundColor('#ffffff');
        cell.editAsText().setForegroundColor('#1e293b');
      }
    }
  }

  _appendSectionTitle_(body, 'Detalle de recepcion');
  _appendLabeledParagraph_(body, 'Descripcion del repuesto', payload.Repuesto);
  _appendLabeledParagraph_(body, 'Cantidad recibida', payload.Cantidad);
  _appendLabeledParagraph_(body, 'Comentarios jefe de maquinas', payload.Comentarios_Jefe_Maquinas);

  _appendSectionTitle_(body, 'Control documental');
  _appendLabeledParagraph_(body, 'Generado por', _requireAuthenticatedUser_().EMAIL);
  _appendLabeledParagraph_(body, 'Fecha de emision', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm'));

  const footer = body.appendParagraph('Mercurio PMS - Documento emitido para control logistico interno.');
  footer.setForegroundColor('#64748b');
  footer.setItalic(true);
  footer.setSpacingBefore(18);

  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(fileName);
  const pdfFile = folder.createFile(pdfBlob);
  docFile.setTrashed(true);

  return {
    success: true,
    fileId: pdfFile.getId(),
    name: pdfFile.getName(),
    url: pdfFile.getUrl(),
    previewUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/preview',
  };
}

function _createDefectPdfFile_(payload) {
  _requireAuthenticatedUser_();
  payload = payload || {};

  const defectId = String(payload.Defecto_ID || 'DEF-SIN-ID').trim();
  const fileName = _sanitizeDriveFilename_(defectId) + '.pdf';
  const folder = DriveApp.getFolderById(
    _resolveApprovedUploadFolderId_(DB_CONFIG.DEFECT_PDF_FOLDER_ID),
  );

  const doc = DocumentApp.create('TMP_' + fileName.replace(/\.pdf$/i, ''));
  const body = doc.getBody();
  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginLeft(42);
  body.setMarginRight(42);

  const title = body.appendParagraph('REPORTE DE FALLA / DEFECTO');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setBold(true);
  title.setForegroundColor('#991b1b');
  title.setSpacingAfter(2);

  const subtitle = body.appendParagraph('Documento operativo generado desde el Registro de Fallas');
  subtitle.setForegroundColor('#475569');
  subtitle.setSpacingAfter(14);

  const summaryTable = body.appendTable([
    ['Defecto ID', defectId, 'Fecha Reporte', String(payload.Fecha_Reporte || '-')],
    ['Embarcacion', String(payload.Embarcacion || '-'), 'SFI / Equipo', String(payload.SFI || '-')],
    ['Clasificacion', String(payload.Clasificacion_Falla || '-'), 'Estado Operativo', String(payload.Estado_Operativo || '-')],
    ['Responsable Correccion', String(payload.Responsable_Correccion || '-'), 'Fecha Objetivo', String(payload.Fecha_Vencimiento || '-')],
    ['OT Asociada', String(payload.OT_Asociada || '-'), 'RCA ID', String(payload.RCA_ID || '-')],
  ]);
  summaryTable.setBorderWidth(1);

  for (var r = 0; r < summaryTable.getNumRows(); r++) {
    for (var c = 0; c < summaryTable.getRow(r).getNumCells(); c++) {
      var cell = summaryTable.getRow(r).getCell(c);
      cell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(8).setPaddingRight(8);
      if (c % 2 === 0) {
        cell.setBackgroundColor('#fee2e2');
        cell.editAsText().setBold(true).setForegroundColor('#7f1d1d');
      } else {
        cell.setBackgroundColor('#ffffff');
        cell.editAsText().setForegroundColor('#1e293b');
      }
    }
  }

  _appendSectionTitle_(body, 'Descripcion del evento');
  _appendLabeledParagraph_(body, 'Sintoma / falla observada', payload.Descripcion_Sintoma);
  _appendLabeledParagraph_(body, 'Accion inmediata mitigatoria', payload.Accion_Inmediata);
  _appendLabeledParagraph_(body, 'Medida compensatoria', payload.Medida_Compensatoria);

  _appendSectionTitle_(body, 'Seguimiento y control');
  _appendLabeledParagraph_(body, 'TaskID asociado', payload.TaskID);
  _appendLabeledParagraph_(body, 'Estado del registro', payload.Status);
  _appendLabeledParagraph_(body, 'Evidencias / links', payload.Evidencia_Files);

  _appendSectionTitle_(body, 'Control documental');
  _appendLabeledParagraph_(body, 'Generado por', _requireAuthenticatedUser_().EMAIL);
  _appendLabeledParagraph_(body, 'Fecha de emision', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm'));

  const footer = body.appendParagraph('Mercurio PMS - Registro formal de falla para trazabilidad operativa y documental.');
  footer.setForegroundColor('#64748b');
  footer.setItalic(true);
  footer.setSpacingBefore(18);

  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(fileName);
  const pdfFile = _replaceDriveFileByName_(folder, fileName, pdfBlob);
  docFile.setTrashed(true);

  return {
    success: true,
    fileId: pdfFile.getId(),
    name: pdfFile.getName(),
    url: pdfFile.getUrl(),
    previewUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/preview',
  };
}

function _apiGenerateDefectPdf(rowIndex, payload) {
  _requireAuthenticatedUser_();
  if (rowIndex == null || rowIndex === '') {
    return { success: false, message: 'Guarda primero el defecto antes de generar el PDF.' };
  }

  const targetRowIndex = Number(rowIndex);
  if (!targetRowIndex) {
    return { success: false, message: 'RowIndex inválido para emitir el PDF del defecto.' };
  }

  const defects = readTable(DB_CONFIG.TABLES.DEFECT_LOG);
  const existing = defects.find(function(item) {
    return item._rowIndex === targetRowIndex;
  });

  if (!existing) {
    return { success: false, message: 'No se encontró el defecto a partir del rowIndex informado.' };
  }

  const mergedPayload = Object.assign({}, existing, payload || {});
  mergedPayload.Defecto_ID = String(mergedPayload.Defecto_ID || existing.Defecto_ID || '').trim();
  if (!mergedPayload.Defecto_ID) {
    return { success: false, message: 'El defecto no tiene Defecto_ID válido para emitir PDF.' };
  }

  const pdfResult = _createDefectPdfFile_(mergedPayload);
  if (!pdfResult || !pdfResult.success) return pdfResult;

  const updateResult = updateRecord(DB_CONFIG.TABLES.DEFECT_LOG, targetRowIndex, {
    Link_PDF: pdfResult.url,
  });
  if (!updateResult.success) {
    return { success: false, message: updateResult.message || 'No se pudo actualizar el Link_PDF del defecto.' };
  }

  return {
    success: true,
    url: pdfResult.url,
    previewUrl: pdfResult.previewUrl,
    name: pdfResult.name,
  };
}

/**
 * INTERNAL: Logs an action to the AUDIT_LOG table
 */
function _logAudit(action, table, recordId, details) {
  try {
    const payload = {
      Timestamp: new Date(),
      User: _requireAuthenticatedUser_().EMAIL,
      Action: action,
      Table: table,
      RecordID: recordId,
      Details: details,
    };
    const ss = _getSsInstance(DB_CONFIG.IDS.FLEET_DB);
    const sheet = getOrCreateSheet(ss, DB_CONFIG.TABLES.AUDIT_LOG);
    ensureHeaders(sheet, DB_CONFIG.TABLES.AUDIT_LOG);

    const headers = sheet.getDataRange().getValues()[0];
    const newRow = headers.map((h) => payload[h.toString().trim()] || "");
    sheet.appendRow(newRow);
  } catch (e) {
    console.error("Critical error in _logAudit:", e);
  }
}

/**
 * INTERNAL: Logs a stock movement to the STOCK_MOVEMENTS table
 */
function _logStockMovement(vessel, sku, type, qty, balance, ref) {
  try {
    const payload = {
      Timestamp: new Date(),
      User: _requireAuthenticatedUser_().EMAIL,
      VesselName: vessel,
      SKU: sku,
      Type: type,
      Quantity: qty,
      Balance: balance,
      Reference: ref,
    };
    const ss = _getSsInstance(DB_CONFIG.IDS.SPARES_DB);
    const sheet = getOrCreateSheet(ss, DB_CONFIG.TABLES.STOCK_MOVEMENTS);
    ensureHeaders(sheet, DB_CONFIG.TABLES.STOCK_MOVEMENTS);

    const headers = sheet.getDataRange().getValues()[0];
    const newRow = headers.map((h) => payload[h.toString().trim()] || "");
    sheet.appendRow(newRow);
  } catch (e) {
    console.error("Error in _logStockMovement:", e);
  }
}

// -------------------------------------------------------------
// UTILIDADES SERVER-SIDE
// -------------------------------------------------------------

/**
 * parseDateServer_ - Parsea fechas en formatos dd-mm-yyyy, yyyy-mm-dd o ISO.
 * Versión server-side equivalente a parseDateManual() del cliente.
 * Requerida en DB.js porque las funciones del servidor no tienen acceso
 * al DOM ni a funciones definidas en Script.html.
 */
function parseDateServer_(dateInput) {
  if (!dateInput) return null;
  if (dateInput instanceof Date) return dateInput;
  const s = String(dateInput).trim();
  if (!s || s === "-") return null;

  // Formato dd-mm-yyyy
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy)
    return new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));

  // Formato yyyy-mm-dd
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd)
    return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));

  // Intentar parseo nativo
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * _normalizeStatus_ - Normaliza estados legacy (español o alternativos) a inglés canónico.
 * Garantiza compatibilidad retroactiva 100% en toda la lógica del backend.
 */
function _normalizeStatus_(raw) {
  if (!raw) return "";
  const map = {
    ABIERTO: "OPEN",
    ABIERTA: "OPEN",
    OPEN: "OPEN",
    CERRADO: "CLOSED",
    CERRADA: "CLOSED",
    CLOSED: "CLOSED",
    CONCLUIDA: "CLOSED",
    CONCLUIDO: "CLOSED",
    EJECUTADA: "CLOSED",
    PENDIENTE: "DEFERRED",
    DIFERIDO: "DEFERRED",
    DEFERRED: "DEFERRED",
    PLANIFICADA: "PLANNED",
    PLANIFICADO: "PLANNED",
    PLANNED: "PLANNED",
    "EN PROCESO": "IN_PROGRESS",
    IN_PROGRESS: "IN_PROGRESS",
    "EN REPARACION": "IN_REPAIR",
    "EN REPARACIÓN": "IN_REPAIR",
    IN_REPAIR: "IN_REPAIR",
    "ESPERANDO REPUESTOS": "WAITING_SPARES",
    WAITING_SPARES: "WAITING_SPARES",
    "ESPERANDO PROVEEDOR": "WAITING_VENDOR",
    WAITING_VENDOR: "WAITING_VENDOR",
    "PENDIENTE VERIFICACION": "PENDING_VERIFICATION",
    PENDING_VERIFICATION: "PENDING_VERIFICATION",
    SOLICITADO: "REQUESTED",
    REQUESTED: "REQUESTED",
    APROBADO: "APPROVED",
    APPROVED: "APPROVED",
    ACTIVO: "ACTIVE",
    ACTIVE: "ACTIVE",
    VENCIDO: "EXPIRED",
    EXPIRED: "EXPIRED",
    RECHAZADO: "REJECTED",
    REJECTED: "REJECTED",
    CANCELADO: "CANCELLED",
    CANCELADA: "CANCELLED",
    CANCELLED: "CANCELLED",
  };
  const upper = String(raw).trim().toUpperCase();
  return map[upper] || upper;
}

function _shouldNormalizeCanonicalStatus_(tableName) {
  return tableName !== DB_CONFIG.TABLES.MAINTENANCE_PLAN;
}

function _applyWorkOrderDeferralAuthorization_(payload) {
  payload = payload || {};

  const requiresDeferral = String(payload.Deferral_Required || "No").trim() === "Sí";
  if (!requiresDeferral) return payload;

  if (!String(payload.Deferral_Permite_Operacion || "").trim()) {
    payload.Deferral_Permite_Operacion = "Sí";
  }
  if (!String(payload.Deferral_Declarado_NoGo || "").trim()) {
    payload.Deferral_Declarado_NoGo = "No";
  }

  const authStatus = String(payload.Deferral_Autorizacion_Status || "").trim().toUpperCase();
  if (authStatus === "AUTORIZADO" && String(payload.Deferral_Fecha_Vencimiento || "").trim()) {
    payload.Status = "DEFERRED";
    payload.Fecha_Vencimiento_OT = payload.Deferral_Fecha_Vencimiento;
  }

  return payload;
}

function _validateDeferralAuthorizationPayload_(payload) {
  payload = payload || {};
  const status = _normalizeStatus_(payload.Status || "");

  if (status !== "APPROVED" && status !== "REJECTED") {
    return { ok: true };
  }
  if (!String(payload.Aprobador || "").trim()) {
    return {
      ok: false,
      message: "PROC-MAN-03: Debe indicarse el nombre del autorizante para registrar una aprobación o rechazo.",
    };
  }
  if (status === "REJECTED" && !String(payload.Comentarios_Autorizacion || "").trim()) {
    return {
      ok: false,
      message: "PROC-MAN-03: Debe registrarse el comentario del autorizante cuando el diferimiento es rechazado.",
    };
  }

  return { ok: true };
}

// -------------------------------------------------------------
// APIs llamadas desde el FrontEnd (Script.html)
// -------------------------------------------------------------

function _apiGetVessels() {
  return readTable(DB_CONFIG.TABLES.VESSELS);
}

function _apiCreateVessel(payload) {
  payload = payload || {};
  if (payload.Codigo_Embarcacion !== undefined) payload.Codigo_Embarcacion = _normalizeVesselCode_(payload.Codigo_Embarcacion);
  _assertUniqueVesselCode_(payload, null);
  return createRecord(DB_CONFIG.TABLES.VESSELS, payload);
}

/**
 * EDICIÓN GENÉRICA: Actualiza una fila existente por su _rowIndex.
 * Hardening: Implementa "Normalización Real de Storage".
 */
function updateRecord(tableName, rowIndex, payload) {
  payload = payload || {};

  // Normalización de estados antes de guardar (Storage Consistency)
  if (payload.Status && _shouldNormalizeCanonicalStatus_(tableName)) {
    payload.Status = _normalizeStatus_(payload.Status);
  }
  if (tableName === DB_CONFIG.TABLES.DEFECT_LOG && payload.Estado_Operativo) {
    const opMap = {
      ABIERTO: "FALLA",
      FALLA: "FALLA",
      "FUERA DE USO": "FALLA",
      OPERATIVO: "OPERATIVO",
      "REP.TEMP": "REP.TEMP",
      "NO-GO": "NO-GO",
    };
    const u = String(payload.Estado_Operativo).trim().toUpperCase();
    payload.Estado_Operativo = opMap[u] || u;
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
    const sheet = getOrCreateSheet(ss, tableName);
    ensureHeaders(sheet, tableName);
    const dataRange = sheet.getDataRange().getValues();
    const headers = dataRange[0];
    const existingRow = dataRange[rowIndex - 1];

    if (!existingRow)
      return { success: false, message: "No se encontró el registro" };

    const user = _requireAuthenticatedUser_();
    _assertCanWriteTable_(user, tableName);
    if (_tableUsesScopedAccess_(headers)) {
      if (!_canWriteAllScopes_(user)) {
        assertAssetAccess(user, _rowToObject_(headers, existingRow));
        _forcePayloadScopeToUser_(payload, headers, user);
      }
    }

    const updatedRow = headers.map((h, idx) => {
      const headerStr = h
        .toString()
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const matchingKey = Object.keys(payload).find(
        (k) => k.toUpperCase().replace(/[^A-Z0-9]/g, "") === headerStr,
      );
      return matchingKey && payload[matchingKey] !== undefined
        ? payload[matchingKey]
        : existingRow[idx];
    });

    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedRow]);
    delete _cacheReadTable[tableName]; // Invalidar cache tras escritura

    // Log Audit
    if (tableName !== DB_CONFIG.TABLES.AUDIT_LOG) {
      _logAudit(
        "UPDATE",
        tableName,
        payload[Object.keys(payload)[0]] || rowIndex,
        JSON.stringify(payload),
      );
    }

    return { success: true, message: "Registro actualizado exitosamente" };
  } catch (e) {
    console.error("Error en updateRecord:", e);
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * BUSCA EL MÁXIMO ID CORRELATIVO Y RETORNA EL SIGUIENTE
 */
function _getNextId(tableName, prefix, idColumn, length = 5) {
  const data = readTable(tableName);
  if (!data || data.length === 0) return prefix + "1".padStart(length, "0");

  let maxId = 0;
  data.forEach((row) => {
    const val = row[idColumn];
    if (val) {
      const num = parseInt(val.toString().replace(prefix, ""), 10);
      if (!isNaN(num) && num > maxId) maxId = num;
    }
  });

  return prefix + (maxId + 1).toString().padStart(length, "0");
}

/**
 * CÁLCULO DE SIGUIENTE VENCIMIENTO POR FECHA
 * Hardening: Ahora usa parseDateServer_ para evitar fallos por formato dd-mm-yyyy vs Date object.
 */
function _calcNextMaintenanceDate(completedDate, freqMeses) {
  const date = parseDateServer_(completedDate);
  if (!date || !freqMeses || freqMeses <= 0) return null;

  const nextDate = new Date(
    date.getFullYear(),
    date.getMonth() + freqMeses,
    date.getDate(),
  );

  const ny = nextDate.getFullYear();
  const nm = String(nextDate.getMonth() + 1).padStart(2, "0");
  const nd = String(nextDate.getDate()).padStart(2, "0");

  return `${nd}-${nm}-${ny}`;
}

function _isTaskOverdueServer_(plannedDateStr, toleranceDays) {
  if (!plannedDateStr) return false;
  const plannedDate = parseDateServer_(plannedDateStr);
  if (!plannedDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const limitDate = new Date(plannedDate);
  limitDate.setDate(limitDate.getDate() + (parseInt(toleranceDays, 10) || 0));
  limitDate.setHours(0, 0, 0, 0);

  return today > limitDate;
}

function _normalizeMaintenancePlanStatus_(raw) {
  const upper = String(raw || "").trim().toUpperCase();
  if (upper === "IN_PROGRESS" || upper === "EN PROCESO") return "EN PROCESO";
  if (upper === "VENCIDA") return "VENCIDA";
  return "VALIDO";
}

function _normalizeWorkOrderVisibleStatus_(raw) {
  const upper = String(raw || "").trim().toUpperCase();
  const spanishMap = {
    "DEF PEND.": "PENDIENTE DE DIFERIMIENTO",
    "PEND. VERIFICACION": "PENDIENTE DE VERIFICACION",
    "PEND. VERIFICACIÓN": "PENDIENTE DE VERIFICACION",
    "VENCIDA": "VENCIDA",
    "ABIERTA": "ABIERTA",
    "PLANIFICADA": "PLANIFICADA",
    "DIFERIDA": "DIFERIDA",
    "PENDIENTE DE DIFERIMIENTO": "PENDIENTE DE DIFERIMIENTO",
    "EN PROCESO": "EN PROCESO",
    "EN ESPERA": "EN ESPERA",
    "PENDIENTE DE VERIFICACION": "PENDIENTE DE VERIFICACION",
    "CERRADA": "CERRADA",
    "CANCELADA": "CANCELADA",
    "EN REPARACION": "EN REPARACION",
    "EN REPARACIÓN": "EN REPARACION",
  };
  if (spanishMap[upper]) return spanishMap[upper];

  const canonical = _normalizeStatus_(raw);
  const canonicalMap = {
    OPEN: "ABIERTA",
    PLANNED: "PLANIFICADA",
    IN_PROGRESS: "EN PROCESO",
    IN_REPAIR: "EN REPARACION",
    DEFERRED: "DIFERIDA",
    CLOSED: "CERRADA",
    CANCELLED: "CANCELADA",
    WAITING_SPARES: "EN ESPERA",
    WAITING_VENDOR: "EN ESPERA",
    PENDING_VERIFICATION: "PENDIENTE DE VERIFICACION",
  };
  return canonicalMap[canonical] || upper;
}

function _calculateWarningDays_(startDateValue, endDateValue, defaultDays) {
  const defaultValue = parseInt(defaultDays, 10) || 0;
  const startDate = parseDateServer_(startDateValue);
  const endDate = parseDateServer_(endDateValue);
  if (!startDate || !endDate) return defaultValue;
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000);
  if (totalDays <= 0) return defaultValue;
  return Math.max(1, Math.ceil(totalDays * 0.20));
}

function _normalizeInspectionVisibleStatus_(raw) {
  const upper = String(raw || "").trim().toUpperCase();
  if (upper === "PROX.VENC") return "PROXIMO VENCIMIENTO";
  if (["VALIDO", "PROXIMO VENCIMIENTO", "VENCIDA"].indexOf(upper) !== -1) return upper;
  return "VALIDO";
}

function _resolveInspectionVisibleStatus_(item) {
  const nextDate = parseDateServer_(item.Siguiente_Fecha);
  if (!nextDate) return "VALIDO";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  nextDate.setHours(0, 0, 0, 0);

  if (String(item.Frecuencia || "").trim().toUpperCase() === "OCASIONAL") {
    return String(item.Status || "").trim().toUpperCase() === "FALLIDA" ? "VENCIDA" : "VALIDO";
  }

  const warningDays = _calculateWarningDays_(item.Ultima_Fecha, item.Siguiente_Fecha, 7);
  const diffDays = Math.ceil((nextDate.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "VENCIDA";
  if (diffDays <= warningDays) return "PROXIMO VENCIMIENTO";
  return "VALIDO";
}

function _calcNextInspectionDate_(lastExecutionDateValue, frecuenciaValue) {
  const date = parseDateServer_(lastExecutionDateValue);
  if (!date) return "";

  const freq = String(frecuenciaValue || "").trim().toUpperCase();
  if (!freq || freq === "OCASIONAL") return "";

  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (freq === "DIARIA") next.setDate(next.getDate() + 1);
  else if (freq === "SEMANAL") next.setDate(next.getDate() + 7);
  else if (freq === "QUINCENAL") next.setDate(next.getDate() + 15);
  else if (freq === "MENSUAL") next.setMonth(next.getMonth() + 1);
  else if (freq === "TRIMESTRAL") next.setMonth(next.getMonth() + 3);
  else if (freq === "SEMESTRAL") next.setMonth(next.getMonth() + 6);
  else if (freq === "ANUAL") next.setFullYear(next.getFullYear() + 1);

  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, "0");
  const nd = String(next.getDate()).padStart(2, "0");
  return `${nd}-${nm}-${ny}`;
}

function _resolveInspectionFreqNumbers_(frecuenciaValue) {
  const freqKey = String(frecuenciaValue || "").trim().toUpperCase();
  const result = { freqS: "", freqM: "" };
  if (freqKey === "SEMANAL") result.freqS = "1";
  else if (freqKey === "QUINCENAL") result.freqS = "2";
  else if (freqKey === "MENSUAL") result.freqM = "1";
  else if (freqKey === "TRIMESTRAL") result.freqM = "3";
  else if (freqKey === "SEMESTRAL") result.freqM = "6";
  else if (freqKey === "ANUAL") result.freqM = "12";
  return result;
}

function _normalizeCertificateVisibleStatus_(raw) {
  const upper = String(raw || "").trim().toUpperCase();
  if (["VALIDO", "PROXIMO VENCIMIENTO", "VENCIDO", "CANCELADO", "INACTIVO"].indexOf(upper) !== -1) return upper;
  return upper || "VALIDO";
}

function _resolveCertificateVisibleStatus_(item) {
  const rawStatus = String(item.Status || "").trim().toUpperCase();
  if (rawStatus === "CANCELADO" || rawStatus === "INACTIVO") return rawStatus;

  const issueDate = parseDateServer_(item.Fecha_Emision);
  const expiryDate = parseDateServer_(item.Fecha_Vencimiento);
  const today = new Date();
  if (!expiryDate) return "VALIDO";

  const warningDays = _calculateWarningDays_(issueDate, expiryDate, 30);
  const diffDays = Math.ceil((expiryDate.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "VENCIDO";
  if (diffDays <= warningDays) return "PROXIMO VENCIMIENTO";
  return "VALIDO";
}

function _normalizeDeferralVisibleStatus_(raw) {
  const upper = String(raw || "").trim().toUpperCase();
  const map = {
    REQUESTED: "SOLICITADO",
    APPROVED: "APROBADO",
    ACTIVE: "ACTIVO",
    EXPIRED: "VENCIDO",
    CLOSED: "CERRADO",
    REJECTED: "RECHAZADO",
    SOLICITADO: "SOLICITADO",
    APROBADO: "APROBADO",
    ACTIVO: "ACTIVO",
    VENCIDO: "VENCIDO",
    CERRADO: "CERRADO",
    RECHAZADO: "RECHAZADO",
  };
  return map[upper] || upper;
}

function _resolveDeferralVisibleStatus_(item) {
  const normalizedStatus = _normalizeStatus_(item.Status || "REQUESTED");
  if (normalizedStatus === "CLOSED") return "CERRADO";
  if (normalizedStatus === "REJECTED") return "RECHAZADO";
  if (normalizedStatus === "APPROVED") return "APROBADO";
  if (normalizedStatus === "REQUESTED") return "SOLICITADO";

  const expiryDate = parseDateServer_(item.Fecha_Vencimiento);
  if (expiryDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiryDate.setHours(0, 0, 0, 0);
    if (today > expiryDate) return "VENCIDO";
  }

  if (normalizedStatus === "ACTIVE") return "ACTIVO";
  if (normalizedStatus === "EXPIRED") return "VENCIDO";
  return _normalizeDeferralVisibleStatus_(item.Estado_Visible || normalizedStatus);
}

function _getDailyHoursIndexInternal_() {
  const rows = readTable(DB_CONFIG.TABLES.DAILY_REPORTS) || [];
  const machinePrefixes = ["MP1", "MP2", "MP3", "MP4", "MG1", "MG2", "MG3", "MG4"];
  const latestHoursByVessel = {};
  const latestHoursBySFI = {};

  rows.forEach(function (row) {
    const vessel = String(row.VesselName || row.Embarcacion || "").trim().toUpperCase();
    if (!vessel) return;

    const date = String(row.Date || row.Fecha || "2000-01-01").trim() || "2000-01-01";
    const time = String(row.Time || row.Hora || "00:00").trim() || "00:00";
    const stamp = new Date(`${date}T${time}`);
    const validStamp = isNaN(stamp.getTime()) ? new Date("2000-01-01T00:00") : stamp;

    const totalHours = machinePrefixes.reduce(function (sum, prefix) {
      return sum + (parseFloat(row[`${prefix}_Current_Hours`]) || 0);
    }, 0);

    if (!latestHoursByVessel[vessel] || validStamp > new Date(latestHoursByVessel[vessel].stamp)) {
      latestHoursByVessel[vessel] = { hours: totalHours, stamp: validStamp.toISOString() };
    }

    machinePrefixes.forEach(function (prefix) {
      const sfi = String(row[`${prefix}_SFI`] || "").trim().toUpperCase();
      if (!sfi) return;
      const hours = parseFloat(row[`${prefix}_Current_Hours`]) || 0;
      const key = `${vessel}_${sfi}`;
      if (!latestHoursBySFI[key] || validStamp > new Date(latestHoursBySFI[key].stamp)) {
        latestHoursBySFI[key] = { hours: hours, stamp: validStamp.toISOString() };
      }
    });
  });

  return { latestHoursByVessel: latestHoursByVessel, latestHoursBySFI: latestHoursBySFI };
}

function _getMaintenanceActualHours_(task, dailyHoursIndex) {
  const vesselKey = String(task.VesselName || task.Embarcacion || "").trim().toUpperCase();
  const sfiKey = String(task.SFI || task.AssetID || "").trim().toUpperCase();
  const latestHoursByVessel = (dailyHoursIndex && dailyHoursIndex.latestHoursByVessel) || {};
  const latestHoursBySFI = (dailyHoursIndex && dailyHoursIndex.latestHoursBySFI) || {};
  const key = `${vesselKey}_${sfiKey}`;

  if (latestHoursBySFI[key]) return latestHoursBySFI[key].hours;
  if (!sfiKey && latestHoursByVessel[vesselKey]) return latestHoursByVessel[vesselKey].hours;
  return 0;
}

function _hasOpenWorkOrderForMaintenanceTask_(task, workOrders) {
  const taskId = String(task.TaskID || "").trim().toUpperCase();
  const vesselName = String(task.VesselName || task.Embarcacion || "").trim().toUpperCase();
  const sfi = _normalizeSfiMatchKey_(task.SFI || task.AssetID || "");

  return (workOrders || []).find(function (ot) {
    const normalizedStatus = _normalizeStatus_(ot.Status || "");
    if (["CLOSED", "CANCELLED"].includes(normalizedStatus)) return false;

    const otTaskId = String(ot.TaskID || "").trim().toUpperCase();
    if (taskId && otTaskId) return otTaskId === taskId;

    return String(ot.VesselName || "").trim().toUpperCase() === vesselName &&
      _normalizeSfiMatchKey_(ot.AssetID || "") === sfi;
  }) || null;
}

function _resolveMaintenancePlanStatus_(task, workOrders, dailyHoursIndex) {
  const openWorkOrder = _hasOpenWorkOrderForMaintenanceTask_(task, workOrders);
  if (openWorkOrder) return "EN PROCESO";

  const nextHours = parseFloat(task.Siguiente_Vencimiento_HS);
  const currentHours = _getMaintenanceActualHours_(task, dailyHoursIndex);
  const overdueByHours = !isNaN(nextHours) && nextHours > 0 && currentHours >= nextHours;
  const overdueByDate = _isTaskOverdueServer_(task.Siguiente_Vencimiento_Fecha, 0);

  if (overdueByHours || overdueByDate) return "VENCIDA";
  return "VALIDO";
}

function _isPreventiveWorkOrderType_(value) {
  const type = String(value || "").trim().toUpperCase();
  if (!type) return false;
  return type === "PREVENTIVA" || type === "PREVENTIVE" || type.indexOf("PREVENT") === 0 || type.indexOf("PREV") === 0;
}

function _getAffectedMaintenanceTaskIdsForWorkOrder_(workOrder, planRows) {
  if (!workOrder) return [];
  const rows = planRows || readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN) || [];
  const normalizedTaskId = String(workOrder.TaskID || "").trim().toUpperCase();
  const normalizedVessel = String(workOrder.VesselName || "").trim().toUpperCase();
  const normalizedSfi = _normalizeSfiMatchKey_(workOrder.AssetID || workOrder.SFI || "");

  const ids = rows.filter(function (task) {
    const taskTaskId = String(task.TaskID || "").trim().toUpperCase();
    if (normalizedTaskId && taskTaskId) return taskTaskId === normalizedTaskId;
    return String(task.VesselName || task.Embarcacion || "").trim().toUpperCase() === normalizedVessel &&
      _normalizeSfiMatchKey_(task.SFI || task.AssetID || "") === normalizedSfi;
  }).map(function (task) {
    return String(task.TaskID || "").trim().toUpperCase();
  }).filter(Boolean);

  return Array.from(new Set(ids));
}

function _resolveWorkOrderVisibleStatus_(workOrder) {
  const normalizedStatus = _normalizeStatus_(workOrder.Status || "OPEN");
  const authStatus = String(workOrder.Deferral_Autorizacion_Status || "").trim().toUpperCase();
  const requiresDeferral = String(workOrder.Deferral_Required || "No").trim() === "Sí";
  const dueDate = String(workOrder.Fecha_Vencimiento_OT || workOrder.PlannedDate || "").trim();
  const tolerance = String(workOrder.Fecha_Vencimiento_OT || "").trim() ? 0 : (workOrder.Ventana_Tolerancia || 0);

  if (!["CLOSED", "CANCELLED"].includes(normalizedStatus)) {
    if (normalizedStatus === "DEFERRED" || authStatus === "AUTORIZADO") return "DIFERIDA";
    if (requiresDeferral && authStatus === "PENDIENTE") return "PENDIENTE DE DIFERIMIENTO";
    if (_isTaskOverdueServer_(dueDate, tolerance)) return "VENCIDA";
  }

  const statusMap = {
    OPEN: "ABIERTA",
    PLANNED: "PLANIFICADA",
    IN_PROGRESS: "EN PROCESO",
    IN_REPAIR: "EN REPARACION",
    WAITING_SPARES: "EN ESPERA",
    WAITING_VENDOR: "EN ESPERA",
    PENDING_VERIFICATION: "PENDIENTE DE VERIFICACION",
    CLOSED: "CERRADA",
    CANCELLED: "CANCELADA",
    DEFERRED: "DIFERIDA",
  };

  return statusMap[normalizedStatus] || _normalizeWorkOrderVisibleStatus_(workOrder.Estado_Visible || normalizedStatus);
}

function _writeTableColumnUpdates_(tableName, columnName, updatesByRowIndex) {
  const rowIndexes = Object.keys(updatesByRowIndex || {}).map(function (value) {
    return parseInt(value, 10);
  }).filter(function (value) {
    return !isNaN(value) && value > 1;
  });
  if (!rowIndexes.length) return { success: true, updated: 0 };

  const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);
  const headers = sheet.getDataRange().getValues()[0] || [];
  const columnIndex = headers.indexOf(columnName);
  if (columnIndex === -1) {
    return { success: false, updated: 0, message: `No se encontró la columna ${columnName} en ${tableName}` };
  }

  rowIndexes.forEach(function (rowIndex) {
    sheet.getRange(rowIndex, columnIndex + 1).setValue(updatesByRowIndex[rowIndex]);
  });

  delete _cacheReadTable[tableName];
  return { success: true, updated: rowIndexes.length };
}

function _syncMaintenancePlanStatuses_(taskIds) {
  const planRows = readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN) || [];
  const openWorkOrders = readTable(DB_CONFIG.TABLES.WORK_ORDERS) || [];
  const dailyHoursIndex = _getDailyHoursIndexInternal_();
  const targetTaskIds = Array.isArray(taskIds) && taskIds.length
    ? taskIds.map(function (taskId) { return String(taskId || "").trim().toUpperCase(); })
    : null;

  const updates = {};
  planRows.forEach(function (task) {
    const normalizedTaskId = String(task.TaskID || "").trim().toUpperCase();
    if (targetTaskIds && targetTaskIds.indexOf(normalizedTaskId) === -1) return;

    const nextStatus = _resolveMaintenancePlanStatus_(task, openWorkOrders, dailyHoursIndex);
    if (_normalizeMaintenancePlanStatus_(task.Status) !== nextStatus) {
      updates[task._rowIndex] = nextStatus;
      task.Status = nextStatus;
    }
  });

  if (!_isReadOnlyUser_(_requireAuthenticatedUser_()) && Object.keys(updates).length) {
    _writeTableColumnUpdates_(DB_CONFIG.TABLES.MAINTENANCE_PLAN, "Status", updates);
  }

  return planRows;
}

function _syncMaintenancePlanOpenOtIds_(taskIds, planRows, workOrders) {
  const rows = planRows || readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN) || [];
  const openWorkOrders = workOrders || readTable(DB_CONFIG.TABLES.WORK_ORDERS) || [];
  const targetTaskIds = Array.isArray(taskIds) && taskIds.length
    ? taskIds.map(function (taskId) { return String(taskId || "").trim().toUpperCase(); })
    : null;

  const updates = {};
  rows.forEach(function (task) {
    const normalizedTaskId = String(task.TaskID || "").trim().toUpperCase();
    if (targetTaskIds && targetTaskIds.indexOf(normalizedTaskId) === -1) return;

    // Elegir OT abierta más reciente (mayor OT_ID) para evitar depender del orden en hoja.
    const taskId = String(task.TaskID || "").trim().toUpperCase();
    const vesselName = String(task.VesselName || task.Embarcacion || "").trim().toUpperCase();
    const sfi = _normalizeSfiMatchKey_(task.SFI || task.AssetID || "");
    let bestOpenOtId = "";

    (openWorkOrders || []).forEach(function (ot) {
      const normalizedStatus = _normalizeStatus_(ot.Status || "");
      if (["CLOSED", "CANCELLED"].includes(normalizedStatus)) return;

      const otTaskId = String(ot.TaskID || "").trim().toUpperCase();
      const matchesByTaskId = taskId && otTaskId ? otTaskId === taskId : false;
      const matchesByVesselSfi = !matchesByTaskId &&
        String(ot.VesselName || "").trim().toUpperCase() === vesselName &&
        _normalizeSfiMatchKey_(ot.AssetID || "") === sfi;

      // Solo vincular por Vessel+SFI si la OT es preventiva; por TaskID sí se permite.
      if (!matchesByTaskId && !(matchesByVesselSfi && _isPreventiveWorkOrderType_(ot.Type))) return;

      const candidateOtId = String(ot.OT_ID || "").trim();
      if (candidateOtId && (!bestOpenOtId || candidateOtId.localeCompare(bestOpenOtId) > 0)) {
        bestOpenOtId = candidateOtId;
      }
    });

    const nextOtId = bestOpenOtId;
    const currentOtId = String(task.OT_ID || "").trim();

    if (currentOtId !== nextOtId) {
      updates[task._rowIndex] = nextOtId;
      task.OT_ID = nextOtId;
    }
  });

  if (!_isReadOnlyUser_(_requireAuthenticatedUser_()) && Object.keys(updates).length) {
    const writeResult = _writeTableColumnUpdates_(DB_CONFIG.TABLES.MAINTENANCE_PLAN, "OT_ID", updates);
    // Mantener compatibilidad (retorna array) pero expone métrica para funciones de sync.
    rows._otIdSyncUpdated = writeResult && writeResult.updated ? writeResult.updated : 0;
  } else {
    rows._otIdSyncUpdated = 0;
  }

  return rows;
}

function _syncWorkOrderVisibleStatuses_(rowIndexes) {
  const workOrders = readTable(DB_CONFIG.TABLES.WORK_ORDERS) || [];
  const targetRows = Array.isArray(rowIndexes) && rowIndexes.length
    ? rowIndexes.map(function (rowIndex) { return parseInt(rowIndex, 10); }).filter(function (rowIndex) { return !isNaN(rowIndex); })
    : null;

  const updates = {};
  workOrders.forEach(function (workOrder) {
    if (targetRows && targetRows.indexOf(workOrder._rowIndex) === -1) return;

    const nextVisibleStatus = _resolveWorkOrderVisibleStatus_(workOrder);
    if (_normalizeWorkOrderVisibleStatus_(workOrder.Estado_Visible) !== nextVisibleStatus) {
      updates[workOrder._rowIndex] = nextVisibleStatus;
      workOrder.Estado_Visible = nextVisibleStatus;
    }
  });

  if (!_isReadOnlyUser_(_requireAuthenticatedUser_()) && Object.keys(updates).length) {
    _writeTableColumnUpdates_(DB_CONFIG.TABLES.WORK_ORDERS, "Estado_Visible", updates);
  }

  return workOrders;
}

function _syncInspectionVisibleStatuses_(rowIndexes) {
  const inspections = readTable(DB_CONFIG.TABLES.INSPECTIONS) || [];
  const targetRows = Array.isArray(rowIndexes) && rowIndexes.length
    ? rowIndexes.map(function (rowIndex) { return parseInt(rowIndex, 10); }).filter(function (rowIndex) { return !isNaN(rowIndex); })
    : null;

  const updates = {};
  inspections.forEach(function (inspection) {
    if (targetRows && targetRows.indexOf(inspection._rowIndex) === -1) return;
    const nextVisibleStatus = _resolveInspectionVisibleStatus_(inspection);
    if (_normalizeInspectionVisibleStatus_(inspection.Estado_Visible) !== nextVisibleStatus) {
      updates[inspection._rowIndex] = nextVisibleStatus;
      inspection.Estado_Visible = nextVisibleStatus;
    }
  });

  if (!_isReadOnlyUser_(_requireAuthenticatedUser_()) && Object.keys(updates).length) {
    _writeTableColumnUpdates_(DB_CONFIG.TABLES.INSPECTIONS, "Estado_Visible", updates);
  }

  return inspections;
}

function _syncCertificateVisibleStatuses_(rowIndexes) {
  const certificates = readTable(DB_CONFIG.TABLES.CERTIFICATES) || [];
  const targetRows = Array.isArray(rowIndexes) && rowIndexes.length
    ? rowIndexes.map(function (rowIndex) { return parseInt(rowIndex, 10); }).filter(function (rowIndex) { return !isNaN(rowIndex); })
    : null;

  const updates = {};
  certificates.forEach(function (certificate) {
    if (targetRows && targetRows.indexOf(certificate._rowIndex) === -1) return;
    const nextVisibleStatus = _resolveCertificateVisibleStatus_(certificate);
    if (_normalizeCertificateVisibleStatus_(certificate.Estado_Visible) !== nextVisibleStatus) {
      updates[certificate._rowIndex] = nextVisibleStatus;
      certificate.Estado_Visible = nextVisibleStatus;
    }
  });

  if (!_isReadOnlyUser_(_requireAuthenticatedUser_()) && Object.keys(updates).length) {
    _writeTableColumnUpdates_(DB_CONFIG.TABLES.CERTIFICATES, "Estado_Visible", updates);
  }

  return certificates;
}

function _syncDeferralVisibleStatuses_(rowIndexes) {
  const deferrals = readTable(DB_CONFIG.TABLES.DEFERRALS) || [];
  const targetRows = Array.isArray(rowIndexes) && rowIndexes.length
    ? rowIndexes.map(function (rowIndex) { return parseInt(rowIndex, 10); }).filter(function (rowIndex) { return !isNaN(rowIndex); })
    : null;

  const updates = {};
  deferrals.forEach(function (deferral) {
    if (targetRows && targetRows.indexOf(deferral._rowIndex) === -1) return;
    const nextVisibleStatus = _resolveDeferralVisibleStatus_(deferral);
    if (_normalizeDeferralVisibleStatus_(deferral.Estado_Visible) !== nextVisibleStatus) {
      updates[deferral._rowIndex] = nextVisibleStatus;
      deferral.Estado_Visible = nextVisibleStatus;
    }
  });

  if (!_isReadOnlyUser_(_requireAuthenticatedUser_()) && Object.keys(updates).length) {
    _writeTableColumnUpdates_(DB_CONFIG.TABLES.DEFERRALS, "Estado_Visible", updates);
  }

  return deferrals;
}

function _syncMaintenancePlanForWorkOrder_(workOrder, extraTaskIds) {
  const planRows = readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN) || [];
  const taskIds = _getAffectedMaintenanceTaskIdsForWorkOrder_(workOrder, planRows)
    .concat((extraTaskIds || []).map(function (taskId) {
      return String(taskId || "").trim().toUpperCase();
    }).filter(Boolean));

  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean);

  const isPreventive = String(workOrder && workOrder.Type || "").trim().toUpperCase() === "PREVENTIVA";
  const matchesMaintenanceTaskId = !!(workOrder && workOrder.TaskID) && planRows.some(function (t) {
    return String(t.TaskID || "").trim().toUpperCase() === String(workOrder.TaskID || "").trim().toUpperCase();
  });

  // Mantener OT_ID en el Plan Maestro solo para OTs del Plan (preventivas o vinculadas por TaskID).
  // Esto evita contaminar MAINTENANCE_PLAN con OTs correctivas generadas desde otros módulos (p.ej. inspecciones).
  if (isPreventive || matchesMaintenanceTaskId) {
    _syncMaintenancePlanOpenOtIds_(uniqueTaskIds, planRows, null);
  }
  return _syncMaintenancePlanStatuses_(uniqueTaskIds);
}

function _apiUpdateVessel(rowIndex, payload) {
  payload = payload || {};
  if (payload.Codigo_Embarcacion !== undefined) payload.Codigo_Embarcacion = _normalizeVesselCode_(payload.Codigo_Embarcacion);
  _assertUniqueVesselCode_(payload, rowIndex);
  return updateRecord(DB_CONFIG.TABLES.VESSELS, rowIndex, payload);
}

// --- INVENTORY (ASSETS) ---
function _buildDefectStatusIndex_(defects) {
  const index = {
    openStatusByAsset: {},
    historyByAsset: {},
    historyBySfi: {},
  };

  (defects || []).forEach(function (defect) {
    const normalizedSfi = _normalizeSfiMatchKey_(defect.SFI);
    if (!normalizedSfi) return;

    const normalizedVessel = _normalizeComparableValue_(defect.Embarcacion || defect.VesselName);
    const assetKey = `${normalizedVessel}||${normalizedSfi}`;
    index.historyByAsset[assetKey] = true;
    index.historyBySfi[normalizedSfi] = true;

    const defectStatus = _normalizeStatus_(defect.Status);
    if (["CLOSED", "REJECTED", "CANCELLED"].includes(defectStatus)) return;

    const candidate = _normalizeAssetStatusFromOperationalState_(defect.Estado_Operativo);
    if (!candidate) return;

    if (candidate === "FALLA" || !index.openStatusByAsset[assetKey]) {
      index.openStatusByAsset[assetKey] = candidate;
    }
  });

  return index;
}

function _getAssetStatusFromLinkedDefects_(vesselName, sfi, defectIndex) {
  const normalizedSfi = _normalizeSfiMatchKey_(sfi);
  const normalizedVessel = _normalizeComparableValue_(vesselName);
  if (!normalizedSfi) return "";

  const index = defectIndex || _buildDefectStatusIndex_(readTable(DB_CONFIG.TABLES.DEFECT_LOG) || []);
  const assetKey = `${normalizedVessel}||${normalizedSfi}`;
  return index.openStatusByAsset[assetKey] || "";
}

function _hasLinkedDefectHistory_(vesselName, sfi, defectIndex) {
  const normalizedSfi = _normalizeSfiMatchKey_(sfi);
  const normalizedVessel = _normalizeComparableValue_(vesselName);
  if (!normalizedSfi) return false;

  const index = defectIndex || _buildDefectStatusIndex_(readTable(DB_CONFIG.TABLES.DEFECT_LOG) || []);
  if (normalizedVessel) {
    return !!index.historyByAsset[`${normalizedVessel}||${normalizedSfi}`];
  }
  return !!index.historyBySfi[normalizedSfi];
}

function _resolveInventoryStatusForAsset_(vesselName, sfi, fallbackOperationalState, currentAssetStatus, defectIndex) {
  const openDefectStatus = _getAssetStatusFromLinkedDefects_(vesselName, sfi, defectIndex);
  if (openDefectStatus) return openDefectStatus;

  const normalizedCurrentStatus = _normalizeComparableValue_(currentAssetStatus);
  if (_hasLinkedDefectHistory_(vesselName, sfi, defectIndex) && ["FALLA", "REP.TEMP"].includes(normalizedCurrentStatus)) {
    return "OPERATIVO";
  }

  return _normalizeAssetStatusFromOperationalState_(fallbackOperationalState);
}

function _reconcileInventoryStatusesFromDefects_() {
  const assets = readTable(DB_CONFIG.TABLES.ASSETS) || [];
  const defectIndex = _buildDefectStatusIndex_(readTable(DB_CONFIG.TABLES.DEFECT_LOG) || []);
  return assets.map(function (asset) {
    const hydratedAsset = Object.assign({}, asset);
    const derivedStatus = _resolveInventoryStatusForAsset_(asset.VesselName, asset.SFI, "", asset.Status, defectIndex);
    if (derivedStatus) hydratedAsset.Status = derivedStatus;
    return hydratedAsset;
  });
}

function _apiGetInventory() {
  return _reconcileInventoryStatusesFromDefects_();
}

function _apiCreateInventory(payload) {
  return createRecord(DB_CONFIG.TABLES.ASSETS, payload);
}

function _apiUpdateInventory(rowIndex, payload) {
  return updateRecord(DB_CONFIG.TABLES.ASSETS, rowIndex, payload);
}

// --- SPARES ---
function _apiGetSpares() {
  return readTable(DB_CONFIG.TABLES.SPARES);
}

function _assertUniqueSpareSku_(sku, excludedRowIndex) {
  const normalizedSku = String(sku || "").trim().toUpperCase();
  if (!normalizedSku) return;

  const rows = readTable(DB_CONFIG.TABLES.SPARES) || [];
  const duplicate = rows.find(function (row) {
    return row._rowIndex !== excludedRowIndex &&
      String(row.SKU || "").trim().toUpperCase() === normalizedSku;
  });

  if (duplicate) {
    throw new Error("SKU duplicado en Repuestos Críticos: " + normalizedSku);
  }
}

function _apiCreateSpare(payload) {
  _assertUniqueSpareSku_(payload && payload.SKU);
  payload.Status = _computeSpareStatus_(payload.Stock_Actual, payload.MIN);
  return createRecord(DB_CONFIG.TABLES.SPARES, payload);
}

function _apiUpdateSpare(rowIndex, payload) {
  _assertUniqueSpareSku_(payload && payload.SKU, rowIndex);
  if (payload.Stock_Actual !== undefined || payload.MIN !== undefined) {
    payload.Status = _computeSpareStatus_(payload.Stock_Actual, payload.MIN);
  }
  return updateRecord(DB_CONFIG.TABLES.SPARES, rowIndex, payload);
}

/**
 * Registra el consumo de repuestos y actualiza el stock en REG-MAN-11-01 (SPARES)
 * @param {Array} usageList - [{ sku: string, quantity: number }]
 */
function _apiConsumeSpares(usageList) {
  if (!usageList || !usageList.length) return { success: true };

  try {
    _assertCanWriteTable_(_requireAuthenticatedUser_(), DB_CONFIG.TABLES.SPARES);
    const spares = readTable(DB_CONFIG.TABLES.SPARES);
    const ss = _getSsInstance(DB_CONFIG.IDS.SPARES_DB);
    const sheet = getOrCreateSheet(ss, DB_CONFIG.TABLES.SPARES);

    const headers = DB_CONFIG.HEADERS.SPARES;
    const stockIdx = headers.indexOf("Stock_Actual") + 1;
    const statusIdx = headers.indexOf("Status") + 1;

    if (stockIdx <= 0 || statusIdx <= 0) {
      return {
        success: false,
        message: "No se encontraron las columnas de Stock o Status en SPARES.",
      };
    }

    // Leemos las columnas completas para actualizar en memoria
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: true };

    const rangeStock = sheet.getRange(1, stockIdx, lastRow, 1);
    const rangeStatus = sheet.getRange(1, statusIdx, lastRow, 1);
    const valuesStock = rangeStock.getValues();
    const valuesStatus = rangeStatus.getValues();

    let modified = false;
    for (const item of usageList) {
      const spare = spares.find(
        (s) => s.SKU === item.sku && s.VesselName === item.vessel,
      );
      if (!spare) continue;

      const rowIndexZeroBased = spare._rowIndex - 1;
      let currentStock = parseFloat(spare.Stock_Actual) || 0;
      let newStock = Math.max(
        0,
        currentStock - (parseFloat(item.quantity) || 0),
      );

      const min = parseFloat(spare.MIN) || 0;
      let newStatus = _computeSpareStatus_(newStock, min);

      valuesStock[rowIndexZeroBased][0] = newStock;
      valuesStatus[rowIndexZeroBased][0] = newStatus;
      modified = true;

      // Log Movement
      _logStockMovement(
        item.vessel,
        item.sku,
        "CONSUMO",
        -item.quantity,
        newStock,
        "Consumo por OT",
      );
    }

    if (modified) {
      rangeStock.setValues(valuesStock);
      rangeStatus.setValues(valuesStatus);
      delete _cacheReadTable[DB_CONFIG.TABLES.SPARES]; // Invalidar cache
    }

    return { success: true };
  } catch (e) {
    console.error("Error en apiConsumeSpares:", e);
    return { success: false, message: e.message };
  }
}

// --- INSPECTIONS ---
function _apiGetInspections() {
  return readTable(DB_CONFIG.TABLES.INSPECTIONS);
}

function _buildInspectionTaskId_(sfi, indexNumber) {
  const normalizedSfi = String(sfi || "INS").trim() || "INS";
  return `${normalizedSfi}-PI${String(indexNumber || 1).padStart(2, "0")}`;
}

function _findRecordByColumnValue_(tableName, columnName, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) return null;

  const rows = readTable(tableName) || [];
  return rows.find(function (row) {
    return String(row[columnName] || "").trim().toUpperCase() === normalizedValue.toUpperCase();
  }) || null;
}

function _resolveKnownTaskId_(taskId) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return "";

  const inspectionTask = _findRecordByColumnValue_(DB_CONFIG.TABLES.INSPECTIONS, "TaskID", normalizedTaskId);
  if (inspectionTask) return String(inspectionTask.TaskID || "").trim();

  const maintenanceTask = _findRecordByColumnValue_(DB_CONFIG.TABLES.MAINTENANCE_PLAN, "TaskID", normalizedTaskId);
  if (maintenanceTask) return String(maintenanceTask.TaskID || "").trim();

  return "";
}

function _resolveTaskIdFromWorkOrder_(otId) {
  const workOrder = _findRecordByColumnValue_(DB_CONFIG.TABLES.WORK_ORDERS, "OT_ID", otId);
  return workOrder ? String(workOrder.TaskID || "").trim() : "";
}

function _assertUniqueInspectionTaskId_(taskId, excludedRowIndex) {
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return;

  const tableName = DB_CONFIG.TABLES.INSPECTIONS;
  const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);
  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0] || [];
  const taskIdIdx = headers.indexOf("TaskID");
  if (taskIdIdx === -1) return;

  for (let i = 1; i < data.length; i++) {
    const rowIndex = i + 1;
    if (excludedRowIndex && rowIndex === excludedRowIndex) continue;
    const currentTaskId = String(data[i][taskIdIdx] || "").trim();
    if (currentTaskId && currentTaskId.toUpperCase() === normalizedTaskId.toUpperCase()) {
      throw new Error("TaskID duplicado en INSPECTIONS: " + normalizedTaskId);
    }
  }
}

function _normalizeWorkOrderTaskId_(payload, existingRow) {
  const existingTaskId = String((existingRow && existingRow.TaskID) || "").trim();
  if (existingTaskId) return existingTaskId;
  return _resolveKnownTaskId_(payload && payload.TaskID);
}

function _normalizeInspectionLogTaskId_(payload) {
  if (payload && payload.OT_Asociada) {
    const otTaskId = _resolveTaskIdFromWorkOrder_(payload.OT_Asociada);
    if (otTaskId) return otTaskId;
  }
  return _resolveKnownTaskId_(payload && payload.TaskID);
}

function _normalizeDefectTaskId_(payload, existingRow) {
  if (payload && payload.OT_Asociada) {
    const otTaskId = _resolveTaskIdFromWorkOrder_(payload.OT_Asociada);
    if (otTaskId) return otTaskId;
  }

  const existingTaskId = String((existingRow && existingRow.TaskID) || "").trim();
  if (existingTaskId) return existingTaskId;

  return _resolveKnownTaskId_(payload && payload.TaskID);
}

function _getNextInspectionTaskId_(sfi, excludedRowIndex) {
  const normalizedSfi = String(sfi || "INS").trim() || "INS";
  const tableName = DB_CONFIG.TABLES.INSPECTIONS;
  const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);
  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0] || [];
  const taskIdIdx = headers.indexOf("TaskID");
  const sfiIdx = headers.indexOf("SFI");
  let maxIndex = 0;

  for (let i = 1; i < data.length; i++) {
    const rowIndex = i + 1;
    if (excludedRowIndex && rowIndex === excludedRowIndex) continue;
    const rowSfi = String((sfiIdx >= 0 ? data[i][sfiIdx] : "") || "").trim();
    if (rowSfi.toUpperCase() !== normalizedSfi.toUpperCase()) continue;

    const currentTaskId = String((taskIdIdx >= 0 ? data[i][taskIdIdx] : "") || "").trim();
    const match = currentTaskId.match(/-PI(\d+)$/i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > maxIndex) maxIndex = parsed;
    }
  }

  return _buildInspectionTaskId_(normalizedSfi, maxIndex + 1);
}

function _ensureInspectionTaskIdInPayload_(payload, existingRowIndex) {
  payload = payload || {};
  if (String(payload.TaskID || "").trim()) return payload;

  const sfi = String(payload.SFI || "").trim();
  if (!sfi) return payload;

  payload.TaskID = _getNextInspectionTaskId_(sfi, existingRowIndex);
  return payload;
}

function _apiSyncInspectionIDs() {
  const tableName = DB_CONFIG.TABLES.INSPECTIONS;
  const ss = SpreadsheetApp.openById(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);

  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const colTaskID = headers.indexOf("TaskID");
  const colSFI = headers.indexOf("SFI");
  if (colTaskID === -1 || colSFI === -1) {
    return { success: false, message: "Columnas TaskID/SFI no encontradas en INSPECTIONS" };
  }

  const sfiCounters = {};
  for (let i = 1; i < data.length; i++) {
    const sfi = String(data[i][colSFI] || "INS").trim() || "INS";
    if (!sfiCounters[sfi]) sfiCounters[sfi] = 0;
    sfiCounters[sfi]++;

    const currentId = String(data[i][colTaskID] || "").trim();
    if (!currentId) {
      sheet.getRange(i + 1, colTaskID + 1).setValue(_buildInspectionTaskId_(sfi, sfiCounters[sfi]));
    }
  }

  return { success: true, message: "TaskID de INSPECTIONS sincronizados." };
}

function _apiCreateInspection(payload) {
  payload = payload || {};
  delete payload.TaskID;
  payload = _ensureInspectionTaskIdInPayload_(payload);
  _assertUniqueInspectionTaskId_(payload.TaskID);

  const freqNumbers = _resolveInspectionFreqNumbers_(payload.Frecuencia);
  payload.FREQS = freqNumbers.freqS;
  payload.FREQM = freqNumbers.freqM;

  // Si se define Ultima_Fecha, actualizar automáticamente Siguiente_Fecha según Frecuencia.
  if (payload.Ultima_Fecha && !String(payload.Siguiente_Fecha || "").trim()) {
    payload.Siguiente_Fecha = _calcNextInspectionDate_(payload.Ultima_Fecha, payload.Frecuencia);
  }

  payload.Estado_Visible = _resolveInspectionVisibleStatus_(payload);
  const result = createRecord(DB_CONFIG.TABLES.INSPECTIONS, payload);
  if (result && result.success) _syncInspectionVisibleStatuses_(null);
  return result;
}

function _apiUpdateInspection(rowIndex, payload) {
  payload = payload || {};
  const current = readTable(DB_CONFIG.TABLES.INSPECTIONS).find(function (row) {
    return row._rowIndex === rowIndex;
  });
  delete payload.TaskID;
  if (current && String(current.TaskID || "").trim()) {
    payload.TaskID = current.TaskID;
  } else {
    _ensureInspectionTaskIdInPayload_(payload, rowIndex);
  }
  _assertUniqueInspectionTaskId_(payload.TaskID, rowIndex);

  const mergedForFreq = Object.assign({}, current || {}, payload);
  if (payload.Frecuencia !== undefined || payload.FREQS !== undefined || payload.FREQM !== undefined) {
    const freqNumbers = _resolveInspectionFreqNumbers_(mergedForFreq.Frecuencia);
    payload.FREQS = freqNumbers.freqS;
    payload.FREQM = freqNumbers.freqM;
  }

  // Si se actualiza Ultima_Fecha o Frecuencia, recalcular Siguiente_Fecha en base a la frecuencia definida.
  if (payload.Ultima_Fecha !== undefined || payload.Frecuencia !== undefined) {
    const merged = Object.assign({}, current || {}, payload);
    if (merged.Ultima_Fecha) {
      payload.Siguiente_Fecha = _calcNextInspectionDate_(merged.Ultima_Fecha, merged.Frecuencia);
    } else if (payload.Ultima_Fecha !== undefined) {
      // Si el usuario limpió Ultima_Fecha, limpiar la siguiente también.
      payload.Siguiente_Fecha = "";
    }
  }

  payload.Estado_Visible = _resolveInspectionVisibleStatus_(Object.assign({}, current || {}, payload));
  const result = updateRecord(DB_CONFIG.TABLES.INSPECTIONS, rowIndex, payload);
  if (result && result.success) _syncInspectionVisibleStatuses_([rowIndex]);
  return result;
}

// --- INSPECTIONS LOG ---
function _apiGetInspectionsLog() {
  const vesselFilter = String(arguments[0] || "").trim().toUpperCase();
  const limit = Math.max(1, Math.min(parseInt(arguments[1], 10) || 200, 1000));
  const offset = Math.max(0, parseInt(arguments[2], 10) || 0);
  const user = _requireAuthenticatedUser_();
  const tableName = DB_CONFIG.TABLES.INSPECTIONS_LOG;
  const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) {
    return { rows: [], hasMore: false, nextOffset: offset };
  }

  const headers = data[0] || [];
  const vesselIdx = headers.indexOf("VesselName");
  const rows = [];
  let skipped = 0;
  let hasMore = false;

  for (let i = data.length - 1; i >= 1; i--) {
    if (vesselFilter && vesselIdx >= 0) {
      const rowVessel = String(data[i][vesselIdx] || "").trim().toUpperCase();
      if (rowVessel !== vesselFilter) continue;
    }

    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[String(headers[j] || "").trim()] = data[i][j];
    }
    rowObj._rowIndex = i + 1;

    if (!filterByAsset(user, [rowObj]).length) continue;

    if (skipped < offset) {
      skipped++;
      continue;
    }

    if (rows.length >= limit) {
      hasMore = true;
      break;
    }

    rows.push(rowObj);
  }

  return {
    rows: rows,
    hasMore: hasMore,
    nextOffset: offset + rows.length,
  };
}

function _apiFindLatestInspectionLogByTaskId(taskId) {
  const normalizedTaskId = String(taskId || "").trim().toUpperCase();
  if (!normalizedTaskId) return null;

  const user = _requireAuthenticatedUser_();
  const tableName = DB_CONFIG.TABLES.INSPECTIONS_LOG;
  const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) return null;

  const headers = data[0] || [];
  const taskIdIdx = headers.indexOf("TaskID");
  if (taskIdIdx === -1) return null;

  for (let i = data.length - 1; i >= 1; i--) {
    const currentTaskId = String(data[i][taskIdIdx] || "").trim().toUpperCase();
    if (currentTaskId !== normalizedTaskId) continue;

    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[String(headers[j] || "").trim()] = data[i][j];
    }
    rowObj._rowIndex = i + 1;

    if (filterByAsset(user, [rowObj]).length) return rowObj;
  }

  return null;
}

function _apiCreateInspectionLog(payload) {
  payload = payload || {};
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `PI-${year}-${month}-`;

  payload.PI_ID = _getNextId(
    DB_CONFIG.TABLES.INSPECTIONS_LOG,
    prefix,
    "PI_ID",
    4,
  );
  payload.TaskID = _normalizeInspectionLogTaskId_(payload);
  return createRecord(DB_CONFIG.TABLES.INSPECTIONS_LOG, payload);
}

function _apiGetMaintenancePlan() {
  return readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN);
}

// Backfill/repair: recalcula MAINTENANCE_PLAN.OT_ID en base a OTs abiertas actuales.
function _apiSyncMaintenancePlanOtIds(taskIds) {
  const user = _requireAuthenticatedUser_();
  _assertCanWriteTable_(user, DB_CONFIG.TABLES.MAINTENANCE_PLAN);

  let normalizedTaskIds = null;
  if (Array.isArray(taskIds) && taskIds.length) {
    normalizedTaskIds = taskIds;
  } else if (typeof taskIds === "string" && String(taskIds).trim()) {
    normalizedTaskIds = [taskIds];
  }

  const planRows = readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN) || [];
  const workOrders = readTable(DB_CONFIG.TABLES.WORK_ORDERS) || [];
  const resultRows = _syncMaintenancePlanOpenOtIds_(normalizedTaskIds, planRows, workOrders);
  const updated = resultRows && typeof resultRows._otIdSyncUpdated === "number" ? resultRows._otIdSyncUpdated : 0;
  return {
    success: true,
    updated: updated,
    message: `OT_ID sincronizado en MAINTENANCE_PLAN. Registros actualizados: ${updated}`,
  };
}

/**
 * Genera IDs únicos para tareas de mantenimiento que no tengan uno.
 * Formato: SFI-TXX (ej: 810.01-T01)
 */
function _apiSyncMaintenanceIDs() {
  const tableName = DB_CONFIG.TABLES.MAINTENANCE_PLAN;
  const ss = SpreadsheetApp.openById(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colTaskID = headers.indexOf("TaskID");
  const colSFI = headers.indexOf("SFI");

  if (colTaskID === -1 || colSFI === -1)
    return { success: false, message: "Columnas no encontradas" };

  const sfiCounters = {};
  const updates = [];

  for (let i = 1; i < data.length; i++) {
    let sfi = data[i][colSFI] || "N/A";
    let currentID = data[i][colTaskID];

    if (!sfiCounters[sfi]) sfiCounters[sfi] = 0;
    sfiCounters[sfi]++;

    let expectedID = `${sfi}-T${String(sfiCounters[sfi]).padStart(2, "0")}`;

    // Si no tiene ID o es incorrecto, lo actualizamos
    if (!currentID || currentID === "-" || currentID === "") {
      sheet.getRange(i + 1, colTaskID + 1).setValue(expectedID);
    }
  }

  return {
    success: true,
    message: "IDs del Plan de Mantenimiento sincronizados.",
  };
}

function _apiCreateMaintenancePlan(payload) {
  const result = createRecord(DB_CONFIG.TABLES.MAINTENANCE_PLAN, payload);
  if (result && result.success) {
    const taskId = payload && payload.TaskID;
    _syncMaintenancePlanStatuses_(taskId ? [taskId] : null);
  }
  return result;
}

function _apiUpdateMaintenancePlan(rowIndex, payload) {
  const result = updateRecord(DB_CONFIG.TABLES.MAINTENANCE_PLAN, rowIndex, payload);
  if (result && result.success) {
    const taskId = payload && payload.TaskID;
    _syncMaintenancePlanStatuses_(taskId ? [taskId] : null);
  }
  return result;
}

function _apiGetWorkOrders() {
  return readTable(DB_CONFIG.TABLES.WORK_ORDERS);
}

function _apiGetWorkOrdersPlanIndex() {
  const tableName = DB_CONFIG.TABLES.WORK_ORDERS;
  const user = _requireAuthenticatedUser_();
  const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
  const sheet = getOrCreateSheet(ss, tableName);
  ensureHeaders(sheet, tableName);

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) return [];

  const headers = data[0] || [];
  const columns = ["OT_ID", "TaskID", "Status", "VesselName", "AssetID"];
  const columnIndexes = {};
  columns.forEach(function(name) {
    columnIndexes[name] = headers.indexOf(name);
  });

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const rowObj = {};
    columns.forEach(function(name) {
      const idx = columnIndexes[name];
      rowObj[name] = idx >= 0 ? data[i][idx] : "";
    });
    rowObj._rowIndex = i + 1;

    if (!filterByAsset(user, [rowObj]).length) continue;
    if (_normalizeStatus_(rowObj.Status) === "CLOSED") continue;

    rows.push(rowObj);
  }

  return rows;
}

function _apiCreateWorkOrder(payload) {
  payload = payload || {};
  _applyWorkOrderDeferralAuthorization_(payload);
  payload.OT_ID = _getNextId(DB_CONFIG.TABLES.WORK_ORDERS, "OT-", "OT_ID", 5);
  payload.TaskID = _normalizeWorkOrderTaskId_(payload, null);

  const assets = readTable(DB_CONFIG.TABLES.ASSETS);

  // Heredar Criticidad desde el Inventario (ASSETS)
  if (payload.AssetID && (!payload.Criticidad || payload.Criticidad === "")) {
    const asset = assets.find((a) => a.SFI === payload.AssetID);
    if (asset) {
      let crit = (asset.Criticidad || "C").toUpperCase();
      payload.Criticidad = crit.includes("A")
        ? "A"
        : crit.includes("B")
          ? "B"
          : "C";
    } else {
      payload.Criticidad = "C";
    }
  }

  payload.Status = _normalizeStatus_(payload.Status || "PLANNED");
  const normalizedStatus = payload.Status;
  payload.Estado_Visible = _resolveWorkOrderVisibleStatus_(payload);

  if (payload.Repuestos_Consumidos) {
    let usageList = [];
    try {
      usageList =
        typeof payload.Repuestos_Consumidos === "string"
          ? JSON.parse(payload.Repuestos_Consumidos)
          : payload.Repuestos_Consumidos;
    } catch (e) {
      console.error("Error al parsear repuestos:", e);
    }
    if (usageList && usageList.length > 0) apiConsumeSpares(usageList);
  }

  const result = createRecord(DB_CONFIG.TABLES.WORK_ORDERS, payload);
  if (!result.success) return result;
  result.OT_ID = payload.OT_ID;
  const createdWorkOrder = readTable(DB_CONFIG.TABLES.WORK_ORDERS).find(function (row) {
    return String(row.OT_ID || '').trim() === String(payload.OT_ID || '').trim();
  }) || null;
  if (createdWorkOrder) result.rowIndex = createdWorkOrder._rowIndex;

  try {
    if (payload.AssetID && payload.Estado_Equipo_Post_OT) {
      const asset = assets.find((a) => a.SFI === payload.AssetID);
      if (asset) {
        asset.Status = payload.Estado_Equipo_Post_OT;
        updateRecord(DB_CONFIG.TABLES.ASSETS, asset._rowIndex, asset);
      }
    }

    if (normalizedStatus === "CLOSED" && payload.TaskID) {
      const planData = readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN);
      const planTask = planData.find((t) => t.TaskID === payload.TaskID);
      if (planTask) {
        let updated = false;
        if (payload.CompletedDate) {
          planTask.Ultima_Ejecucion_Fecha = payload.CompletedDate;
          const nextDate = _calcNextMaintenanceDate(
            payload.CompletedDate,
            parseInt(planTask.Frecuencia_Meses),
          );
          if (nextDate) planTask.Siguiente_Vencimiento_Fecha = nextDate;
          updated = true;
        }
        if (payload.CompletedHours) {
          planTask.Ultima_Ejecucion_HS = payload.CompletedHours;
          const freqHS = parseFloat(planTask.Frecuencia_HS) || 0;
          if (freqHS > 0)
            planTask.Siguiente_Vencimiento_HS = (
              parseFloat(payload.CompletedHours) + freqHS
            ).toString();
          updated = true;
        }
        if (updated)
          updateRecord(
            DB_CONFIG.TABLES.MAINTENANCE_PLAN,
            planTask._rowIndex,
            planTask,
          );
      }
    }

    if (createdWorkOrder && createdWorkOrder._rowIndex) {
      _syncWorkOrderVisibleStatuses_([createdWorkOrder._rowIndex]);
      _syncMaintenancePlanForWorkOrder_(createdWorkOrder, [payload.TaskID]);
    } else if (payload.TaskID) {
      _syncMaintenancePlanStatuses_([payload.TaskID]);
    }
  } catch (e) {
    console.error("Error en sincronización post-creación OT:", e);
  }

  if (result.success) {
    result.OT_ID = payload.OT_ID;
    if (createdWorkOrder) result.rowIndex = createdWorkOrder._rowIndex;
    result.record = payload;
  }
  return result;
}

function _apiGetProveedores() {
  return readTable(DB_CONFIG.TABLES.PROVEEDORES);
}

function _apiUpdateWorkOrder(rowIndex, payload) {
  payload = payload || {};
  _applyWorkOrderDeferralAuthorization_(payload);
  const existingWorkOrder = readTable(DB_CONFIG.TABLES.WORK_ORDERS).find(function (row) {
    return row._rowIndex === rowIndex;
  }) || null;
  payload.TaskID = _normalizeWorkOrderTaskId_(payload, existingWorkOrder);
  const normalizedStatus = _normalizeStatus_(payload.Status);
  if (normalizedStatus) payload.Status = normalizedStatus;
  payload.Estado_Visible = _resolveWorkOrderVisibleStatus_(Object.assign({}, existingWorkOrder || {}, payload));

  // Validación de Reglas Duras (PROC-MAN-01 4-Eyes Principle)
  // Si la OT se está intentando cerrar y es crítica (A o B)
  if (normalizedStatus === "CLOSED") {
    const isCritical =
      payload.Criticidad === "A" ||
      payload.Criticidad === "B" ||
      (payload.Criticidad || "").includes("A") ||
      (payload.Criticidad || "").includes("B");

    if (isCritical) {
      if (
        !payload.Resultado_Prueba ||
        payload.Resultado_Prueba === "" ||
        payload.Resultado_Prueba.toUpperCase().includes("FAIL")
      ) {
        return {
          success: false,
          message:
            "PROC-MAN-01: No se puede cerrar OT Crítica sin un Resultado de Prueba (PASS).",
        };
      }
      if (
        !payload.Verificador_Independiente ||
        payload.Verificador_Independiente.trim() === ""
      ) {
        return {
          success: false,
          message:
            "PROC-MAN-01: No se puede cerrar OT Crítica sin la firma del Verificador Independiente (4-Ojos).",
        };
      }
      if (!payload.Evidencia_Files || payload.Evidencia_Files.trim() === "") {
        return {
          success: false,
          message:
            "PROC-MAN-01: Evidencia obligatoria faltante para cierre de equipo crítico (SIRE Ready).",
        };
      }
    }
  }

  // --- CONTROL DE STOCK: Consumo de Repuestos ---
  if (payload.Repuestos_Consumidos) {
    let usageList = [];
    try {
      usageList =
        typeof payload.Repuestos_Consumidos === "string"
          ? JSON.parse(payload.Repuestos_Consumidos)
          : payload.Repuestos_Consumidos;
    } catch (e) {
      console.error(
        "Error al parsear Repuestos_Consumidos en actualización:",
        e,
      );
    }
    if (usageList && usageList.length > 0) {
      apiConsumeSpares(usageList);
    }
  }

  const result = updateRecord(DB_CONFIG.TABLES.WORK_ORDERS, rowIndex, payload);
  if (!result.success) return result;
  result.rowIndex = rowIndex;

  // --- SINCRONIZACIÓN POST-GUARDADO ---
  try {
    // 1. Sincronización con INVENTARIO (ASSETS)
    if (payload.AssetID && payload.Estado_Equipo_Post_OT) {
      const assets = readTable(DB_CONFIG.TABLES.ASSETS);
      const asset = assets.find((a) => a.SFI === payload.AssetID);
      if (asset) {
        asset.Status = payload.Estado_Equipo_Post_OT;
        updateRecord(DB_CONFIG.TABLES.ASSETS, asset._rowIndex, asset);
      }
    }

    if (normalizedStatus === "CLOSED") {
      const otId =
        payload.OT_ID ||
        (
          readTable(DB_CONFIG.TABLES.WORK_ORDERS).find(
            (ot) => ot._rowIndex === rowIndex,
          ) || {}
        ).OT_ID;

      // 2. Sincronización con DEFECT_LOG (Cierre automático, estados normalizados)
      if (otId) {
        const defects = readTable(DB_CONFIG.TABLES.DEFECT_LOG);
        const linkedDefects = defects.filter(
          (d) =>
            d.OT_Asociada === otId && _normalizeStatus_(d.Status) !== "CLOSED",
        );
        linkedDefects.forEach((def) => {
          updateRecord(DB_CONFIG.TABLES.DEFECT_LOG, def._rowIndex, {
            Status: "CLOSED",
            Estado_Operativo: "OPERATIVO",
            TaskID: payload.TaskID || def.TaskID || "",
          });
          _syncAssetOperationalState(def.SFI, "OPERATIVO", def.Embarcacion || def.VesselName || payload.VesselName || "");
        });

        // 2b. Sincronización con DEFERRALS (Cierre automático)
        try {
          const deferrals = readTable(DB_CONFIG.TABLES.DEFERRALS);
          const linkedDeferrals = deferrals.filter(
            (df) =>
              df.OT_Asociada === otId &&
              ["REQUESTED", "APPROVED", "ACTIVE"].includes(
                _normalizeStatus_(df.Status),
              ),
          );
          linkedDeferrals.forEach((df) => {
            updateRecord(DB_CONFIG.TABLES.DEFERRALS, df._rowIndex, {
              Status: "CLOSED",
              Notas_Cierre: "Cerrado automáticamente al cerrar OT " + otId,
            });
          });
        } catch (e) {
          console.error("Error sync Deferrals en cierre OT:", e);
        }
      }

      // 3. Sincronización con PLAN DE MANTENIMIENTO (Lógica existente)
      if (payload.TaskID) {
        const planData = readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN);
        const planTask = planData.find((t) => t.TaskID === payload.TaskID);
        if (planTask) {
          let updated = false;
          if (payload.CompletedDate) {
            planTask.Ultima_Ejecucion_Fecha = payload.CompletedDate;
            const nextDate = _calcNextMaintenanceDate(
              payload.CompletedDate,
              parseInt(planTask.Frecuencia_Meses),
            );
            if (nextDate) planTask.Siguiente_Vencimiento_Fecha = nextDate;
            updated = true;
          }
          if (payload.CompletedHours) {
            planTask.Ultima_Ejecucion_HS = payload.CompletedHours;
            const freqHS = parseFloat(planTask.Frecuencia_HS) || 0;
            if (freqHS > 0) {
              planTask.Siguiente_Vencimiento_HS = (
                parseFloat(payload.CompletedHours) + freqHS
              ).toString();
            }
            updated = true;
          }
          if (updated)
            updateRecord(
              DB_CONFIG.TABLES.MAINTENANCE_PLAN,
              planTask._rowIndex,
              planTask,
            );
        }
      }
    }

    _syncWorkOrderVisibleStatuses_([rowIndex]);
    const updatedWorkOrder = Object.assign({}, existingWorkOrder || {}, payload, { _rowIndex: rowIndex });
    _syncMaintenancePlanForWorkOrder_(updatedWorkOrder, [payload.TaskID, existingWorkOrder && existingWorkOrder.TaskID]);
  } catch (e) {
    console.error("Error en sincronización post-OT:", e);
  }

  return result;
}

// --- DEFECT LOG (PROC-MAN-15) ---
function _apiGetDefects() {
  return readTable(DB_CONFIG.TABLES.DEFECT_LOG);
}

/**
 * Verifica si un SFI ya ha tenido fallas repetidas en los últimos 12 meses en una embarcación.
 * Se considera patrón recurrente cuando existen al menos 2 eventos previos del mismo SFI.
 * Útil para detectar repetición significativa y forzar RCA según PROC-MAN-18.
 */
function _apiCheckSfiRecurrence(vessel, sfi) {
  if (!vessel || !sfi) return { recurrent: false, count: 0 };

  const normalizedTargetSfi = _normalizeSfiMatchKey_(sfi);
  if (!normalizedTargetSfi) return { recurrent: false, count: 0 };

  const defects = readTable(DB_CONFIG.TABLES.DEFECT_LOG);
  const now = new Date();
  const oneYearAgo = new Date(
    now.getFullYear() - 1,
    now.getMonth(),
    now.getDate(),
  );

  const matches = defects.filter(function (d) {
    const dVessel = (d.Embarcacion || "").toString().trim().toUpperCase();
    const dSfi = _normalizeSfiMatchKey_(d.SFI);
    // CORREGIDO: usar parseDateServer_ (server-side) en lugar de parseDateManual (client-side)
    const dDate = parseDateServer_(d.Fecha_Reporte || d.Date);
    return (
      dVessel === vessel.trim().toUpperCase() &&
      dSfi === normalizedTargetSfi &&
      dDate !== null &&
      dDate >= oneYearAgo
    );
  });

  return {
    recurrent: matches.length >= 2,
    count: matches.length,
    eventCount: matches.length + 1,
    previousIds: matches.map(function (m) {
      return m.Defecto_ID;
    }),
  };
}

function _normalizeComparableValue_(value) {
  return String(value || "").trim().toUpperCase();
}

function _normalizeSfiMatchKey_(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  const match = raw.match(/^(\d{3}(?:\.\d+[A-Z0-9]*)?)/);
  if (match) return match[1];
  return raw.split(/\s|-|\//)[0].replace(/[^0-9A-Z.]/g, "");
}

function _normalizeAssetStatusFromOperationalState_(status) {
  const normalized = _normalizeComparableValue_(status);
  if (!normalized) return "";
  if (normalized === "OPERATIVO" || normalized === "ACTIVO") return "OPERATIVO";
  if (normalized === "REP.TEMP" || normalized === "REPARACION TEMPORARIA") return "REP.TEMP";
  return "FALLA";
}

function _syncAssetOperationalState(sfi, status, vesselName) {
  if (!sfi || !status) return;
  try {
    const assets = readTable(DB_CONFIG.TABLES.ASSETS);
    const normalizedSfi = _normalizeSfiMatchKey_(sfi);
    const normalizedVessel = _normalizeComparableValue_(vesselName);
    const inventoryStatus = _normalizeAssetStatusFromOperationalState_(status);
    if (!inventoryStatus) return;

    let asset = null;
    if (normalizedVessel) {
      asset = assets.find(function (item) {
        return _normalizeSfiMatchKey_(item.SFI) === normalizedSfi &&
          _normalizeComparableValue_(item.VesselName) === normalizedVessel;
      }) || null;
    }

    if (!asset) {
      const matchingAssets = assets.filter(function (item) {
        return _normalizeSfiMatchKey_(item.SFI) === normalizedSfi;
      });
      if (matchingAssets.length === 1) asset = matchingAssets[0];
    }

    const resolvedStatus = asset
      ? _resolveInventoryStatusForAsset_(asset.VesselName || vesselName, asset.SFI || sfi, status, asset.Status)
      : inventoryStatus;

    if (asset && resolvedStatus && _normalizeComparableValue_(asset.Status) !== resolvedStatus) {
      updateRecord(DB_CONFIG.TABLES.ASSETS, asset._rowIndex, {
        Status: resolvedStatus,
      });
    }
  } catch (e) {
    console.error("Error syncing asset operational state:", e);
  }
}

function _apiCreateDefect(payload) {
  payload = payload || {};
  if (payload.SFI !== undefined) payload.SFI = _normalizeSfiMatchKey_(payload.SFI);
  payload.Defecto_ID = _getNextDefectId_(payload);
  payload.TaskID = _normalizeDefectTaskId_(payload, null);
  const result = createRecord(DB_CONFIG.TABLES.DEFECT_LOG, payload);
  if (result.success) {
    const created = readTable(DB_CONFIG.TABLES.DEFECT_LOG).find(function (item) {
      return String(item.Defecto_ID || "").trim() === String(payload.Defecto_ID || "").trim();
    });
    result.Defecto_ID = payload.Defecto_ID;
    result.rowIndex = created ? created._rowIndex : null;
    result.record = created || payload;
    if (payload.SFI && payload.Estado_Operativo) {
      _syncAssetOperationalState(payload.SFI, payload.Estado_Operativo, payload.Embarcacion || payload.VesselName || "");
    }
  }
  return result;
}

function _apiUpdateDefect(rowIndex, payload) {
  payload = payload || {};
  if (payload.SFI !== undefined) payload.SFI = _normalizeSfiMatchKey_(payload.SFI);
  // Obtener registro actual para asegurar que tenemos OT_Asociada y SFI para la sincronización
  const defects = readTable(DB_CONFIG.TABLES.DEFECT_LOG);
  const existing = defects.find((d) => d._rowIndex === rowIndex);
  payload.TaskID = _normalizeDefectTaskId_(payload, existing);

  const result = updateRecord(DB_CONFIG.TABLES.DEFECT_LOG, rowIndex, payload);
  if (!result.success) return result;
  result.rowIndex = rowIndex;
  result.Defecto_ID = payload.Defecto_ID || (existing ? existing.Defecto_ID : "");
  result.record = Object.assign({}, existing || {}, payload, {
    _rowIndex: rowIndex,
    Defecto_ID: payload.Defecto_ID || (existing ? existing.Defecto_ID : ""),
  });

  try {
    // Sincronizar estado operativo en inventario principal
    const syncSfi = payload.SFI || (existing ? existing.SFI : "");
    const syncOperationalState = payload.Estado_Operativo || (existing ? existing.Estado_Operativo : "");
    const syncVessel = payload.Embarcacion || payload.VesselName || (existing ? (existing.Embarcacion || existing.VesselName) : "");
    if (syncSfi && syncOperationalState) {
      _syncAssetOperationalState(syncSfi, syncOperationalState, syncVessel);
    }

    // Sincronizar SFI con OT_Asociada si existe
    const otId = payload.OT_Asociada || (existing ? existing.OT_Asociada : "");
    const newSFI = payload.SFI || (existing ? existing.SFI : "");
    const newCrit =
      payload.Clasificacion_Falla ||
      (existing ? existing.Clasificacion_Falla : "");

    if (otId && otId.toString().trim() !== "" && newSFI) {
      const otTable = readTable(DB_CONFIG.TABLES.WORK_ORDERS);
      const linkedOT = otTable.find(
        (ot) => ot.OT_ID.toString().trim() === otId.toString().trim(),
      );

      if (linkedOT) {
        const previousLinkedOT = Object.assign({}, linkedOT);
        let otUpdated = false;

        if (linkedOT.AssetID !== newSFI) {
          linkedOT.AssetID = newSFI;
          otUpdated = true;

          // Si el SFI cambió, intentar heredar la criticidad real del inventario
          const assets = readTable(DB_CONFIG.TABLES.ASSETS);
          const asset = assets.find((a) => a.SFI === newSFI);
          if (asset) {
            let critClean = asset.Criticidad || "C";
            if (critClean.includes("A")) critClean = "A";
            else if (critClean.includes("B")) critClean = "B";
            else critClean = "C";
            linkedOT.Criticidad = critClean;
          }
        }

        if (payload.TaskID && linkedOT.TaskID !== payload.TaskID) {
          linkedOT.TaskID = payload.TaskID;
          otUpdated = true;
        }

        // Si el usuario cambió la criticidad manualmente en el defecto, propagarla a la OT
        if (payload.Clasificacion_Falla && linkedOT.Criticidad !== newCrit) {
          linkedOT.Criticidad = newCrit;
          otUpdated = true;
        }

        if (otUpdated) {
          updateRecord(
            DB_CONFIG.TABLES.WORK_ORDERS,
            linkedOT._rowIndex,
            linkedOT,
          );
          _syncWorkOrderVisibleStatuses_([linkedOT._rowIndex]);
          _syncMaintenancePlanForWorkOrder_(linkedOT, [previousLinkedOT.TaskID, linkedOT.TaskID]);
        }
      }
    }
  } catch (e) {
    console.error("Error sincronizando Defecto con OT o Asset:", e);
  }

  return result;
}

// --- BARRERAS DE SEGURIDAD (PROC-MAN-15 / PROC-MAN-03) ---
function _apiGetBarrierAssessment(defectId) {
  if (!defectId) return null;
  const table = readTable(DB_CONFIG.TABLES.BARRIER_ASSESSMENTS);
  const matches = table.filter(
    (a) => a.Defecto_ID.toString().trim() === defectId.toString().trim(),
  );
  if (matches.length === 0) return null;

  // Retornar la más reciente (asumiendo que los registros se añaden al final)
  return matches[matches.length - 1];
}

function _apiSaveBarrierAssessment(payload) {
  payload = payload || {};
  if (!payload.Defecto_ID)
    return { success: false, message: "Defecto_ID requerido" };

  const hasText = function (value) {
    return String(value == null ? "" : value).trim() !== "";
  };

  if (!hasText(payload.test_result)) {
    if (payload.barrier_status === "HEALTHY") payload.test_result = "PASS";
    else if (payload.barrier_status === "DEGRADED")
      payload.test_result = "PASS_CON_OBSERVACION";
    else payload.test_result = "FAIL";
  }

  if (!hasText(payload.operational_decision)) {
    if (payload.deferral_impact === "BLOCKED") payload.operational_decision = "NO_GO";
    else if (payload.deferral_impact === "REVIEW_REQUIRED")
      payload.operational_decision = "RESTRICTED";
    else payload.operational_decision = "GO";
  }

  if (!hasText(payload.corrective_action_required)) {
    payload.corrective_action_required =
      payload.test_result === "PASS" ? "NO" : "YES";
  }

  if (!hasText(payload.reassessment_required)) {
    payload.reassessment_required =
      payload.test_result === "PASS" && payload.operational_decision === "GO"
        ? "NO"
        : "YES";
  }

  const requiredComplianceKeys = [
    "barrier_family",
    "condition_initial",
    "acceptance_criterion",
    "test_result",
    "verification_method",
    "operational_decision",
    "evidence_reference",
  ];

  const missingCompliance = requiredComplianceKeys.filter(function (key) {
    return !hasText(payload[key]);
  });

  if (
    payload.corrective_action_required === "YES" &&
    !hasText(payload.corrective_action_description)
  ) {
    missingCompliance.push("corrective_action_description");
  }

  if (
    (payload.reassessment_required === "YES" ||
      payload.operational_decision === "RESTRICTED" ||
      payload.operational_decision === "NO_GO") &&
    !hasText(payload.reassessment_due_date)
  ) {
    missingCompliance.push("reassessment_due_date");
  }

  payload.compliance_status =
    missingCompliance.length === 0 ? "COMPLETE" : "PARTIAL";

  // Normalizar campos de auditoría
  const user = _requireAuthenticatedUser_().EMAIL;
  const now = new Date();

  payload.assessment_last_updated_at = now;
  payload.assessment_last_updated_by = user;
  payload.barrier_assessment_started_at =
    payload.barrier_assessment_started_at || now;
  payload.barrier_assessment_completed_at = now;
  payload.barrier_assessment_completed_by = user;

  // ESTRATEGIA DE HISTORIAL: Siempre crear un nuevo registro (Append-only log)
  // El estado vigente será siempre el último registro añadido para ese Defecto_ID.
  const result = createRecord(DB_CONFIG.TABLES.BARRIER_ASSESSMENTS, payload);

  if (result.success) {
    try {
      createRecord(DB_CONFIG.TABLES.AUDIT_LOG, {
        Timestamp: now,
        User: user,
        Action: "BARRIER_ASSESSMENT_COMPLETED",
        Table: DB_CONFIG.TABLES.BARRIER_ASSESSMENTS,
        RecordID: payload.Defecto_ID,
        Details: `Status: ${payload.barrier_status} | Result: ${payload.test_result} | Decision: ${payload.operational_decision} | Compliance: ${payload.compliance_status} | Deferral Impact: ${payload.deferral_impact} | Trace: ${String(payload.assessment_basis || "").substring(0, 100)}...`,
      });
    } catch (e) {
      console.error("Error logging barrier assessment audit:", e);
    }
  }

  return result;
}

// --- DEFERRALS (PROC-MAN-03) ---

function _apiGetDeferrals() {
  return readTable(DB_CONFIG.TABLES.DEFERRALS);
}

/**
 * apiCreateDeferral - Crea un nuevo registro de Diferimiento (PROC-MAN-03).
 * Aplica validaciones obligatorias, regla NO-GO y sincronización con el Log de Defectos.
 */
function _apiCreateDeferral(payload) {
  // REGLA NO-GO ABSOLUTA: Un equipo declarado NO-GO no puede diferirse por seguridad operativa.
  if (
    payload.Declarado_NoGo === true ||
    payload.Declarado_NoGo === "true" ||
    payload.Declarado_NoGo === "Sí"
  ) {
    return {
      success: false,
      message:
        "REGLA NO-GO: Un equipo declarado NO-GO por seguridad no es elegible para diferimientos. Requiere reparación inmediata.",
    };
  }

  // REGLA BARRERA IA: Bloqueo estricto si el impacto es BLOCKED.
  try {
    const assessment = apiGetBarrierAssessment(payload.Defecto_ID);
    if (assessment) {
      if (assessment.deferral_impact === "BLOCKED") {
        return {
          success: false,
          message:
            "RIESGO CRÍTICO DETECTADO: El asistente de barreras ha bloqueado el diferimiento técnico debido a la degradación crítica de: " +
            assessment.barrier_name,
        };
      }
      // REVIEW_REQUIRED: Se permite crear, pero se asume que el flujo de aprobación posterior (MOC) se activa.
      if (assessment.deferral_impact === "REVIEW_REQUIRED") {
        // Podríamos añadir una bandera al payload o loguear la advertencia.
        console.warn(
          "Diferimiento creado bajo estado REVIEW_REQUIRED para defecto " +
            payload.Defecto_ID,
        );
      }
    }
  } catch (e) {
    console.error("Error verificando barreras en diferimiento:", e);
  }

  // Validar campos obligatorios (PROC-MAN-03 compliance)
  if (
    (!payload.Defecto_ID || String(payload.Defecto_ID).trim() === "") &&
    (!payload.TaskID_Origen || String(payload.TaskID_Origen).trim() === "")
  ) {
    return {
      success: false,
      message: 'PROC-MAN-03: Debe existir un origen trazable para el diferimiento (Defecto_ID o TaskID_Origen).',
    };
  }

  const requiredFields = [
    { key: "Embarcacion", label: "Embarcación" },
    { key: "SFI", label: "SFI / Equipo" },
    { key: "Motivo", label: "Motivo del diferimiento" },
    { key: "Medida_Compensatoria", label: "Medida Compensatoria (Mitigación)" },
    { key: "Restricciones_Operativas", label: "Restricciones Operativas" },
    { key: "Fecha_Vencimiento", label: "Fecha de Vencimiento" },
    { key: "Permite_Operacion", label: "Permite operación con restricción" },
  ];

  for (let i = 0; i < requiredFields.length; i++) {
    const f = requiredFields[i];
    if (!payload[f.key] || String(payload[f.key]).trim() === "") {
      return {
        success: false,
        message: `PROC-MAN-03: Campo "${f.label}" es obligatorio para formalizar un diferimiento.`,
      };
    }
  }

  const authorizationValidation = _validateDeferralAuthorizationPayload_(payload);
  if (!authorizationValidation.ok) {
    return {
      success: false,
      message: authorizationValidation.message,
    };
  }

  // Generar ID único
  const currentYear = new Date().getFullYear();
  const prefix = "DIF-" + currentYear + "-";
  payload.Deferral_ID = _getNextId(
    DB_CONFIG.TABLES.DEFERRALS,
    prefix,
    "Deferral_ID",
    3,
  );

  // Valores por defecto
  if (!payload.Status) payload.Status = "REQUESTED";
  if (!payload.Fecha_Solicitud) {
    const now = new Date();
    payload.Fecha_Solicitud =
      now.getDate().toString().padStart(2, "0") +
      "-" +
      (now.getMonth() + 1).toString().padStart(2, "0") +
      "-" +
      now.getFullYear();
  }
  payload.Estado_Visible = _resolveDeferralVisibleStatus_(payload);

  const result = createRecord(DB_CONFIG.TABLES.DEFERRALS, payload);
  if (!result.success) return result;

  // Sincronizar el Defecto vinculado -> DEFERRED
  if (payload.Defecto_ID) {
    try {
      const defects = readTable(DB_CONFIG.TABLES.DEFECT_LOG);
      const linked = defects.find(function (d) {
        return d.Defecto_ID === payload.Defecto_ID;
      });
      if (linked) {
        updateRecord(DB_CONFIG.TABLES.DEFECT_LOG, linked._rowIndex, {
          Status: "DEFERRED",
        });
      }
    } catch (e) {
      console.error("Error actualizando Defecto desde Deferral create:", e);
    }
  }

  if (payload.OT_Asociada) {
      const linkedOt = readTable(DB_CONFIG.TABLES.WORK_ORDERS).find(function (ot) {
        return String(ot.OT_ID || "").trim() === String(payload.OT_Asociada || "").trim();
      });
      if (linkedOt) {
        _syncWorkOrderVisibleStatuses_([linkedOt._rowIndex]);
        _syncMaintenancePlanForWorkOrder_(linkedOt, [linkedOt.TaskID]);
    }
  }

  _syncDeferralVisibleStatuses_(null);

  result.Deferral_ID = payload.Deferral_ID;
  return result;
}

/**
 * apiUpdateDeferral - Actualiza un diferimiento existente.
 * Sincroniza el cierre del diferimiento con la resolución del defecto asociado.
 */
function _apiUpdateDeferral(rowIndex, payload) {
  const deferrals = readTable(DB_CONFIG.TABLES.DEFERRALS);
  const existing = deferrals.find(function (d) {
    return d._rowIndex === rowIndex;
  });

  const validationPayload = Object.assign({}, existing || {}, payload || {});
  const authorizationValidation = _validateDeferralAuthorizationPayload_(validationPayload);
  if (!authorizationValidation.ok) {
    return {
      success: false,
      message: authorizationValidation.message,
    };
  }

  payload.Estado_Visible = _resolveDeferralVisibleStatus_(validationPayload);

  const result = updateRecord(DB_CONFIG.TABLES.DEFERRALS, rowIndex, payload);
  if (!result.success) return result;

  // Sincronizar Defecto asociado al cerrar o rechazar el diferimiento
  const newStatus = _normalizeStatus_(payload.Status);
  if (newStatus === "CLOSED" || newStatus === "REJECTED") {
    const defectoId =
      payload.Defecto_ID || (existing ? existing.Defecto_ID : null);
    if (defectoId) {
      try {
        const defects = readTable(DB_CONFIG.TABLES.DEFECT_LOG);
        const linked = defects.find(function (d) {
          return d.Defecto_ID === defectoId;
        });
        if (linked) {
          const newDefStatus = newStatus === "CLOSED" ? "CLOSED" : "OPEN";
          updateRecord(DB_CONFIG.TABLES.DEFECT_LOG, linked._rowIndex, {
            Status: newDefStatus,
            Estado_Operativo:
              newStatus === "CLOSED" ? "OPERATIVO" : linked.Estado_Operativo,
          });
          if (newStatus === "CLOSED") {
            _syncAssetOperationalState(linked.SFI, "OPERATIVO", linked.Embarcacion || linked.VesselName || payload.Embarcacion || "");
          }
        }
      } catch (e) {
        console.error("Error sincronizando Defecto desde Deferral update:", e);
      }
    }
  }

  const otId = payload.OT_Asociada || (existing ? existing.OT_Asociada : "");
  if (otId) {
    const linkedOt = readTable(DB_CONFIG.TABLES.WORK_ORDERS).find(function (ot) {
      return String(ot.OT_ID || "").trim() === String(otId || "").trim();
    });
    if (linkedOt) {
      _syncWorkOrderVisibleStatuses_([linkedOt._rowIndex]);
      _syncMaintenancePlanForWorkOrder_(linkedOt, [linkedOt.TaskID]);
    }
  }

  _syncDeferralVisibleStatuses_([rowIndex]);

  return result;
}

// --- RCA (PROC-MAN-18) ---
function _apiGetRCAs() {
  return readTable(DB_CONFIG.TABLES.RCA_LOG);
}

function _apiCreateRCA(payload) {
  const currentYear = new Date().getFullYear();
  const prefix = `RCA-${currentYear}-`;
  payload.RCA_ID = _getNextId(DB_CONFIG.TABLES.RCA_LOG, prefix, "RCA_ID", 3);
  return createRecord(DB_CONFIG.TABLES.RCA_LOG, payload);
}

function _apiUpdateRCA(rowIndex, payload) {
  return updateRecord(DB_CONFIG.TABLES.RCA_LOG, rowIndex, payload);
}

// --- CAPA (PROC-MAN-19) ---
function _apiGetCAPAs() {
  return readTable(DB_CONFIG.TABLES.CAPA_LOG);
}

function _apiCreateCAPA(payload) {
  const currentYear = new Date().getFullYear();
  const prefix = `CAPA-${currentYear}-`;
  payload.CAPA_ID = _getNextId(DB_CONFIG.TABLES.CAPA_LOG, prefix, "CAPA_ID", 3);
  return createRecord(DB_CONFIG.TABLES.CAPA_LOG, payload);
}

function _apiUpdateCAPA(rowIndex, payload) {
  return updateRecord(DB_CONFIG.TABLES.CAPA_LOG, rowIndex, payload);
}

// --- DAILY REPORTS (REG-OPS-01) ---
function _normalizeDailySummaryVesselKey_(value) {
  return String(value || "").trim().toUpperCase();
}

function _toStartOfDayServer_(value) {
  const date = parseDateServer_(value);
  if (!date) return null;
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function _daysBetweenServer_(fromDate, toDate) {
  const from = _toStartOfDayServer_(fromDate);
  const to = _toStartOfDayServer_(toDate);
  if (!from || !to) return null;
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function _isTruthyOperationalFlag_(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return true;
  return !["NO", "FALSE", "0", "INACTIVO", "CANCELADO", "CANCELLED"].includes(normalized);
}

function _isHealthyAssetStatus_(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return true;
  return [
    "ACTIVO",
    "ACTIVE",
    "OPERATIVO",
    "OPERACION NORMAL",
    "OPERACIÓN NORMAL",
    "RUNNING",
    "STANDBY",
    "OK",
    "NORMAL",
    "DISPONIBLE",
    "EN SERVICIO",
  ].includes(normalized);
}

function _isOpenDefectStatus_(value) {
  const normalized = _normalizeStatus_(value || "OPEN");
  return normalized !== "CLOSED" && normalized !== "CANCELLED" && normalized !== "REJECTED";
}

function _isOpenDeferralStatus_(value) {
  const normalized = _normalizeStatus_(value || "REQUESTED");
  return normalized !== "CLOSED" && normalized !== "REJECTED" && normalized !== "CANCELLED";
}

function _isOpenSpareOrderStatus_(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return !["RECIBIDO", "RECEIVED", "CLOSED", "CERRADO", "CANCELADO", "CANCELLED"].includes(normalized);
}

function _getDailyHoursBySfiForVessel_(vesselKey, reportDate) {
  const rows = readTable(DB_CONFIG.TABLES.DAILY_REPORTS) || [];
  const referenceDate = _toStartOfDayServer_(reportDate) || _toStartOfDayServer_(new Date());
  const machinePrefixes = DAILY_REPORT_MAIN_SLOT_PREFIXES.concat(DAILY_REPORT_GENERATOR_SLOT_PREFIXES);
  const latestHoursBySFI = {};

  rows.forEach(function(row) {
    if (_normalizeDailySummaryVesselKey_(row.VesselName || row.Embarcacion) !== vesselKey) return;
    const rowDate = _toStartOfDayServer_(row.Date || row.Fecha);
    if (!rowDate || rowDate.getTime() > referenceDate.getTime()) return;

    const rowTime = String(row.Time || row.Hora || "00:00").trim() || "00:00";
    const stamp = new Date(`${Utilities.formatDate(rowDate, Session.getScriptTimeZone(), "yyyy-MM-dd")}T${rowTime}`);
    const validStamp = isNaN(stamp.getTime()) ? rowDate : stamp;

    machinePrefixes.forEach(function(prefix) {
      const sfi = _normalizeDailySummaryVesselKey_(row[`${prefix}_SFI`]);
      if (!sfi) return;
      const hours = parseFloat(row[`${prefix}_Current_Hours`]);
      if (isNaN(hours)) return;
      if (!latestHoursBySFI[sfi] || validStamp.getTime() > latestHoursBySFI[sfi].stamp.getTime()) {
        latestHoursBySFI[sfi] = { hours: hours, stamp: validStamp };
      }
    });
  });

  return latestHoursBySFI;
}

function _addSummaryLine_(lines, text) {
  if (String(text || "").trim()) lines.push(String(text).trim());
}

function _sortAndLimitByCount_(mapObj, limit, formatter) {
  return Object.keys(mapObj || {})
    .map(function(key) {
      const entry = mapObj[key] || {};
      return Object.assign({ key: key, count: entry.count || 0 }, entry);
    })
    .sort(function(a, b) {
      return (b.count || 0) - (a.count || 0) || String(a.key || '').localeCompare(String(b.key || ''));
    })
    .slice(0, limit || 5)
    .map(function(item) {
      return typeof formatter === 'function' ? formatter(item) : item;
    });
}

function _buildDailyExecutiveSummary_(vesselName, reportDate) {
  const vesselKey = _normalizeDailySummaryVesselKey_(vesselName);
  const referenceDate = _toStartOfDayServer_(reportDate) || _toStartOfDayServer_(new Date());
  if (!vesselKey || !referenceDate) {
    return {
      success: false,
      message: "Embarcación y fecha son obligatorias para generar el resumen ejecutivo.",
    };
  }

  const maintenancePlan = (readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey && _isTruthyOperationalFlag_(item.Activo);
  });
  const assets = (readTable(DB_CONFIG.TABLES.ASSETS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const spares = (readTable(DB_CONFIG.TABLES.SPARES) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const inspections = (readTable(DB_CONFIG.TABLES.INSPECTIONS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey && _isTruthyOperationalFlag_(item.Activo);
  });
  const inspectionLogs = (readTable(DB_CONFIG.TABLES.INSPECTIONS_LOG) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const workOrders = (readTable(DB_CONFIG.TABLES.WORK_ORDERS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const certificates = (readTable(DB_CONFIG.TABLES.CERTIFICATES) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const spareOrders = (readTable(DB_CONFIG.TABLES.SPARE_ORDERS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const deferrals = (readTable(DB_CONFIG.TABLES.DEFERRALS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.Embarcacion) === vesselKey;
  });
  const defects = (readTable(DB_CONFIG.TABLES.DEFECT_LOG) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.Embarcacion) === vesselKey;
  });
  const latestHoursBySFI = _getDailyHoursBySfiForVessel_(vesselKey, referenceDate);

  const counts = {
    maintenanceOverdue: 0,
    maintenanceUpcoming: 0,
    maintenanceInProgress: 0,
    criticalEquipmentAlerts: 0,
    spareOutOfStock: 0,
    spareBelowMin: 0,
    spareReorderPoint: 0,
    inspectionsOverdue: 0,
    inspectionsUpcoming: 0,
    inspectionsFailed: 0,
    workOrdersOpen: 0,
    workOrdersOverdue: 0,
    workOrdersPendingDeferral: 0,
    workOrdersDeferred: 0,
    workOrdersWaiting: 0,
    certificatesExpired: 0,
    certificatesUpcoming: 0,
    spareOrdersPending: 0,
    spareOrdersDelayed: 0,
    deferralsPending: 0,
    deferralsApproved: 0,
    deferralsExpired: 0,
    defectsOpen: 0,
    defectsCritical: 0,
    defectsRecurring: 0,
  };

  const workOrderPlanIndex = {};
  workOrders.forEach(function(item) {
    const normalizedStatus = _normalizeStatus_(item.Status || "OPEN");
    if (normalizedStatus === "CLOSED" || normalizedStatus === "CANCELLED") return;
    counts.workOrdersOpen++;

    const authStatus = String(item.Deferral_Autorizacion_Status || "").trim().toUpperCase();
    if (authStatus === "PENDIENTE") counts.workOrdersPendingDeferral++;
    if (normalizedStatus === "DEFERRED" || authStatus === "AUTORIZADO") counts.workOrdersDeferred++;
    if (normalizedStatus === "WAITING_SPARES" || normalizedStatus === "WAITING_VENDOR") counts.workOrdersWaiting++;

    const dueBase = parseDateServer_(item.Fecha_Vencimiento_OT || item.PlannedDate);
    if (dueBase && authStatus !== "PENDIENTE" && normalizedStatus !== "DEFERRED") {
      const limitDate = new Date(dueBase);
      if (!String(item.Fecha_Vencimiento_OT || "").trim()) {
        limitDate.setDate(limitDate.getDate() + (parseInt(item.Ventana_Tolerancia, 10) || 0));
      }
      limitDate.setHours(0, 0, 0, 0);
      if (limitDate.getTime() < referenceDate.getTime()) counts.workOrdersOverdue++;
    }

    const taskKey = String(item.TaskID || "").trim().toUpperCase();
    const sfiKey = _normalizeDailySummaryVesselKey_(item.AssetID);
    if (taskKey) workOrderPlanIndex[`TASK:${taskKey}`] = true;
    if (sfiKey) workOrderPlanIndex[`SFI:${sfiKey}`] = true;
  });

  maintenancePlan.forEach(function(item) {
    const dueDate = parseDateServer_(item.Siguiente_Vencimiento_Fecha || item.NextDate || item.Siguiente_Fecha || item.Vencimiento);
    const nextHours = parseFloat(item.Siguiente_Vencimiento_HS || item.NextHS || item.Vencimiento_HS);
    const sfiKey = _normalizeDailySummaryVesselKey_(item.SFI);
    const taskKey = String(item.TaskID || "").trim().toUpperCase();
    const hoursIndex = sfiKey ? latestHoursBySFI[sfiKey] : null;
    const overdueByDate = dueDate ? _toStartOfDayServer_(dueDate).getTime() < referenceDate.getTime() : false;
    const overdueByHours = !isNaN(nextHours) && hoursIndex && hoursIndex.hours >= nextHours;

    if (overdueByDate || overdueByHours) {
      counts.maintenanceOverdue++;
      return;
    }

    const daysToDue = dueDate ? _daysBetweenServer_(referenceDate, dueDate) : null;
    if (daysToDue !== null && daysToDue >= 0 && daysToDue <= 15) counts.maintenanceUpcoming++;
    if ((taskKey && workOrderPlanIndex[`TASK:${taskKey}`]) || (sfiKey && workOrderPlanIndex[`SFI:${sfiKey}`])) {
      counts.maintenanceInProgress++;
    }
  });

  assets.forEach(function(item) {
    const criticality = String(item.Criticidad || "").trim().toUpperCase();
    if (!["A", "B"].includes(criticality)) return;
    if (!_isHealthyAssetStatus_(item.Status)) counts.criticalEquipmentAlerts++;
  });

  spares.forEach(function(item) {
    const stock = parseFloat(item.Stock_Actual || 0);
    const min = parseFloat(item.MIN || 0);
    const rop = parseFloat(item.ROP || 0);
    const computedStatus = _computeSpareStatus_(stock, min);
    if (computedStatus === "ATENCION!") counts.spareOutOfStock++;
    else if (computedStatus === "CRITICO") counts.spareBelowMin++;
    else if (!isNaN(rop) && rop > 0 && stock <= rop) counts.spareReorderPoint++;
  });

  const latestInspectionLogByTask = {};
  inspectionLogs.forEach(function(item) {
    const taskKey = String(item.TaskID || "").trim().toUpperCase();
    if (!taskKey) return;
    const execDate = parseDateServer_(item.Fecha_Ejecucion);
    if (!execDate || _toStartOfDayServer_(execDate).getTime() > referenceDate.getTime()) return;
    const current = latestInspectionLogByTask[taskKey];
    if (!current || execDate.getTime() > current.execDate.getTime()) {
      latestInspectionLogByTask[taskKey] = {
        execDate: execDate,
        result: String(item.Resultado || item.Status || "").trim().toUpperCase(),
      };
    }
  });

  inspections.forEach(function(item) {
    const nextDate = parseDateServer_(item.Siguiente_Fecha);
    if (!nextDate) return;
    const inspectionStatus = String(item.Status || "").trim().toUpperCase();
    const frequency = String(item.Frecuencia || "").trim().toUpperCase();
    const latestLog = latestInspectionLogByTask[String(item.TaskID || "").trim().toUpperCase()];
    const latestFailed = latestLog && ["FAIL", "FALLA", "FALLIDA", "FAILED"].includes(latestLog.result);

    if (frequency === "OCASIONAL") {
      if (inspectionStatus === "FALLIDA" || latestFailed) counts.inspectionsFailed++;
      return;
    }

    const diffDays = _daysBetweenServer_(referenceDate, nextDate);
    if (diffDays !== null && diffDays < 0) counts.inspectionsOverdue++;
    else if (diffDays !== null && diffDays <= 15) counts.inspectionsUpcoming++;
    if (inspectionStatus === "FALLIDA" || latestFailed) counts.inspectionsFailed++;
  });

  certificates.forEach(function(item) {
    const dueDate = parseDateServer_(item.Fecha_Vencimiento);
    if (!dueDate) return;
    const diffDays = _daysBetweenServer_(referenceDate, dueDate);
    if (diffDays !== null && diffDays < 0) counts.certificatesExpired++;
    else if (diffDays !== null && diffDays <= 30) counts.certificatesUpcoming++;
  });

  spareOrders.forEach(function(item) {
    if (!_isOpenSpareOrderStatus_(item.Estado || item.Status)) return;
    counts.spareOrdersPending++;
    const eta = parseDateServer_(item.Fecha_Estimada);
    if (eta && _toStartOfDayServer_(eta).getTime() < referenceDate.getTime()) counts.spareOrdersDelayed++;
  });

  deferrals.forEach(function(item) {
    const normalizedStatus = _normalizeStatus_(item.Status || "REQUESTED");
    if (!_isOpenDeferralStatus_(normalizedStatus)) return;
    if (normalizedStatus === "REQUESTED") counts.deferralsPending++;
    if (normalizedStatus === "APPROVED") counts.deferralsApproved++;
    const expiryDate = parseDateServer_(item.Fecha_Vencimiento);
    if (expiryDate && _toStartOfDayServer_(expiryDate).getTime() < referenceDate.getTime()) counts.deferralsExpired++;
  });

  const recurringSfiIndex = {};
  const recurringWindowStart = new Date(referenceDate);
  recurringWindowStart.setDate(recurringWindowStart.getDate() - 365);
  defects.forEach(function(item) {
    const defectDate = _toStartOfDayServer_(item.Fecha_Reporte || item.Date);
    const sfiKey = _normalizeDailySummaryVesselKey_(item.SFI);
    if (!defectDate || !sfiKey) return;
    if (defectDate.getTime() < recurringWindowStart.getTime()) return;
    recurringSfiIndex[sfiKey] = (recurringSfiIndex[sfiKey] || 0) + 1;
  });

  defects.forEach(function(item) {
    if (!_isOpenDefectStatus_(item.Status)) return;
    counts.defectsOpen++;
    const criticality = String(item.Clasificacion_Falla || "").trim().toUpperCase();
    if (criticality === "A" || criticality === "B") counts.defectsCritical++;
    const sfiKey = _normalizeDailySummaryVesselKey_(item.SFI);
    if (sfiKey && recurringSfiIndex[sfiKey] >= 2) counts.defectsRecurring++;
  });

  const summaryLines = [];
  _addSummaryLine_(summaryLines, `Plan de mantenimiento: ${counts.maintenanceOverdue} vencidas, ${counts.maintenanceUpcoming} proximas, ${counts.maintenanceInProgress} en proceso.`);
  _addSummaryLine_(summaryLines, `Equipos criticos: ${counts.criticalEquipmentAlerts} equipos A/B con condicion degradada o fuera de servicio.`);
  _addSummaryLine_(summaryLines, `Repuestos criticos: ${counts.spareOutOfStock} sin stock, ${counts.spareBelowMin} bajo minimo, ${counts.spareReorderPoint} en punto de reorden.`);
  _addSummaryLine_(summaryLines, `Inspecciones periodicas: ${counts.inspectionsOverdue} vencidas, ${counts.inspectionsUpcoming} proximas, ${counts.inspectionsFailed} fallidas.`);
  _addSummaryLine_(summaryLines, `Ordenes de trabajo: ${counts.workOrdersOpen} abiertas, ${counts.workOrdersOverdue} vencidas, ${counts.workOrdersPendingDeferral} DEF Pend., ${counts.workOrdersDeferred} diferidas, ${counts.workOrdersWaiting} en espera.`);
  _addSummaryLine_(summaryLines, `Certificados: ${counts.certificatesExpired} vencidos, ${counts.certificatesUpcoming} proximos a vencer.`);
  _addSummaryLine_(summaryLines, `Pedidos de repuestos: ${counts.spareOrdersPending} pendientes, ${counts.spareOrdersDelayed} atrasados.`);
  _addSummaryLine_(summaryLines, `Diferimientos: ${counts.deferralsPending} pendientes de aprobacion, ${counts.deferralsApproved} autorizados, ${counts.deferralsExpired} vencidos.`);
  _addSummaryLine_(summaryLines, `Fallas: ${counts.defectsOpen} abiertas, ${counts.defectsCritical} criticas, ${counts.defectsRecurring} recurrentes.`);

  let severity = "NORMAL";
  if (
    counts.certificatesExpired > 0 ||
    counts.deferralsExpired > 0 ||
    counts.defectsCritical > 0 ||
    counts.workOrdersOverdue > 0 ||
    counts.maintenanceOverdue > 0 ||
    counts.inspectionsOverdue > 0 ||
    counts.criticalEquipmentAlerts > 0
  ) {
    severity = "CRITICO";
  } else if (
    counts.certificatesUpcoming > 0 ||
    counts.spareOutOfStock > 0 ||
    counts.spareBelowMin > 0 ||
    counts.spareOrdersDelayed > 0 ||
    counts.deferralsPending > 0 ||
    counts.inspectionsUpcoming > 0 ||
    counts.workOrdersWaiting > 0 ||
    counts.workOrdersPendingDeferral > 0 ||
    counts.defectsOpen > 0
  ) {
    severity = "ATENCION";
  }

  const recommendations = [];
  if (counts.maintenanceOverdue > 0) recommendations.push("Programar o ejecutar las tareas del plan de mantenimiento vencidas.");
  if (counts.criticalEquipmentAlerts > 0) recommendations.push("Revisar la condicion operativa de los equipos criticos A/B con alertas activas.");
  if (counts.spareOutOfStock > 0 || counts.spareBelowMin > 0) recommendations.push("Priorizar la reposicion de repuestos criticos sin stock o bajo minimo.");
  if (counts.inspectionsOverdue > 0 || counts.inspectionsFailed > 0) recommendations.push("Ejecutar o escalar las inspecciones periodicas vencidas y las fallidas.");
  if (counts.workOrdersOverdue > 0) recommendations.push("Escalar las ordenes de trabajo vencidas y revisar recursos para su cierre.");
  if (counts.workOrdersPendingDeferral > 0 || counts.deferralsPending > 0) recommendations.push("Gestionar la aprobacion de diferimientos pendientes de evaluacion.");
  if (counts.certificatesExpired > 0 || counts.certificatesUpcoming > 0) recommendations.push("Revisar los certificados vencidos o proximos a vencer y definir accion documental.");
  if (counts.spareOrdersDelayed > 0) recommendations.push("Hacer seguimiento a los pedidos de repuestos con fecha estimada vencida.");
  if (counts.defectsCritical > 0 || counts.defectsRecurring > 0) recommendations.push("Atender las fallas criticas y analizar las recurrentes para definir RCA o CAPA.");
  if (!recommendations.length) recommendations.push("Mantener el monitoreo diario; no se detectaron excepciones operacionales relevantes.");

  return {
    success: true,
    vesselName: vesselName,
    reportDate: Utilities.formatDate(referenceDate, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    severity: severity,
    summaryText: summaryLines.join("\n"),
    recommendationsText: recommendations.join("\n"),
    summaryJson: {
      vesselName: vesselName,
      reportDate: Utilities.formatDate(referenceDate, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      severity: severity,
      counts: counts,
      recommendations: recommendations,
    },
    recommendations: recommendations,
  };
}

function _buildDailyMaintenanceInsightsContext_(vesselName, reportDate) {
  const vesselKey = _normalizeDailySummaryVesselKey_(vesselName);
  const referenceDate = _toStartOfDayServer_(reportDate) || _toStartOfDayServer_(new Date());
  if (!vesselKey || !referenceDate) {
    return {
      success: false,
      message: 'Embarcación y fecha son obligatorias para analizar históricos de mantenimiento.',
    };
  }

  const windowStart = new Date(referenceDate);
  windowStart.setDate(windowStart.getDate() - 180);

  const summary = _buildDailyExecutiveSummary_(vesselName, reportDate);
  if (!summary.success) return summary;

  const maintenancePlan = (readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey && _isTruthyOperationalFlag_(item.Activo);
  });
  const assets = (readTable(DB_CONFIG.TABLES.ASSETS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const workOrders = (readTable(DB_CONFIG.TABLES.WORK_ORDERS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const defects = (readTable(DB_CONFIG.TABLES.DEFECT_LOG) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.Embarcacion) === vesselKey;
  });
  const deferrals = (readTable(DB_CONFIG.TABLES.DEFERRALS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.Embarcacion) === vesselKey;
  });
  const inspections = (readTable(DB_CONFIG.TABLES.INSPECTIONS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey && _isTruthyOperationalFlag_(item.Activo);
  });
  const inspectionLogs = (readTable(DB_CONFIG.TABLES.INSPECTIONS_LOG) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const spares = (readTable(DB_CONFIG.TABLES.SPARES) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const spareOrders = (readTable(DB_CONFIG.TABLES.SPARE_ORDERS) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });
  const certificates = (readTable(DB_CONFIG.TABLES.CERTIFICATES) || []).filter(function(item) {
    return _normalizeDailySummaryVesselKey_(item.VesselName) === vesselKey;
  });

  const assetNamesBySfi = {};
  assets.forEach(function(item) {
    const sfiKey = _normalizeDailySummaryVesselKey_(item.SFI || item.ASSET_ID);
    if (sfiKey && !assetNamesBySfi[sfiKey]) {
      assetNamesBySfi[sfiKey] = String(item.Nombre_Funcional || item.Equipo_ID || item.SFI || '').trim();
    }
  });

  const recentDefectCounts = {};
  defects.forEach(function(item) {
    const defectDate = _toStartOfDayServer_(item.Fecha_Reporte || item.Date);
    if (!defectDate || defectDate.getTime() < windowStart.getTime()) return;
    const sfiKey = _normalizeDailySummaryVesselKey_(item.SFI);
    if (!sfiKey) return;
    if (!recentDefectCounts[sfiKey]) recentDefectCounts[sfiKey] = { count: 0, latestStatus: '', description: '', name: assetNamesBySfi[sfiKey] || '' };
    recentDefectCounts[sfiKey].count++;
    recentDefectCounts[sfiKey].latestStatus = String(item.Status || '').trim();
    if (!recentDefectCounts[sfiKey].description) recentDefectCounts[sfiKey].description = String(item.Descripcion_Sintoma || '').trim();
  });

  const recentWorkOrderCounts = {};
  workOrders.forEach(function(item) {
    const otDate = _toStartOfDayServer_(item.OpenDate || item.PlannedDate || item.Fecha_Vencimiento_OT);
    if (!otDate || otDate.getTime() < windowStart.getTime()) return;
    const sfiKey = _normalizeDailySummaryVesselKey_(item.AssetID || item.SFI);
    if (!sfiKey) return;
    if (!recentWorkOrderCounts[sfiKey]) recentWorkOrderCounts[sfiKey] = { count: 0, openCount: 0, overdueCount: 0, waitingCount: 0, name: assetNamesBySfi[sfiKey] || '' };
    const normalizedStatus = _normalizeStatus_(item.Status || 'OPEN');
    recentWorkOrderCounts[sfiKey].count++;
    if (normalizedStatus !== 'CLOSED' && normalizedStatus !== 'CANCELLED') recentWorkOrderCounts[sfiKey].openCount++;
    if (normalizedStatus === 'WAITING_SPARES' || normalizedStatus === 'WAITING_VENDOR') recentWorkOrderCounts[sfiKey].waitingCount++;
    const dueBase = parseDateServer_(item.Fecha_Vencimiento_OT || item.PlannedDate);
    if (dueBase && _toStartOfDayServer_(dueBase).getTime() < referenceDate.getTime() && normalizedStatus !== 'CLOSED' && normalizedStatus !== 'CANCELLED' && normalizedStatus !== 'DEFERRED') {
      recentWorkOrderCounts[sfiKey].overdueCount++;
    }
  });

  const recentDeferralCounts = {};
  deferrals.forEach(function(item) {
    const reqDate = _toStartOfDayServer_(item.Fecha_Solicitud || item.Fecha_Vencimiento);
    if (!reqDate || reqDate.getTime() < windowStart.getTime()) return;
    const sfiKey = _normalizeDailySummaryVesselKey_(item.SFI);
    if (!sfiKey) return;
    if (!recentDeferralCounts[sfiKey]) recentDeferralCounts[sfiKey] = { count: 0, approvedCount: 0, pendingCount: 0, name: assetNamesBySfi[sfiKey] || '' };
    recentDeferralCounts[sfiKey].count++;
    const st = _normalizeStatus_(item.Status || 'REQUESTED');
    if (st === 'APPROVED') recentDeferralCounts[sfiKey].approvedCount++;
    if (st === 'REQUESTED') recentDeferralCounts[sfiKey].pendingCount++;
  });

  const failedInspections = [];
  const latestInspectionLogByTask = {};
  inspectionLogs.forEach(function(item) {
    const taskKey = String(item.TaskID || '').trim().toUpperCase();
    if (!taskKey) return;
    const execDate = _toStartOfDayServer_(item.Fecha_Ejecucion);
    if (!execDate || execDate.getTime() < windowStart.getTime()) return;
    if (!latestInspectionLogByTask[taskKey] || execDate.getTime() > latestInspectionLogByTask[taskKey].date.getTime()) {
      latestInspectionLogByTask[taskKey] = {
        date: execDate,
        result: String(item.Resultado || item.Status || '').trim().toUpperCase(),
      };
    }
  });
  inspections.forEach(function(item) {
    const taskKey = String(item.TaskID || '').trim().toUpperCase();
    const latestLog = latestInspectionLogByTask[taskKey];
    const result = latestLog ? latestLog.result : String(item.Status || '').trim().toUpperCase();
    if (['FAIL', 'FALLA', 'FALLIDA', 'FAILED'].includes(result)) {
      failedInspections.push({
        taskId: item.TaskID || '-',
        sfi: item.SFI || '-',
        description: item.Descripcion_Prueba || '-',
      });
    }
  });

  const sparePressure = spares.filter(function(item) {
    const stockStatus = _computeSpareStatus_(item.Stock_Actual, item.MIN);
    return stockStatus !== 'OK';
  }).slice(0, 10).map(function(item) {
    return {
      sku: item.SKU || '-',
      spare: item.Nombre_Funcional || '-',
      sfi: item.SFI || '-',
      stock: item.Stock_Actual || '0',
      min: item.MIN || '0',
      status: _computeSpareStatus_(item.Stock_Actual, item.MIN),
    };
  });

  const delayedOrders = spareOrders.filter(function(item) {
    if (!_isOpenSpareOrderStatus_(item.Estado || item.Status)) return false;
    const eta = _toStartOfDayServer_(item.Fecha_Estimada);
    return eta && eta.getTime() < referenceDate.getTime();
  }).slice(0, 10).map(function(item) {
    return {
      orderId: item.OrderID || '-',
      sku: item.SKU || '-',
      spare: item.Repuesto || '-',
      eta: item.Fecha_Estimada || '-',
      status: item.Estado || item.Status || '-',
    };
  });

  const certificateAlerts = certificates.filter(function(item) {
    const dueDate = parseDateServer_(item.Fecha_Vencimiento);
    if (!dueDate) return false;
    const diff = _daysBetweenServer_(referenceDate, dueDate);
    return diff !== null && diff <= 30;
  }).slice(0, 10).map(function(item) {
    return {
      certificate: item.Certificado || item.Numero || '-',
      dueDate: item.Fecha_Vencimiento || '-',
      status: item.Status || '-',
    };
  });

  const overdueMaintenance = maintenancePlan.filter(function(item) {
    const dueDate = parseDateServer_(item.Siguiente_Vencimiento_Fecha || item.Siguiente_Fecha || item.Vencimiento);
    return dueDate && _toStartOfDayServer_(dueDate).getTime() < referenceDate.getTime();
  }).slice(0, 10).map(function(item) {
    return {
      taskId: item.TaskID || '-',
      sfi: item.SFI || '-',
      task: item.Tarea_Mantenimiento || '-',
      dueDate: item.Siguiente_Vencimiento_Fecha || item.Siguiente_Fecha || item.Vencimiento || '-',
      criticidad: item.Criticidad || '-',
    };
  });

  return {
    success: true,
    context: {
      vesselName: vesselName,
      reportDate: Utilities.formatDate(referenceDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      historicalWindowDays: 180,
      executiveSummary: {
        severity: summary.severity,
        text: summary.summaryText,
        counts: summary.summaryJson && summary.summaryJson.counts ? summary.summaryJson.counts : {},
      },
      recurringDefectsBySfi: _sortAndLimitByCount_(recentDefectCounts, 8, function(item) {
        return {
          sfi: item.key,
          equipment: item.name || item.key,
          defectCount180d: item.count,
          latestStatus: item.latestStatus || '-',
          sampleSymptom: item.description || '-',
        };
      }),
      workOrderPressureBySfi: _sortAndLimitByCount_(recentWorkOrderCounts, 8, function(item) {
        return {
          sfi: item.key,
          equipment: item.name || item.key,
          workOrders180d: item.count,
          openWorkOrders: item.openCount || 0,
          overdueWorkOrders: item.overdueCount || 0,
          waitingWorkOrders: item.waitingCount || 0,
        };
      }),
      deferralPressureBySfi: _sortAndLimitByCount_(recentDeferralCounts, 8, function(item) {
        return {
          sfi: item.key,
          equipment: item.name || item.key,
          deferrals180d: item.count,
          approvedDeferrals: item.approvedCount || 0,
          pendingDeferrals: item.pendingCount || 0,
        };
      }),
      failedInspections: failedInspections.slice(0, 8),
      overdueMaintenance: overdueMaintenance,
      sparePressure: sparePressure,
      delayedSpareOrders: delayedOrders,
      certificateAlerts: certificateAlerts,
    },
  };
}

function _apiGetDailyReports() {
  return readTable(DB_CONFIG.TABLES.DAILY_REPORTS);
}

function _apiBuildDailyExecutiveSummary(vesselName, reportDate) {
  _requireAuthenticatedUser_();
  return _buildDailyExecutiveSummary_(vesselName, reportDate);
}

function _apiGetDailyHoursIndex() {
  const rows = readTable(DB_CONFIG.TABLES.DAILY_REPORTS) || [];
  const machinePrefixes = ["MP1", "MP2", "MP3", "MP4", "MG1", "MG2", "MG3", "MG4"];
  const latestHoursByVessel = {};
  const latestHoursBySFI = {};

  rows.forEach(function(row) {
    const vessel = String(row.VesselName || row.Embarcacion || "").trim().toUpperCase();
    if (!vessel) return;

    const date = String(row.Date || row.Fecha || "2000-01-01").trim() || "2000-01-01";
    const time = String(row.Time || row.Hora || "00:00").trim() || "00:00";
    const stamp = new Date(`${date}T${time}`);
    const validStamp = isNaN(stamp.getTime()) ? new Date("2000-01-01T00:00") : stamp;

    const totalHours = machinePrefixes.reduce(function(sum, prefix) {
      return sum + (parseFloat(row[`${prefix}_Current_Hours`]) || 0);
    }, 0);

    if (!latestHoursByVessel[vessel] || validStamp > new Date(latestHoursByVessel[vessel].stamp)) {
      latestHoursByVessel[vessel] = { hours: totalHours, stamp: validStamp.toISOString() };
    }

    machinePrefixes.forEach(function(prefix) {
      const sfi = String(row[`${prefix}_SFI`] || "").trim().toUpperCase();
      if (!sfi) return;
      const hours = parseFloat(row[`${prefix}_Current_Hours`]) || 0;
      const key = `${vessel}_${sfi}`;
      if (!latestHoursBySFI[key] || validStamp > new Date(latestHoursBySFI[key].stamp)) {
        latestHoursBySFI[key] = { hours: hours, stamp: validStamp.toISOString() };
      }
    });
  });

  return {
    latestHoursByVessel: latestHoursByVessel,
    latestHoursBySFI: latestHoursBySFI,
  };
}

/**
 * Retorna un reporte diario plano (una sola fila)
 */
function _apiGetDetailedDailyReport(reportId) {
  return readTable(DB_CONFIG.TABLES.DAILY_REPORTS).find(
    (r) => r.ReportID === reportId,
  ) || null;
}

function _createDailyReportPdfFile_(payload) {
  _requireAuthenticatedUser_();
  payload = payload || {};

  const reportId = String(payload.ReportID || 'REP-SIN-ID').trim();
  const vessel = String(payload.VesselName || '-').trim();
  const reportDate = String(payload.Date || '-').trim();
  const reportTime = String(payload.Time || '-').trim();
  const fileName = _sanitizeDriveFilename_(`${reportId}-DAILY-${vessel}-${reportDate}`) + '.pdf';
  const rootFolder = DriveApp.getFolderById(
    _resolveApprovedUploadFolderId_(DB_CONFIG.EVIDENCE_FOLDER_ID),
  );
  const folder = _getOrCreateSubfolder_(rootFolder, 'DAILY_REPORTS');

  const doc = DocumentApp.create('TMP_' + fileName.replace(/\.pdf$/i, ''));
  const body = doc.getBody();
  body.setMarginTop(36);
  body.setMarginBottom(36);
  body.setMarginLeft(42);
  body.setMarginRight(42);

  const title = body.appendParagraph('REPORTE DIARIO DE OPERACIONES');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setBold(true);
  title.setForegroundColor('#0f172a');
  title.setSpacingAfter(2);

  const subtitle = body.appendParagraph('Resumen operacional diario y snapshot ejecutivo de la embarcacion');
  subtitle.setForegroundColor('#475569');
  subtitle.setSpacingAfter(14);

  const summaryTable = body.appendTable([
    ['ReportID', reportId, 'Estado', String(payload.Status || '-')],
    ['Embarcacion', vessel, 'Fecha', reportDate],
    ['Hora', reportTime, 'Informante', String(payload.Reporter || '-')],
    ['Viaje', String(payload.Voyage_Number || '-'), 'Posicion', String(payload.Position || '-')],
    ['Estado operativo', String(payload.Operational_Status || '-'), 'Severidad resumen', String(payload.Executive_Summary_Status || '-')],
  ]);
  summaryTable.setBorderWidth(1);

  for (var r = 0; r < summaryTable.getNumRows(); r++) {
    for (var c = 0; c < summaryTable.getRow(r).getNumCells(); c++) {
      var cell = summaryTable.getRow(r).getCell(c);
      cell.setPaddingTop(6).setPaddingBottom(6).setPaddingLeft(8).setPaddingRight(8);
      if (c % 2 === 0) {
        cell.setBackgroundColor('#e2e8f0');
        cell.editAsText().setBold(true).setForegroundColor('#0f172a');
      } else {
        cell.setBackgroundColor('#ffffff');
        cell.editAsText().setForegroundColor('#1e293b');
      }
    }
  }

  _appendSectionTitle_(body, 'Horas y estado de equipos');
  const machinePrefixes = DAILY_REPORT_MAIN_SLOT_PREFIXES.concat(DAILY_REPORT_GENERATOR_SLOT_PREFIXES);
  const machineRows = [['Slot', 'Equipo', 'SFI', 'Horas anteriores', 'Horas actuales', 'Horas operadas', 'Estado']];
  machinePrefixes.forEach(function(prefix) {
    const equipment = String(payload[`${prefix}_Equipment`] || '').trim();
    const sfi = String(payload[`${prefix}_SFI`] || '').trim();
    if (!equipment && !sfi) return;
    machineRows.push([
      prefix,
      equipment || '-',
      sfi || '-',
      String(payload[`${prefix}_Previous_Hours`] || '-'),
      String(payload[`${prefix}_Current_Hours`] || '-'),
      String(payload[`${prefix}_Operated_Hours`] || '-'),
      String(payload[`${prefix}_General_Status`] || '-'),
    ]);
  });
  if (machineRows.length > 1) {
    const machineTable = body.appendTable(machineRows);
    machineTable.setBorderWidth(1);
  } else {
    _appendLabeledParagraph_(body, 'Equipos monitoreados', '-');
  }

  _appendSectionTitle_(body, 'Tanques');
  DAILY_REPORT_FUEL_TANK_PREFIXES.concat(DAILY_REPORT_OIL_TANK_PREFIXES).forEach(function(prefix) {
    const equipment = String(payload[`${prefix}_Equipment`] || '').trim();
    const sfi = String(payload[`${prefix}_SFI`] || '').trim();
    if (!equipment && !sfi) return;
    _appendLabeledParagraph_(body, `${prefix}`, `${equipment || '-'} | ${sfi || '-'} | Sondaje: ${payload[`${prefix}_Sounding`] || '-'}`);
  });

  _appendSectionTitle_(body, 'Observaciones');
  const observations = body.appendParagraph(String(payload.Observaciones || '-'));
  observations.setForegroundColor('#1e293b');
  observations.setSpacingAfter(8);
  observations.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);

  _appendSectionTitle_(body, 'Resumen Ejecutivo Automatico');
  _appendLabeledParagraph_(body, 'Severidad general', payload.Executive_Summary_Status || '-');
  _appendBulletList_(body, payload.Executive_Summary_Text);

  _appendSectionTitle_(body, 'Recomendaciones del sistema');
  _appendBulletList_(body, payload.System_Recommendations_Text);

  _appendSectionTitle_(body, 'Analisis para optimizar el sistema de gestion de mantenimiento');
  _appendLabeledParagraph_(body, 'Prioridad de optimizacion', payload.IA_Maintenance_Priority || '-');
  _appendLabeledParagraph_(body, 'Fecha analisis', payload.IA_Maintenance_Analyzed_At || '-');
  _appendSectionTitle_(body, 'Hallazgos');
  _appendBulletList_(body, payload.IA_Maintenance_Insights_Text);
  _appendSectionTitle_(body, 'Recomendaciones');
  _appendBulletList_(body, payload.IA_Maintenance_Recommendations_Text);

  _appendSectionTitle_(body, 'Control documental');
  _appendLabeledParagraph_(body, 'Generado por', _requireAuthenticatedUser_().EMAIL);
  _appendLabeledParagraph_(body, 'Fecha de emision', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm'));

  const footer = body.appendParagraph('Mercurio PMS - Reporte diario emitido para control operacional interno.');
  footer.setForegroundColor('#64748b');
  footer.setItalic(true);
  footer.setSpacingBefore(18);
  footer.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);

  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(fileName);
  const pdfFile = folder.createFile(pdfBlob);
  docFile.setTrashed(true);

  return {
    success: true,
    fileId: pdfFile.getId(),
    name: pdfFile.getName(),
    url: pdfFile.getUrl(),
    previewUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/preview',
  };
}

/**
 * Guarda un reporte diario plano en una sola fila de DAILY_REPORTS
 */
function _apiSaveDeepDailyReport(rowIndex, payload, options) {
  const t = DB_CONFIG.TABLES;
  payload = payload || {};
  options = options || {};
  let reportId = payload.ReportID;
  const isEdit = rowIndex !== null && rowIndex !== undefined;
  const finalizeReport = options.finalizeReport === true;
  const recomputeExecutiveSummary = options.recomputeExecutiveSummary === true;
  const recomputeMaintenanceInsights = options.recomputeMaintenanceInsights === true;
  const generatePdf = options.generatePdf === true;
  const updateMachineHours = options.updateMachineHours === true;

  if (finalizeReport && (!payload.Status || payload.Status === "BORRADOR")) {
    payload.Status = "ENVIADO";
  } else if (!payload.Status) {
    payload.Status = "BORRADOR";
  }

  if (!payload.Date) {
    const now = new Date();
    payload.Date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  if (!payload.Time) {
    payload.Time = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
  }

  let summary = null;
  if (recomputeExecutiveSummary) {
    summary = _buildDailyExecutiveSummary_(payload.VesselName, payload.Date);
    if (!summary.success) {
      return { success: false, message: summary.message || 'No se pudo generar el resumen ejecutivo del reporte diario.' };
    }

    payload.Executive_Summary_Status = summary.severity;
    payload.Executive_Summary_Text = summary.summaryText;
    payload.Executive_Summary_JSON = JSON.stringify(summary.summaryJson || {});
    payload.System_Recommendations_Text = summary.recommendationsText;
    payload.System_Recommendations_JSON = JSON.stringify(summary.recommendations || []);
    payload.Executive_Summary_Generated_At = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
  }

  let maintenanceInsights = null;
  if (recomputeMaintenanceInsights) {
    maintenanceInsights = apiAnalyzeDailyMaintenanceInsights(payload.VesselName, payload.Date);
    if (maintenanceInsights && maintenanceInsights.success) {
      payload.IA_Maintenance_Priority = maintenanceInsights.priority || 'NORMAL';
      payload.IA_Maintenance_Insights_Text = maintenanceInsights.insightsText || '';
      payload.IA_Maintenance_Recommendations_Text = maintenanceInsights.recommendationsText || '';
      payload.IA_Maintenance_Insights_JSON = JSON.stringify(maintenanceInsights.insightsJson || {});
      payload.IA_Maintenance_Analyzed_At = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
    } else {
      payload.IA_Maintenance_Priority = 'NO DISPONIBLE';
      payload.IA_Maintenance_Insights_Text = maintenanceInsights && maintenanceInsights.message
        ? `No se pudo generar el analisis de mantenimiento: ${maintenanceInsights.message}`
        : 'No se pudo generar el analisis de mantenimiento para este reporte.';
      payload.IA_Maintenance_Recommendations_Text = 'Puedes guardar o enviar el reporte igual; este analisis no es bloqueante.';
      payload.IA_Maintenance_Insights_JSON = JSON.stringify({
        success: false,
        message: maintenanceInsights && maintenanceInsights.message ? maintenanceInsights.message : 'Analisis no disponible.',
      });
      payload.IA_Maintenance_Analyzed_At = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
    }
  }

  DAILY_REPORT_MAIN_SLOT_PREFIXES.concat(DAILY_REPORT_GENERATOR_SLOT_PREFIXES).forEach(function(prefix) {
    const prev = parseFloat(payload[`${prefix}_Previous_Hours`] || 0);
    const currRaw = payload[`${prefix}_Current_Hours`];
    const curr = parseFloat(currRaw || 0);
    if (String(currRaw || "").trim()) {
      payload[`${prefix}_Operated_Hours`] = Math.max(curr - prev, 0);
    }
    if (!payload[`${prefix}_General_Status`]) {
      payload[`${prefix}_General_Status`] = "OPERACION NORMAL";
    }
  });

  let saveResult = null;
  if (isEdit) {
    saveResult = updateRecord(t.DAILY_REPORTS, rowIndex, payload);
    if (!saveResult || saveResult.success === false) {
      return saveResult || { success: false, message: 'No se pudo actualizar el reporte diario.' };
    }
  } else {
    reportId = _getNextId(t.DAILY_REPORTS, "REP-", "ReportID", 6);
    payload.ReportID = reportId;
    saveResult = createRecord(t.DAILY_REPORTS, payload);
    if (!saveResult || saveResult.success === false) {
      return saveResult || { success: false, message: 'No se pudo crear el reporte diario.' };
    }
  }

  const savedReport = readTable(t.DAILY_REPORTS).find(function(item) {
    return String(item.ReportID || '').trim() === String(payload.ReportID || reportId || '').trim();
  }) || null;
  const savedRowIndex = isEdit ? rowIndex : (savedReport ? savedReport._rowIndex : null);

  let pdfResult = null;
  if (generatePdf) {
    pdfResult = _createDailyReportPdfFile_(payload);
    payload.Report_PDF_Link = pdfResult.url;
    if (savedRowIndex !== null && savedRowIndex !== undefined) {
      const pdfUpdateResult = updateRecord(t.DAILY_REPORTS, savedRowIndex, {
        Report_PDF_Link: pdfResult.url,
        Executive_Summary_Status: payload.Executive_Summary_Status,
        Executive_Summary_Text: payload.Executive_Summary_Text,
        Executive_Summary_JSON: payload.Executive_Summary_JSON,
        System_Recommendations_Text: payload.System_Recommendations_Text,
        System_Recommendations_JSON: payload.System_Recommendations_JSON,
        Executive_Summary_Generated_At: payload.Executive_Summary_Generated_At,
        IA_Maintenance_Priority: payload.IA_Maintenance_Priority,
        IA_Maintenance_Insights_Text: payload.IA_Maintenance_Insights_Text,
        IA_Maintenance_Recommendations_Text: payload.IA_Maintenance_Recommendations_Text,
        IA_Maintenance_Insights_JSON: payload.IA_Maintenance_Insights_JSON,
        IA_Maintenance_Analyzed_At: payload.IA_Maintenance_Analyzed_At,
      });
      if (!pdfUpdateResult || pdfUpdateResult.success === false) {
        return pdfUpdateResult || { success: false, message: 'El reporte diario se guardó, pero no se pudo registrar el PDF.' };
      }
    }
  }

  const machineUpdates = DAILY_REPORT_MAIN_SLOT_PREFIXES.concat(DAILY_REPORT_GENERATOR_SLOT_PREFIXES)
    .map(function(prefix) {
      return {
        sfi: payload[`${prefix}_SFI`],
        hours: payload[`${prefix}_Current_Hours`],
      };
    })
    .filter(function(item) {
      return String(item.sfi || "").trim() && String(item.hours || "").trim();
    });

  if (updateMachineHours && machineUpdates.length) {
    _updateMultipleAssetHours(machineUpdates);
  }

  return {
    success: true,
    ReportID: reportId,
    rowIndex: savedRowIndex,
    summary: summary,
    maintenanceInsights: maintenanceInsights,
    pdfUrl: pdfResult ? pdfResult.url : '',
    pdfPreviewUrl: pdfResult ? pdfResult.previewUrl : '',
    pdfName: pdfResult ? pdfResult.name : '',
  };
}

/**
 * Optimización: Actualiza horas de múltiples activos de una sola vez
 */
function _updateMultipleAssetHours(updates) {
  if (!updates || !updates.length) return;
  try {
    const tableName = DB_CONFIG.TABLES.MAINTENANCE_PLAN;
    const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
    const sheet = getOrCreateSheet(ss, tableName);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colTaskID = headers.indexOf("TaskID");
    const colSFI = headers.indexOf("SFI");
    const colHs = headers.indexOf("Ultima_Ejecucion_HS");

    if (colSFI === -1 || colHs === -1) return;

    let modified = false;
    updates.forEach((upd) => {
      if (!upd.sfi || !upd.hours) return;
      for (let i = 1; i < data.length; i++) {
        if (data[i][colSFI] == upd.sfi) {
          data[i][colHs] = upd.hours;
          modified = true;
        }
      }
    });

    if (modified) {
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
      delete _cacheReadTable[tableName];
    }
  } catch (e) {
    console.error("Error en _updateMultipleAssetHours:", e);
  }
}

/**
 * BORRADO POR LOTES: Elimina registros que coincidan con un filtro.
 * Optimizado: Evita deleteRow() uno por uno.
 */
function deleteRecordsBatch(tableName, fieldName, value) {
  try {
    const user = _requireAuthenticatedUser_();
    _assertCanWriteTable_(user, tableName);
    const ss = _getSsInstance(getSpreadsheetIdForTable(tableName));
    const sheet = getOrCreateSheet(ss, tableName);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;

    const headers = data[0];
    const colIdx = headers.indexOf(fieldName);
    if (colIdx === -1) return;
    const scopedTable = _tableUsesScopedAccess_(headers);

    const newData = [headers];
    let modified = false;

    for (let i = 1; i < data.length; i++) {
      if (data[i][colIdx] != value) {
        newData.push(data[i]);
      } else {
        if (scopedTable && !_canWriteAllScopes_(user)) {
          assertAssetAccess(user, _rowToObject_(headers, data[i]));
        }
        modified = true;
      }
    }

    if (modified) {
      sheet.clearContents();
      sheet.getRange(1, 1, newData.length, headers.length).setValues(newData);
      delete _cacheReadTable[tableName];
      _logAudit(
        "BATCH_DELETE",
        tableName,
        value,
        "Records cleared for " + fieldName,
      );
    }
  } catch (e) {
    console.error("Error en deleteRecordsBatch:", e);
    throw e;
  }
}

/**
 * Helper para borrar registros por un filtro (Uso interno para re-sincronización)
 * LEGACY: Ahora redirigido al batch para performance.
 */
function _deleteRecordsByFilter(tableName, fieldName, value) {
  return deleteRecordsBatch(tableName, fieldName, value);
}

/**
 * Helper para actualizar horas de un activo por SFI
 */
function _updateAssetHours(sfi, newHours) {
  try {
    const allAssets = readTable(DB_CONFIG.TABLES.ASSETS);
    const asset = allAssets.find((a) => a.SFI == sfi);
    if (asset && asset._rowIndex) {
      // Solo actualizamos si las horas son mayores a las actuales (bloqueado por validación en UI, pero por seguridad...)
      // En este sistema no hay campo 'Running_Hours' en ASSETS, suele estar en MAINTENANCE_PLAN
      // Verificamos en MAINTENANCE_PLAN
      const allPlans = readTable(DB_CONFIG.TABLES.MAINTENANCE_PLAN);
      const plans = allPlans.filter((p) => p.SFI == sfi);
      plans.forEach((p) => {
        updateRecord(DB_CONFIG.TABLES.MAINTENANCE_PLAN, p._rowIndex, {
          Ultima_Ejecucion_HS: newHours,
        });
      });
    }
  } catch (e) {
    console.error("Error actualizando horas de activo:", e);
  }
}

/**
 * API: Sube un archivo a Drive y retorna su URL
 */
function _apiUploadFile(base64Data, fileName, folderId) {
  try {
    _requireAuthenticatedUser_();
    const contentType = base64Data.substring(5, base64Data.indexOf(";"));
    const bytes = Utilities.base64Decode(base64Data.split(",")[1]);
    const blob = Utilities.newBlob(bytes, contentType, fileName);

    const targetFolderId = _resolveApprovedUploadFolderId_(folderId);
    const folder = DriveApp.getFolderById(targetFolderId);
    const file = folder.createFile(blob);

    return { success: true, url: file.getUrl(), name: fileName };
  } catch (e) {
    console.error("Error en apiUploadFile:", e);
    return { success: false, message: e.message };
  }
}

// --- CERTIFICATES (REG-MAN-08) ---
function _apiGetCertificates() {
  return readTable(DB_CONFIG.TABLES.CERTIFICATES);
}

function _apiCreateCertificate(payload) {
  payload = payload || {};
  payload.Estado_Visible = _resolveCertificateVisibleStatus_(payload);
  const result = createRecord(DB_CONFIG.TABLES.CERTIFICATES, payload);
  if (result && result.success) _syncCertificateVisibleStatuses_(null);
  return result;
}

function _apiUpdateCertificate(rowIndex, payload) {
  payload = payload || {};
  const existing = readTable(DB_CONFIG.TABLES.CERTIFICATES).find(function (row) {
    return row._rowIndex === rowIndex;
  }) || {};
  payload.Estado_Visible = _resolveCertificateVisibleStatus_(Object.assign({}, existing, payload));
  const result = updateRecord(DB_CONFIG.TABLES.CERTIFICATES, rowIndex, payload);
  if (result && result.success) _syncCertificateVisibleStatuses_([rowIndex]);
  return result;
}

// --- PROVEEDORES (PROC-MAN-13) ---
function _apiGetProveedores() {
  return readTable(DB_CONFIG.TABLES.PROVEEDORES);
}

function _apiCreateProveedor(payload) {
  const data = readTable(DB_CONFIG.TABLES.PROVEEDORES);
  const currentYear = new Date().getFullYear().toString().substr(-2);
  const currentYearData = data.filter(
    (c) =>
      c.ID_Proveedor &&
      String(c.ID_Proveedor).includes(`PRE-PRV-${currentYear}`),
  );
  const nextId = (currentYearData.length + 1).toString().padStart(3, "0");
  payload.ID_Proveedor = `PRE-PRV-${currentYear}-${nextId}`;
  return createRecord(DB_CONFIG.TABLES.PROVEEDORES, payload);
}

function _apiUpdateProveedor(rowIndex, payload) {
  return updateRecord(DB_CONFIG.TABLES.PROVEEDORES, rowIndex, payload);
}

// --- EVALUACIONES PROVEEDORES (PROC-MAN-13) ---
function _apiGetEvalProveedores() {
  return readTable(DB_CONFIG.TABLES.EVAL_PROVEEDORES);
}

function _apiCreateEvalProveedor(payload) {
  const data = readTable(DB_CONFIG.TABLES.EVAL_PROVEEDORES);
  const currentYear = new Date().getFullYear().toString().substr(-2);
  const currentYearData = data.filter(
    (c) =>
      c.ID_Evaluacion &&
      String(c.ID_Evaluacion).includes(`REV-PRV-${currentYear}`),
  );
  const nextId = (currentYearData.length + 1).toString().padStart(3, "0");
  payload.ID_Evaluacion = `REV-PRV-${currentYear}-${nextId}`;
  return createRecord(DB_CONFIG.TABLES.EVAL_PROVEEDORES, payload);
}

function _apiUpdateEvalProveedor(rowIndex, payload) {
  return updateRecord(DB_CONFIG.TABLES.EVAL_PROVEEDORES, rowIndex, payload);
}

// --- NC PROVEEDORES (PROC-MAN-13) ---
function _apiGetNCProveedores() {
  return readTable(DB_CONFIG.TABLES.NC_PROVEEDORES);
}

function _apiCreateNCProveedor(payload) {
  const data = readTable(DB_CONFIG.TABLES.NC_PROVEEDORES);
  const currentYear = new Date().getFullYear().toString().substr(-2);
  const currentYearData = data.filter(
    (c) =>
      c.ID_NC_Proveedor &&
      String(c.ID_NC_Proveedor).includes(`NC-PRV-${currentYear}`),
  );
  const nextId = (currentYearData.length + 1).toString().padStart(3, "0");
  payload.ID_NC_Proveedor = `NC-PRV-${currentYear}-${nextId}`;
  return createRecord(DB_CONFIG.TABLES.NC_PROVEEDORES, payload);
}

function _apiUpdateNCProveedor(rowIndex, payload) {
  return updateRecord(DB_CONFIG.TABLES.NC_PROVEEDORES, rowIndex, payload);
}

// --- SPARE ORDERS (REG-MAN-11-02) ---

function _apiGetSpareOrders() {
  const ssId = DB_CONFIG.IDS.SPARES_DB;
  const ss = _getSsInstance(ssId);
  const sheet = getOrCreateSheet(ss, DB_CONFIG.TABLES.SPARE_ORDERS);

  ensureHeaders(sheet, DB_CONFIG.TABLES.SPARE_ORDERS);

  // Migración de cabecera: "Estado Pedido" -> "Estado"
  const lastColumn = Math.max(sheet.getLastColumn(), DB_CONFIG.HEADERS.SPARE_ORDERS.length, 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const oldIdx = headers.indexOf("Estado Pedido");
  if (oldIdx !== -1) {
    sheet.getRange(1, oldIdx + 1).setValue("Estado");
  }

  return readTable(DB_CONFIG.TABLES.SPARE_ORDERS);
}

function _applyReceivedSpareOrderToStock_(orderData) {
  const sku = orderData && orderData.SKU;
  const qty = parseFloat((orderData && orderData.Cantidad) || 0) || 0;
  if (!sku || qty <= 0) return;

  const spares = readTable(DB_CONFIG.TABLES.SPARES);
  const spare = spares.find((s) => s.SKU === sku && (!orderData.VesselName || s.VesselName === orderData.VesselName)) ||
    spares.find((s) => s.SKU === sku);
  if (!spare) return;

  const currentStock = parseFloat(spare.Stock_Actual) || 0;
  const newStock = currentStock + qty;
  const min = parseFloat(spare.MIN) || 0;
  const newStatus = _computeSpareStatus_(newStock, min);

  const ssId = DB_CONFIG.IDS.SPARES_DB;
  const ssSc = SpreadsheetApp.openById(ssId);
  const sheet = getOrCreateSheet(ssSc, DB_CONFIG.TABLES.SPARES);
  ensureHeaders(sheet, DB_CONFIG.TABLES.SPARES);

  const headers = DB_CONFIG.HEADERS.SPARES;
  const stockIdx = headers.indexOf("Stock_Actual") + 1;
  const statusIdx = headers.indexOf("Status") + 1;

  if (stockIdx > 0) sheet.getRange(spare._rowIndex, stockIdx).setValue(newStock);
  if (statusIdx > 0) sheet.getRange(spare._rowIndex, statusIdx).setValue(newStatus);

  _logStockMovement(
    orderData.VesselName,
    sku,
    "RECEPCION",
    qty,
    newStock,
    `Orden: ${orderData.OrderID || '-'}`,
  );

  delete _cacheReadTable[DB_CONFIG.TABLES.SPARES];
}

function _apiCreateSpareOrder(payload) {
  payload = payload || {};
  const data = readTable(DB_CONFIG.TABLES.SPARE_ORDERS);
  const currentYear = new Date().getFullYear();
  const nextId = (data.length + 1).toString().padStart(4, "0");
  payload.OrderID = `ORD-${currentYear}-${nextId}`;

  payload.Estado = "PENDIENTE";
  if (!payload.Fecha_Pedido) {
    let now = new Date();
    payload.Fecha_Pedido = `${now.getDate().toString().padStart(2, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getFullYear()}`;
  }

  const result = createRecord(DB_CONFIG.TABLES.SPARE_ORDERS, payload);
  if (result && result.success && payload.Estado === "RECIBIDO") {
    _applyReceivedSpareOrderToStock_(payload);
  }
  return result;
}

function _apiUpdateSpareOrder(rowIndex, payload) {
  payload = payload || {};
  if (payload.Fecha_Recepcion) payload.Estado = "RECIBIDO";

  // --- SYNC WITH SPARES STOCK IF RECEIVED ---
  if (payload.Estado === "RECIBIDO") {
    const orders = readTable(DB_CONFIG.TABLES.SPARE_ORDERS);
    const existing = orders.find((o) => o._rowIndex === rowIndex);

    if (existing && existing.Estado !== "RECIBIDO") {
      _applyReceivedSpareOrderToStock_({
        OrderID: existing.OrderID,
        VesselName: payload.VesselName || existing.VesselName,
        SKU: payload.SKU || existing.SKU,
        Cantidad: payload.Cantidad || existing.Cantidad,
      });
    }
  }

  return updateRecord(DB_CONFIG.TABLES.SPARE_ORDERS, rowIndex, payload);
}

// -------------------------------------------------------------
// VENTA DE API - PUBLIC HTTP/GS EXPORTS (RESTORED)
// -------------------------------------------------------------

function apiCheckSfiRecurrence(a, b, c, d) {
  return _apiCheckSfiRecurrence(a, b, c, d);
}
function apiConsumeSpares(a, b, c, d) {
  return _apiConsumeSpares(a, b, c, d);
}
function apiCreateCAPA(payload) {
  return _apiCreateCAPA(payload);
}
function apiCreateCertificate(payload) {
  return _apiCreateCertificate(payload);
}
function apiCreateDefect(payload) {
  return _apiCreateDefect(payload);
}
function apiCreateDeferral(payload) {
  return _apiCreateDeferral(payload);
}
function apiCreateEvalProveedor(payload) {
  return _apiCreateEvalProveedor(payload);
}
function apiCreateInspection(payload) {
  return _apiCreateInspection(payload);
}
function apiCreateInspectionLog(payload) {
  return _apiCreateInspectionLog(payload);
}
function apiSyncInspectionIDs() {
  return _apiSyncInspectionIDs();
}
function apiCreateInventory(payload) {
  return _apiCreateInventory(payload);
}
function apiCreateMaintenancePlan(payload) {
  return _apiCreateMaintenancePlan(payload);
}
function apiCreateNCProveedor(payload) {
  return _apiCreateNCProveedor(payload);
}
function apiCreateProveedor(payload) {
  return _apiCreateProveedor(payload);
}
function apiCreateRCA(payload) {
  return _apiCreateRCA(payload);
}
function apiCreateSpare(payload) {
  return _apiCreateSpare(payload);
}
function apiCreateSpareOrder(payload) {
  return _apiCreateSpareOrder(payload);
}
function apiCreateVessel(payload) {
  return _apiCreateVessel(payload);
}
function apiCreateWorkOrder(payload) {
  return _apiCreateWorkOrder(payload);
}
function apiGetBarrierAssessment(a, b, c, d) {
  return _apiGetBarrierAssessment(a, b, c, d);
}
function apiGetCAPAs() {
  return _apiGetCAPAs();
}
function apiGetCertificates() {
  return _apiGetCertificates();
}
function apiGetDailyReports(a, b, c, d) {
  return _apiGetDailyReports(a, b, c, d);
}
function apiGetDailyHoursIndex() {
  return _apiGetDailyHoursIndex();
}
function apiGetDefects() {
  return _apiGetDefects();
}
function apiGetDeferrals() {
  return _apiGetDeferrals();
}
function apiGetDetailedDailyReport(a, b, c, d) {
  return _apiGetDetailedDailyReport(a, b, c, d);
}
function apiGetEvalProveedores() {
  return _apiGetEvalProveedores();
}
function apiGetInspections() {
  return _apiGetInspections();
}
function apiGetInspectionsLog(vesselName, limit, offset) {
  return _apiGetInspectionsLog(vesselName, limit, offset);
}
function apiFindLatestInspectionLogByTaskId(taskId) {
  return _apiFindLatestInspectionLogByTaskId(taskId);
}
function apiGetInventory() {
  return _apiGetInventory();
}
function apiGetMaintenancePlan() {
  return _apiGetMaintenancePlan();
}
function apiGetNCProveedores() {
  return _apiGetNCProveedores();
}
function apiGetProveedores() {
  return _apiGetProveedores();
}
function apiGetRCAs() {
  return _apiGetRCAs();
}
function apiGetSpareOrders() {
  return _apiGetSpareOrders();
}
function apiGetSpares() {
  return _apiGetSpares();
}
function apiGetVessels() {
  return _apiGetVessels();
}
function apiGetWorkOrders() {
  return _apiGetWorkOrders();
}
function apiBuildDailyExecutiveSummary(vesselName, reportDate) {
  return _apiBuildDailyExecutiveSummary(vesselName, reportDate);
}
function apiGetWorkOrdersPlanIndex() {
  return _apiGetWorkOrdersPlanIndex();
}
function apiGenerateWorkOrderOpeningPdf(payload) {
  return _apiGenerateWorkOrderOpeningPdf(payload);
}
function apiGenerateWorkOrderClosurePdf(payload) {
  return _apiGenerateWorkOrderClosurePdf(payload);
}
function apiGenerateWorkOrderDeferralRequestPdf(payload) {
  return _apiGenerateWorkOrderDeferralRequestPdf(payload);
}
function apiGenerateSpareOrderRequestPdf(payload) {
  return _apiGenerateSpareOrderRequestPdf(payload);
}
function apiGenerateSpareOrderReceiptPdf(payload) {
  return _apiGenerateSpareOrderReceiptPdf(payload);
}
function apiGenerateDefectPdf(rowIndex, payload) {
  return _apiGenerateDefectPdf(rowIndex, payload);
}
function apiSaveBarrierAssessment(a, b, c, d) {
  return _apiSaveBarrierAssessment(a, b, c, d);
}
function apiSaveDeepDailyReport(a, b, c, d) {
  return _apiSaveDeepDailyReport(a, b, c, d);
}
function apiSyncMaintenanceIDs(a, b, c, d) {
  return _apiSyncMaintenanceIDs(a, b, c, d);
}
function apiSyncMaintenancePlanStatuses(taskIds) {
  return _syncMaintenancePlanStatuses(taskIds);
}
function apiSyncMaintenancePlanOtIds(taskIds) {
  return _apiSyncMaintenancePlanOtIds(taskIds);
}
function apiSyncWorkOrderVisibleStatuses(rowIndexes) {
  return _syncWorkOrderVisibleStatuses(rowIndexes);
}
function apiUpdateCAPA(rowIndex, payload) {
  return _apiUpdateCAPA(rowIndex, payload);
}
function apiUpdateCertificate(rowIndex, payload) {
  return _apiUpdateCertificate(rowIndex, payload);
}
function apiUpdateDefect(rowIndex, payload) {
  return _apiUpdateDefect(rowIndex, payload);
}
function apiUpdateDeferral(rowIndex, payload) {
  return _apiUpdateDeferral(rowIndex, payload);
}
function apiUpdateEvalProveedor(rowIndex, payload) {
  return _apiUpdateEvalProveedor(rowIndex, payload);
}
function apiUpdateInspection(rowIndex, payload) {
  return _apiUpdateInspection(rowIndex, payload);
}
function apiUpdateInventory(rowIndex, payload) {
  return _apiUpdateInventory(rowIndex, payload);
}
function apiUpdateMaintenancePlan(rowIndex, payload) {
  return _apiUpdateMaintenancePlan(rowIndex, payload);
}
function apiUpdateNCProveedor(rowIndex, payload) {
  return _apiUpdateNCProveedor(rowIndex, payload);
}
function apiUpdateProveedor(rowIndex, payload) {
  return _apiUpdateProveedor(rowIndex, payload);
}
function apiUpdateRCA(rowIndex, payload) {
  return _apiUpdateRCA(rowIndex, payload);
}
function apiUpdateSpare(rowIndex, payload) {
  return _apiUpdateSpare(rowIndex, payload);
}
function apiUpdateSpareOrder(rowIndex, payload) {
  return _apiUpdateSpareOrder(rowIndex, payload);
}
function apiUpdateVessel(rowIndex, payload) {
  return _apiUpdateVessel(rowIndex, payload);
}
function apiUpdateWorkOrder(rowIndex, payload) {
  return _apiUpdateWorkOrder(rowIndex, payload);
}
function apiUploadFile(a, b, c, d) {
  return _apiUploadFile(a, b, c, d);
}
