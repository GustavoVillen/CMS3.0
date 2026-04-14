/**
 * SetupDB.js - Script Inicial de Configuración de la Base de Datos
 *
 * NOTA PARA EL USUARIO:
 * 1. Ejecuta la función `initMercurioDatabase` UNA SOLA VEZ desde el editor de Apps Script.
 * 2. Esto creará el Archivo de Base de Datos y la Carpeta de Evidencias en la raíz de tu Drive.
 * 3. Al finalizar, imprimirá los dos IDs que debes copiar y pegar en `DB_CONFIG` de `DB.js`.
 */

function initMercurioDatabase() {
  Logger.log("Iniciando Configuración de Mercurio PMS...");

  // 1. Crear la Base de Datos Relacional (Google Sheet de 9 pestañas)
  const dbName = "MERCURIO_PMS_DB_CORE";
  const ss = SpreadsheetApp.create(dbName);
  const ssId = ss.getId();
  Logger.log("✓ Base de Datos creada. Nombre: " + dbName + " | ID: " + ssId);

  // Definir las tablas base y sus cabeceras
  const tablesStruct = {
    "_USERS": [
      "USER_ID", "EMAIL", "PASSWORD_HASH", "ROLE", "PERMISSIONS", "STATUS",
      "ASSIGNED_ASSET_ID", "ASSIGNED_ASSET_IDS",
      "ASSIGNED_VESSEL", "ASSIGNED_VESSELS",
      "ASSIGNED_UNIT_ID", "ASSIGNED_UNIT_IDS",
      "FAILED_ATTEMPTS", "LOCKED_UNTIL"
    ],
    "VESSELS": [
      "VesselName", "Codigo_Embarcacion", "Armador", "Tipo", "IMO", "Matricula", "Potencia_HP", "DWT_tons",
      "Eslora_m", "Manga_m", "Puntal_m", "TRN_tn", "TRB_tn", "Ano_Construcc",
      "Pais_Construccion", "Fecha_Incorporacion", "Tipo_Incorporacion", "Status",
      "ME1_SFI", "ME2_SFI", "G1_SFI", "G2_SFI", "CP_SFI"
    ],
    "ASSETS": [
      "SFI", "Equipo_ID", "Nombre_Funcional", "VesselName", "Fabricante", "Modelo", "N_Serie",
      "Fecha_Instalacion", "Localizacion", "Compartimento", "Potencia_KW", "Presion_bar",
      "Caudal_m3h", "Temperatura_C", "Medio_Servicio", "Condiciones_Operacion", "Criticidad",
      "Funcion_Critica", "Justificacion_Criticidad", "Evaluado_Por", "Fecha_Evaluacion",
      "Repuestos_Criticos_Stock", "Es_Equipo_Ex", "Certificado_Ex", "Ex_Tipo_Proteccion", "Ex_Grupo_Gas", "Ex_Clase_Temp", "Status"
    ],
    "MAINTENANCE_PLAN": [
      "TaskID", "VesselName", "SFI", "Equipo", "Tarea_Mantenimiento", "Trigger_Tipo", "Responsable", "Evidencia_Requerida", "Criterio_Aceptacion", "Procedimiento_Link", "Activo", "Observaciones", "Frecuencia_HS", "Frecuencia_Meses",
      "Ultima_Ejecucion_Fecha", "Ultima_Ejecucion_HS", "Siguiente_Vencimiento_Fecha", "Siguiente_Vencimiento_HS",
      "Status", "OT_ID", "Criticidad"
    ],
    "WORK_ORDERS": [
      "OT_ID", "TaskID", "VesselName", "AssetID", "Criticidad", "Type", "Priority", "Status",
      "OpenDate", "PlannedDate", "Fecha_Vencimiento_OT", "CompletedDate", "CompletedHours", "Ventana_Tolerancia",
      "Remarks", "Asignado_Por", "Responsable_Ejecutor", "Nombre_Responsable", "Verificador_Independiente", "Repuestos_Consumidos",
      "Resultado_Prueba", "Evidencia_Files", "Estado_Equipo_Post_OT",
      "IA_Plazo_Normal_Dias", "IA_Nivel_Riesgo", "IA_Justificacion_Plazo", "IA_Restriccion_Operativa",
      "Deferral_Required", "Deferral_Justificacion", "Deferral_Medida_Compensatoria", "Deferral_Restricciones",
      "Deferral_Aprobador", "Deferral_Email_Autorizante", "Deferral_Permite_Operacion", "Deferral_Declarado_NoGo", "Deferral_Fecha_Vencimiento",
      "Deferral_Autorizacion_Status", "Deferral_Link_PDF"
    ],
    "DEFECT_LOG": [
      "Defecto_ID", "Fecha_Reporte", "Embarcacion", "SFI", "Clasificacion_Falla",
      "Descripcion_Sintoma", "Accion_Inmediata", "Estado_Operativo", "Requiere_Diferimiento",
      "Medida_Compensatoria", "Fecha_Vencimiento", "Responsable_Correccion", "OT_Asociada",
      "Prueba_Aceptacion_Status", "Evidencia_Files", "Status", "RCA_ID", "Link_PDF"
    ],
    "DEFERRALS": [
      "Deferral_ID", "Fecha_Solicitud", "Defecto_ID", "TaskID_Origen", "OT_Asociada", "Embarcacion", "SFI",
      "Clasificacion", "Motivo", "Medida_Compensatoria", "Restricciones_Operativas", "Fecha_Vencimiento", "Aprobador",
      "Declarado_NoGo", "Permite_Operacion", "Status", "Notas_Cierre", "RCA_ID"
    ],
    "SPARES": [
      "SKU", "SFI", "Nombre_Funcional", "VesselName", "Fabricante", "Modelo", "P_N",
      "Stock_Actual", "MIN", "SS", "ROP", "Ubicacion", "Condicion", "Status",
      "Equipo/Sistema", "Nivel", "EX (Si/No)", "Ubicación", "Lead Time",
      "Fuente_Informacion", "Impacta trazabilidad"
    ],
    "INSPECTIONS": [
      "SFI", "Descripcion_Prueba", "Frecuencia", "FREQS", "FREQM", "Trigger_Tipo", "VesselName", "Responsable", "Evidencia_Requerida", "Criterio_Aceptacion", "Procedimiento_Link", "Activo", "Observaciones", "Ultima_Fecha", "Siguiente_Fecha", "Checklist_Link"
    ],
    "RCA_LOG": [
      "RCA_ID", "Fecha_Evento", "Embarcacion", "Sistema_Equipo", "Tipo_Evento",
      "Lider_RCA", "Descripcion_Evento", "Metodologia_Usada", "Causa_Inmediata",
      "Causa_Contribuyente", "Causa_Raiz", "Barreras_Falladas", "Evidencia_Link",
      "SLA_Vencimiento", "Status"
    ],
    "CAPA_LOG": [
      "CAPA_ID", "Origen_ID", "Embarcacion", "Tipo", "Prioridad", "Descripcion_Accion",
      "Responsable", "Fecha_Compromiso", "Criterio_Aceptacion", "Requiere_Verificacion_Efectividad",
      "Evidencia_Cierre_Link", "Status"
    ],
    "CONDITION_MONITORING": ["CBM_ID", "AssetID", "Date", "Parameter", "Value", "Unit", "Trend", "Alert"],
    "KPI": ["Date", "VesselID", "PMSCompliance", "Backlog", "BacklogCritical", "MTBF", "MTTR", "Availability"]
  };

  const sheetNames = Object.keys(tablesStruct);

  // Crear o renombrar las hojas
  for (let i = 0; i < sheetNames.length; i++) {
    let sheetName = sheetNames[i];
    let sheetHeaders = tablesStruct[sheetName];

    let currentSheet;
    // Si es la primera iteración, renombramos la "Hoja 1" que trae por defecto
    if (i === 0) {
      currentSheet = ss.getActiveSheet();
      currentSheet.setName(sheetName);
    } else {
      currentSheet = ss.insertSheet(sheetName);
    }

    // Insertar cabeceras en el tope
    let headerRange = currentSheet.getRange(1, 1, 1, sheetHeaders.length);
    headerRange.setValues([sheetHeaders]);

    // Dar el primer toque de estilo (Premium/Frozen Headers)
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1e293b"); // Azul Océano oscuro (combinando con la app)
    headerRange.setFontColor("white");
    currentSheet.setFrozenRows(1);

    Logger.log("✓ Tabla configurada: " + sheetName);
  }

  // 2. Crear Carpeta de Evidencias
  const folderName = "MERCURIO_PMS_EVIDENCES";
  const folder = DriveApp.createFolder(folderName);
  const folderId = folder.getId();
  Logger.log("✓ Carpeta de Evidencias creada. Nombre: " + folderName + " | ID: " + folderId);

  // 3. Imprimir el resumen final para copiar/pegar
  Logger.log("=========================================");
  Logger.log("¡Configuración Exitosa!");
  Logger.log("Copia y Pega esto en DB_CONFIG en archivo DB.js:");
  Logger.log("SPREADSHEET_ID: " + ssId);
  Logger.log("EVIDENCE_FOLDER_ID: " + folderId);
  Logger.log("IMPORTANTE: completa la hoja _USERS con EMAIL, ROLE, PERMISSIONS (si aplica), STATUS y scopes autorizados antes de usar la web app.");
  Logger.log("Para acceso con USER_ID/contraseña: asigna USER_ID y luego ejecuta setUserPassword('USER_ID','clave-temporal').");
  Logger.log("Para validar despliegue real: ejecuta bootstrapUsersDirectory(), define la clave con setUserPassword('USER_ID','clave') y luego usa getCurrentAuthorizationDiagnostics() después de iniciar sesión.");
  Logger.log("=========================================");
}

/**
 * SetupDB.js - Script para Inicializar Hoja de Proveedores
 * Ejecuta la función `initProveedoresDatabase` UNA SOLA VEZ desde el editor
 * y pega el ID resultante en `PROVEEDORES_DB` dentro de `DB.js`.
 */
function initProveedoresDatabase() {
  Logger.log("Iniciando Creación de Base de Datos de Proveedores (PROC-MAN-13)...");

  const dbName = "MERCURIO_PMS_PROVEEDORES_DB";
  const ss = SpreadsheetApp.create(dbName);
  const ssId = ss.getId();
  Logger.log("✓ Base de Datos de Proveedores creada. Nombre: " + dbName + " | ID: " + ssId);

  // Importar las cabeceras desde la configuración estática si estuvieran disponibles, o acá directo:
  const tablesStruct = {
    "REG-MAN-13-01_Proveedores_Aprobados": [
      "ID_Proveedor", "Razon_Social", "CUIT_TaxID", "Categoria", "Es_Ex", "Contacto", "Email", "Telefono", "Score_Global", "Status", "Evidencia_Precalificacion"
    ],
    "REG-MAN-13-03_Post_Job_Reviews": [
      "ID_Evaluacion", "ID_Proveedor", "Fecha_Evaluacion", "OT_Referencia", "Servicio_Entregado", "Score_OTD", "Score_Calidad", "Score_Doc", "Score_EHS", "Score_Total", "Comentarios", "Evidencia", "Evaluador"
    ],
    "REG-MAN-13-04_Log_No_Conformidades": [
      "ID_NC_Proveedor", "Fecha", "ID_Proveedor", "Falla_Detectada", "Accion_Requerida", "Fecha_Cierre", "Status", "Responsable", "Evidencia"
    ]
  };

  const sheetNames = Object.keys(tablesStruct);

  for (let i = 0; i < sheetNames.length; i++) {
    let sheetName = sheetNames[i];
    let sheetHeaders = tablesStruct[sheetName];

    let currentSheet;
    if (i === 0) {
      currentSheet = ss.getActiveSheet();
      currentSheet.setName(sheetName);
    } else {
      currentSheet = ss.insertSheet(sheetName);
    }

    let headerRange = currentSheet.getRange(1, 1, 1, sheetHeaders.length);
    headerRange.setValues([sheetHeaders]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1e293b"); 
    headerRange.setFontColor("white");
    currentSheet.setFrozenRows(1);

    Logger.log("✓ Tabla configurada: " + sheetName);
  }

  Logger.log("=========================================");
  Logger.log("¡Configuración Exitosa de Proveedores!");
  Logger.log("Copia y Pega esto en DB_CONFIG.IDS en archivo DB.js:");
  Logger.log("PROVEEDORES_DB: " + ssId);
  Logger.log("=========================================");
}

/**
 * MIGRACIÓN: Unifica REG-MAN-02-02 (Críticos) dentro de REG-MAN-06-01 (Inventario)
 * Ejecutar una vez si se desea automatizar el merge de datos antiguos.
 */
function migrateCriticalEquipmentToInventory() {
  const inventorySs = SpreadsheetApp.openById("1IQE4Q3Jb0LDufamYLCigMvnB05Lm1zAniufVFMo414Q");
  const mainSheet = inventorySs.getSheetByName("REG-MAN-06-01_Inventario_Maestro_Activos.csv");
  const criticalSheet = inventorySs.getSheetByName("REG-MAN-02-02_Lista_Maestra_Equipos_Criticos");

  if (!criticalSheet) {
    Logger.log("⚠ No se encontró la hoja REG-MAN-02-02. Ya podría estar migrada.");
    return;
  }

  const mainData = mainSheet.getDataRange().getValues();
  const mainHeaders = mainData[0];
  const criticalData = criticalSheet.getDataRange().getValues();
  const criticalHeaders = criticalData[0];

  Logger.log("Migrando " + (criticalData.length - 1) + " registros críticos...");

  // Indices en la hoja de destino (Inventario)
  const idxDestSFI = mainHeaders.indexOf("SFI");
  const idxDestCrit = mainHeaders.indexOf("Criticidad");
  const idxDestFunc = mainHeaders.indexOf("Funcion_Critica");
  const idxDestJust = mainHeaders.indexOf("Justificacion_Criticidad");

  // Indices en la hoja origen (Críticos) - Asumiendo nombres estándar
  const idxOriSFI = criticalHeaders.findIndex(h => h.toUpperCase().includes("SFI"));
  const idxOriCrit = criticalHeaders.findIndex(h => h.toUpperCase().includes("CRITICIDAD"));
  const idxOriFunc = criticalHeaders.findIndex(h => h.toUpperCase().includes("FUNCIÓN") || h.toUpperCase().includes("FUNCION"));

  if (idxDestSFI === -1 || idxOriSFI === -1) {
    Logger.log("❌ Error: No se encontró la columna SFI en alguna de las hojas.");
    return;
  }

  // Iterar por equipos críticos
  for (let i = 1; i < criticalData.length; i++) {
    const sfiOri = String(criticalData[i][idxOriSFI]).trim();
    if (!sfiOri) continue;

    // Buscar en Inventario
    for (let j = 1; j < mainData.length; j++) {
      const sfiDest = String(mainData[j][idxDestSFI]).trim();

      if (sfiDest === sfiOri) {
        // Macheo encontrado: Actualizar Criticidad y Función
        if (idxDestCrit !== -1 && idxOriCrit !== -1) {
          mainSheet.getRange(j + 1, idxDestCrit + 1).setValue(criticalData[i][idxOriCrit]);
        }
        if (idxDestFunc !== -1 && idxOriFunc !== -1) {
          mainSheet.getRange(j + 1, idxDestFunc + 1).setValue(criticalData[i][idxOriFunc]);
        }
        Logger.log("✓ Vinculado SFI: " + sfiOri);
        break;
      }
    }
  }

  // ELIMINAR HOJA ANTIGUA
  inventorySs.deleteSheet(criticalSheet);
  Logger.log("✅ Migración completa. Hoja REG-MAN-02-02 eliminada.");
}

/**
 * Crea las nuevas tablas para RCA y CAPA en la base de datos de Inspecciones
 * Ejecutar una vez desde el editor de Apps Script.
 */
function createRcaCapaTables() {
  const ssId = DB_CONFIG.IDS.INSPECTIONS_DB; // Agrupamos RCA/CAPA junto a Inspecciones
  const ss = SpreadsheetApp.openById(ssId);

  const tablesToCreate = {
    [DB_CONFIG.TABLES.RCA_LOG]: DB_CONFIG.HEADERS.RCA_LOG,
    [DB_CONFIG.TABLES.CAPA_LOG]: DB_CONFIG.HEADERS.CAPA_LOG
  };

  Object.keys(tablesToCreate).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);

      const headers = tablesToCreate[sheetName];
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);

      headerRange.setFontWeight("bold");
      headerRange.setBackground("#B91C1C"); // Rojo oscuro para destacar RCA/CAPA
      headerRange.setFontColor("white");
      sheet.setFrozenRows(1);

      Logger.log("✓ Tabla creada: " + sheetName);
    } else {
      Logger.log("ℹ La tabla ya existe: " + sheetName);
    }
  });

  Logger.log("Configuración de tablas RCA y CAPA completada.");
}

/**
 * Crea la nueva tabla para el Registro de Fallas y Defectos (PROC-MAN-15)
 * Ejecutar una vez desde el editor de Apps Script.
 */
function createDefectLogTable() {
  const ssId = DB_CONFIG.IDS.FLEET_DB; // Agrupamos Defectos junto a la flota principal o puedes elegir el que corresponda
  const ss = SpreadsheetApp.openById(ssId);
  const sheetName = DB_CONFIG.TABLES.DEFECT_LOG;

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);

    const headers = DB_CONFIG.HEADERS.DEFECT_LOG;
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);

    headerRange.setFontWeight("bold");
    headerRange.setBackground("#DC2626"); // Rojo para Destacar Defectos
    headerRange.setFontColor("white");
    sheet.setFrozenRows(1);

    Logger.log("✓ Tabla creada: " + sheetName);
  } else {
    Logger.log("ℹ La tabla ya existe: " + sheetName);
  }
}

/**
 * Crea la nueva tabla para el Registro de Pedidos de Repuestos (REG-MAN-11-02)
 * Ejecutar una vez desde el editor de Apps Script.
 */
function createSpareOrdersTable() {
  const ssId = DB_CONFIG.IDS.SPARES_DB;
  const ss = SpreadsheetApp.openById(ssId);
  const sheetName = DB_CONFIG.TABLES.SPARE_ORDERS;

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);

    const headers = DB_CONFIG.HEADERS.SPARE_ORDERS;
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);

    headerRange.setFontWeight("bold");
    headerRange.setBackground("#334155"); // Gris pizarra para pedidos
    headerRange.setFontColor("white");
    sheet.setFrozenRows(1);

    Logger.log("✓ Tabla creada: " + sheetName);
  } else {
    Logger.log("ℹ La tabla ya existe: " + sheetName);
  }
}

/**
 * initExistingDatabase
 * 
 * Configura las pestañas y cabeceras en el Spreadsheet que ya está configurado en DB_CONFIG.
 * Útil para inicializar el Spreadsheet ID que el usuario proporcionó.
 */
function initExistingDatabase() {
  const ssId = DB_CONFIG.IDS.FLEET_DB;
  if (!ssId || ssId.length < 10) {
    Logger.log("❌ Error: No se ha configurado un SPREADSHEET_ID válido en DB_CONFIG.IDS.FLEET_DB");
    return;
  }

  Logger.log("Iniciando Configuración en Spreadsheet existente ID: " + ssId);
  const ss = SpreadsheetApp.openById(ssId);

  // Definir las tablas que queremos inicializar basándonos en DB_CONFIG
  const tablesStruct = {
    "_USERS": DB_CONFIG.HEADERS.USERS,
    "VESSELS": DB_CONFIG.HEADERS.VESSELS,
    "ASSETS": DB_CONFIG.HEADERS.ASSETS,
    "MAINTENANCE_PLAN": DB_CONFIG.HEADERS.MAINTENANCE_PLAN,
    "WORK_ORDERS": DB_CONFIG.HEADERS.WORK_ORDERS,
    "DEFECT_LOG": DB_CONFIG.HEADERS.DEFECT_LOG,
    "DEFERRALS": DB_CONFIG.HEADERS.DEFERRALS,
    "SPARES": DB_CONFIG.HEADERS.SPARES,
    "INSPECTIONS": DB_CONFIG.HEADERS.INSPECTIONS,
    "INSPECTIONS_LOG": DB_CONFIG.HEADERS.INSPECTIONS_LOG,
    "RCA_LOG": DB_CONFIG.HEADERS.RCA_LOG,
    "CAPA_LOG": DB_CONFIG.HEADERS.CAPA_LOG,
    "REG-OPS-01-01_Reporte_Diario_Operaciones": DB_CONFIG.HEADERS.DAILY_REPORTS,
    "REG-MAN-08-01_Registro_Maestro_Certificados": DB_CONFIG.HEADERS.CERTIFICATES,
    "REG-MAN-13-01_Proveedores_Aprobados": DB_CONFIG.HEADERS.PROVEEDORES,
    "REG-MAN-13-03_Post_Job_Reviews": DB_CONFIG.HEADERS.EVAL_PROVEEDORES,
    "REG-MAN-13-04_Log_No_Conformidades": DB_CONFIG.HEADERS.NC_PROVEEDORES,
    "REG-MAN-11-02_Registro_Pedidos_Repuestos": DB_CONFIG.HEADERS.SPARE_ORDERS,
    "_AUDIT_LOG": DB_CONFIG.HEADERS.AUDIT_LOG,
    "_STOCK_MOVEMENTS": DB_CONFIG.HEADERS.STOCK_MOVEMENTS,
    "REG-MAN-15-02_Evaluacion_Barreras_IA": DB_CONFIG.HEADERS.BARRIER_ASSESSMENTS
  };

  const sheetNames = Object.keys(tablesStruct);

  for (let i = 0; i < sheetNames.length; i++) {
    let sheetName = sheetNames[i];
    let sheetHeaders = tablesStruct[sheetName];

    let currentSheet = ss.getSheetByName(sheetName);
    if (!currentSheet) {
      currentSheet = ss.insertSheet(sheetName);
      Logger.log("✓ Hoja creada: " + sheetName);
    } else {
      Logger.log("ℹ Hoja ya existente: " + sheetName);
    }

    // Insertar cabeceras en el tope (solo si la hoja está vacía o queremos forzarlas)
    if (currentSheet.getLastRow() < 1) {
      let headerRange = currentSheet.getRange(1, 1, 1, sheetHeaders.length);
      headerRange.setValues([sheetHeaders]);

      // Estilo de cabeceras
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#1e293b"); 
      headerRange.setFontColor("white");
      currentSheet.setFrozenRows(1);
      Logger.log("✓ Cabeceras configuradas para: " + sheetName);
    }
  }

  Logger.log("=========================================");
  Logger.log("¡Inicialización de Spreadsheet Existente Completada!");
  Logger.log("ID procesado: " + ssId);
  Logger.log("RECUERDA: Agregar tu email a la tabla _USERS para poder acceder.");
  Logger.log("=========================================");
}

function seedExampleSpareRecord() {
  const ss = SpreadsheetApp.openById(DB_CONFIG.IDS.SPARES_DB);
  const sheet = getOrCreateSheet(ss, DB_CONFIG.TABLES.SPARES);
  ensureHeaders(sheet, DB_CONFIG.TABLES.SPARES);

  const headers = DB_CONFIG.HEADERS.SPARES;
  const data = sheet.getDataRange().getValues();
  const existingRows = data.slice(1);
  const exampleSku = 'SKU-EJ-61001';

  const alreadyExists = existingRows.some(row => String(row[0] || '').trim() === exampleSku);
  if (alreadyExists) {
    Logger.log('ℹ Ya existe el registro de ejemplo en SPARES: ' + exampleSku);
    return { success: true, message: 'El registro de ejemplo ya existía.', sku: exampleSku };
  }

  const exampleRecord = {
    SKU: exampleSku,
    SFI: '610.01',
    Nombre_Funcional: 'Filtro de aceite principal',
    VesselName: 'LATERE',
    Fabricante: 'MANN',
    Modelo: 'W 962/14',
    P_N: 'FIL-61001-A',
    Stock_Actual: 2,
    MIN: 1,
    SS: 1,
    ROP: 2,
    Ubicacion: 'Panal de repuestos - Sala de maquinas',
    Condicion: 'NUEVO',
    Status: 'OK',
    'Equipo/Sistema': 'Motor Principal de Babor',
    Nivel: 'CRITICO',
    'EX (Si/No)': 'NO',
    'Ubicación': 'Panal de repuestos - Sala de maquinas',
    'Lead Time': '15 dias',
    Fuente_Informacion: 'Registro de ejemplo inicial',
    'Impacta trazabilidad': 'SI',
    ASSET_ID: '610.01'
  };

  const newRow = headers.map(header => exampleRecord[header] !== undefined ? exampleRecord[header] : '');
  sheet.appendRow(newRow);
  delete _cacheReadTable[DB_CONFIG.TABLES.SPARES];

  Logger.log('✓ Registro de ejemplo agregado en SPARES: ' + exampleSku);
  return { success: true, message: 'Registro de ejemplo agregado.', sku: exampleSku };
}
