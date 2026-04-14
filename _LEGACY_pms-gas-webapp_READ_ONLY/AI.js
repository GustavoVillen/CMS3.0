/**
 * Mercurio AI v5.0
 * Apps Script + Gemini + Manual + Google Sheets
 *
 * Fuentes fijas:
 * - Manual: archivo ID 1z4ublePJ-M4EN_ghRe0kIHbsBfAryBueS-lat5dWjqY
 * - Base de datos: spreadsheet ID 11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA
 *
 * Requiere en Script Properties:
 * - GEMINI_API_KEY
 *
 * Opcionales en Script Properties:
 * - GEMINI_MODEL (default: gemini-2.5-flash)
 * - APP_TIMEZONE (default: Session.getScriptTimeZone())
 *
 * Notas:
 * - Este archivo asume que _requireAuthenticatedUser_() ya existe en tu proyecto.
 * - Si querés limitar la base a una sola hoja exacta, completá DATA_SOURCE_CONFIG.DATABASE_SHEET_NAME.
 */

/* =========================
 * CONFIG
 * ========================= */

const AI_CONFIG = Object.freeze({
  API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/models",
  DEFAULT_MODEL: "gemini-2.5-flash",
  DEFAULT_CHARSET: "UTF-8",

  MAX_HISTORY_ITEMS: 12,
  MAX_OUTPUT_TOKENS: 4096,

  MAX_MANUAL_CHUNKS: 4,
  MAX_MANUAL_CHUNK_CHARS: 1800,

  MAX_DB_MATCHES: 5,
  MAX_DB_CONTEXT_CHARS: 8000,

  CACHE_TTL_MS: 60 * 60 * 1000,
});

const DATA_SOURCE_CONFIG = Object.freeze({
  MANUAL_FILE_ID: "1z4ublePJ-M4EN_ghRe0kIHbsBfAryBueS-lat5dWjqY",
  DATABASE_SPREADSHEET_ID: "11gLeGWmpr3CbcxMuLsCh7cMDiuZipUTIcXffNtMSKtA",
  DATABASE_SHEET_NAME: "",
});

const AI_EXCLUDED_SHEETS = Object.freeze([
  "_USERS",
  "_AUDIT_LOG",
  "_STOCK_MOVEMENTS",
]);

/* =========================
 * MANUAL SECTIONS (OPCIONAL, SIN LINEAS FIJAS)
 * ========================= */

const MANUAL_SECTIONS = {
  "SECTION-21": {
    aliases: [
      "21 registros asociados",
      "registros asociados",
      "listado maestro de registros",
      "registros",
      "level 3",
    ],
    title: "21 REGISTROS ASOCIADOS",
  },

  "DOCUMENTATION-LIST": {
    aliases: [
      "documentation list",
      "lista de documentacion",
      "documentacion list",
      "listado documental",
    ],
    title: "DOCUMENTATION LIST",
  },

  "PROCEDIMIENTOS-OPERATIVOS": {
    aliases: [
      "procedimientos operativos",
      "procedimientos",
      "proc-man",
      "nivel 2",
    ],
    title: "PROCEDIMIENTOS OPERATIVOS",
  },

  "PROC-MAN-01": {
    aliases: [
      "proc-man-01",
      "procedimiento 01",
      "gestion plan mantenimiento",
      "gestión plan mantenimiento",
      "plan maestro de mantenimiento",
      "plan anual de mantenimiento",
      "pms",
      "plan mantenimiento",
    ],
    title: "PROC-MAN-01 GESTION PLAN MANTENIMIENTO",
  },

  "PROC-MAN-02": {
    aliases: [
      "proc-man-02",
      "procedimiento 02",
      "identificacion equipos criticos",
      "identificación equipos críticos",
      "qué es un equipo crítico",
      "cuando un equipo es crítico",
      "criticidad",
      "lista de criticidad",
    ],
    title: "PROC-MAN-02 IDENTIFICACION EQUIPOS CRITICOS",
  },

  "PROC-MAN-03": {
    aliases: [
      "proc-man-03",
      "procedimiento 03",
      "gestion diferimientos",
      "gestión diferimientos",
      "diferimientos",
      "dispensas",
      "reprogramaciones criticas",
    ],
    title: "PROC-MAN-03 GESTION DIFERIMIENTOS",
  },

  "PROC-MAN-04": {
    aliases: [
      "proc-man-04",
      "procedimiento 04",
      "control registros",
      "control de registros",
      "registros",
      "retencion documental",
      "retención documental",
    ],
    title: "PROC-MAN-04 CONTROL REGISTROS",
  },

  "PROC-MAN-05": {
    aliases: [
      "proc-man-05",
      "procedimiento 05",
      "procedimiento maestro pruebas",
      "pruebas y verificaciones",
      "matriz tecnica de pruebas",
      "matriz técnica de pruebas",
      "pruebas",
    ],
    title: "PROC-MAN-05 PROCEDIMIENTO MAESTRO PRUEBAS",
  },

  "PROC-MAN-06": {
    aliases: [
      "proc-man-06",
      "procedimiento 06",
      "inspeccion previa carga",
      "inspección previa carga",
      "pre transfer",
      "pre-transfer",
      "checklist pre transferencia",
    ],
    title: "PROC-MAN-06 INSPECCION PREVIA CARGA",
  },

  "PROC-MAN-07": {
    aliases: [
      "proc-man-07",
      "procedimiento 07",
      "control integridad transferencia",
      "integridad transferencia",
      "lineas de transferencia",
      "líneas de transferencia",
      "integridad mecanica",
      "integridad mecánica",
    ],
    title: "PROC-MAN-07 CONTROL INTEGRIDAD TRANSFERENCIA",
  },

  "PROC-MAN-08": {
    aliases: [
      "proc-man-08",
      "procedimiento 08",
      "gestion integral equipos ex",
      "gestión integral equipos ex",
      "equipos ex",
      "atex",
      "iecex",
      "zona clasificada",
    ],
    title: "PROC-MAN-08 GESTION INTEGRAL EQUIPOS EX",
  },

  "PROC-MAN-11": {
    aliases: [
      "proc-man-11",
      "procedimiento 11",
      "gestion repuestos criticos",
      "gestión repuestos críticos",
      "repuestos criticos",
      "repuestos críticos",
      "stock minimo",
      "stock mínimo",
      "min rop",
    ],
    title: "PROC-MAN-11 GESTION REPUESTOS CRITICOS",
  },

  "PROC-MAN-13": {
    aliases: [
      "proc-man-13",
      "procedimiento 13",
      "evaluacion proveedores criticos",
      "evaluación proveedores críticos",
      "proveedores criticos",
      "proveedores críticos",
      "suppliers",
      "vendors",
    ],
    title: "PROC-MAN-13 EVALUACION PROVEEDORES CRITICOS",
  },

  "PROC-MAN-14": {
    aliases: [
      "proc-man-14",
      "procedimiento 14",
      "gestion paradas tecnicas dique",
      "gestión paradas técnicas dique",
      "paradas tecnicas",
      "paradas técnicas",
      "dique",
      "drydock",
      "varada",
    ],
    title: "PROC-MAN-14 GESTION PARADAS TECNICAS DIQUE",
  },

  "PROC-MAN-16": {
    aliases: [
      "proc-man-16",
      "procedimiento 16",
      "gestion modificaciones moc",
      "gestión modificaciones moc",
      "moc",
      "gestion del cambio",
      "gestión del cambio",
      "modificaciones",
    ],
    title: "PROC-MAN-16 GESTION MODIFICACIONES MOC",
  },

  "PROC-MAN-17": {
    aliases: [
      "proc-man-17",
      "procedimiento 17",
      "gestion fallas criticas",
      "gestión fallas críticas",
      "fallas criticas",
      "fallas críticas",
      "defectos",
      "defect log",
      "daños",
      "averías",
      "roturas",
      "gestión de daños",
      "gestión de averías",
      "gestión de equipos críticos",
    ],
    title: "PROC-MAN-17 GESTION FALLAS CRITICAS",
  },

  "PROC-MAN-18": {
    aliases: [
      "proc-man-18",
      "procedimiento 18",
      "analisis causa raiz",
      "análisis causa raíz",
      "rca",
      "causa raiz",
      "causa raíz",
    ],
    title: "PROC-MAN-18 ANALISIS CAUSA RAIZ",
  },

  "PROC-MAN-19": {
    aliases: [
      "proc-man-19",
      "procedimiento 19",
      "seguimiento capa",
      "capa",
      "acciones correctivas",
      "acciones preventivas",
    ],
    title: "PROC-MAN-19 SEGUIMIENTO CAPA",
  },

  "PROC-MAN-20": {
    aliases: [
      "proc-man-20",
      "procedimiento 20",
      "recepcion tecnica nueva unidad",
      "recepción técnica nueva unidad",
      "alta de unidad",
      "nueva unidad",
      "onboarding tecnico",
    ],
    title: "PROC-MAN-20 RECEPCION TECNICA NUEVA UNIDAD",
  },

  "PROC-MAN-21": {
    aliases: [
      "proc-man-21",
      "procedimiento 21",
      "preservacion inactividad",
      "preservación inactividad",
      "inactividad",
      "preservacion",
      "lay up",
      "lay-up",
    ],
    title: "PROC-MAN-21 PRESERVACION INACTIVIDAD",
  },

  "PROC-MAN-22": {
    aliases: [
      "proc-man-22",
      "procedimiento 22",
      "preparacion inspeccion externa",
      "preparación inspección externa",
      "inspeccion externa",
      "inspección externa",
      "sire ready",
      "inspection ready",
    ],
    title: "PROC-MAN-22 PREPARACION INSPECCION EXTERNA",
  },

  "PROC-MAN-23": {
    aliases: [
      "proc-man-23",
      "procedimiento 23",
      "gestion observaciones",
      "gestión observaciones",
      "observaciones",
      "hallazgos",
      "findings",
    ],
    title: "PROC-MAN-23 GESTION OBSERVACIONES",
  },

  "PROC-MAN-24": {
    aliases: [
      "proc-man-24",
      "procedimiento 24",
      "gestion seguridad cibernetica flota",
      "gestión seguridad cibernética flota",
      "ciberseguridad",
      "seguridad cibernetica",
      "seguridad cibernética",
    ],
    title: "PROC-MAN-24 GESTION SEGURIDAD CIBERNETICA FLOTA",
  },

  "REG-MAN-11-01": {
    aliases: [
      "reg-man-11-01",
      "listado repuestos criticos",
      "listado de repuestos criticos",
      "listado de repuestos críticos",
      "repuestos criticos",
      "stock minimo",
      "stock mínimo",
      "min rop",
    ],
    title:
      "REG-MAN-11-01 Listado de Repuestos Críticos y Stock Mínimo (MIN/ROP)",
    parentSection: "SECTION-21",
  },
};

/* =========================
 * CACHES EN MEMORIA
 * ========================= */

let _manualCache = {
  loadedAt: 0,
  fileId: "",
  fileName: "",
  text: "",
  chunks: [],
  headingIndex: [],
};

let _dbCache = {
  loadedAt: 0,
  spreadsheetId: "",
  spreadsheetName: "",
  sheets: [],
};

/* =========================
 * API PRINCIPAL
 * ========================= */

function apiAskAssistant(userPrompt, history) {
  _requireAuthenticatedUser_();

  const prompt = sanitizeText_(userPrompt, 15000);
  if (!prompt) {
    return { success: false, message: "La consulta está vacía." };
  }

  try {
    const cfg = getRuntimeConfig_();
    const queryInfo = analyzeQuery_(prompt);
    const historyNormalized = normalizeHistoryForGemini_(history);

    const manualContext = getManualContext_(prompt, cfg);
    const dbContext = emptyDbContext_();

    if (queryInfo.explicitManual && !manualContext.found) {
      return {
        success: true,
        text: "No se encontró esa información en el manual de la empresa.",
        sources: {
          manual: manualContext.fileName || "",
          database: [],
        },
        meta: {
          model: "local-rule",
          manualFile: manualContext.fileName || "",
          dbSheetsUsed: [],
          manualFragments: 0,
          dbRowsUsed: 0,
        },
      };
    }

    const systemInstruction = [
      "Eres un asistente técnico marítimo experto en navegación, mecánica naval, reglamentaciones internacionales, ISM Code, IACS e IMO.",
      "Responde siempre en español.",
      "No saludes ni uses preámbulos.",
      "Sé técnico, directo y prudente.",
      "",
      "REGLAS OBLIGATORIAS:",
      "1. El manual de la empresa tiene prioridad absoluta.",
      "2. Nunca atribuyas al manual algo que no aparezca en el contexto del manual.",
      "3. Si el usuario pide específicamente qué dice el manual y no está en el manual, debes indicarlo.",
      "4. Solo cuando la respuesta no esté en el manual puedes responder como experto técnico.",
      "5. En ese caso, deja claro que esa parte no proviene del manual.",
      "6. No inventes valores, registros, estados, fechas, normas ni referencias.",
      "7. Si una consulta requiere una cita normativa exacta y no está en el contexto disponible, indícalo expresamente.",
      "8. Resalta procedimientos en negritas. Ejemplo: **PROC-MAN-01**.",
      "9. Responde con formato cerrado y completo. No dejes listas abiertas, paréntesis abiertos, referencias incompletas ni códigos truncados.",
    ].join("\n");

    const finalUserPrompt = buildAssistantUserPrompt_(
      prompt,
      manualContext,
      dbContext,
      queryInfo,
    );

    const payload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: historyNormalized.concat([
        {
          role: "user",
          parts: [{ text: finalUserPrompt }],
        },
      ]),
      generationConfig: {
        temperature: 0.1,
        topP: 0.9,
        maxOutputTokens: AI_CONFIG.MAX_OUTPUT_TOKENS,
        responseMimeType: "text/plain",
      },
    };

    let result = callGemini_(payload, cfg.apiKey, cfg.model);

    if (!result.success && historyNormalized.length) {
      result = callGemini_(
        {
          systemInstruction: payload.systemInstruction,
          contents: [
            {
              role: "user",
              parts: [{ text: finalUserPrompt }],
            },
          ],
          generationConfig: payload.generationConfig,
        },
        cfg.apiKey,
        cfg.model,
      );
    }

    if (!result.success) return result;

    result = continueAssistantAnswerIfIncomplete_(payload, result, cfg);

    return {
      success: true,
      text: cleanAiTextOutput_(result.text),
      sources: {
        manual: manualContext.fileName || "",
        database: [],
      },
      meta: {
        model: cfg.model,
        manualFile: manualContext.fileName || "",
        dbSheetsUsed: dbContext.sheetNames || [],
        manualFragments: manualContext.count || 0,
        dbRowsUsed: dbContext.count || 0,
        usageMetadata: result.usageMetadata || null,
        finishReason: result.finishReason || "",
      },
    };
  } catch (e) {
    return {
      success: false,
      message: "Error al procesar la consulta: " + (e.message || e.toString()),
    };
  }
}

/* =========================
 * CONFIG DINAMICA
 * ========================= */

function getRuntimeConfig_() {
  const props = PropertiesService.getScriptProperties();

  const apiKey = String(props.getProperty("GEMINI_API_KEY") || "").trim();
  const model = String(
    props.getProperty("GEMINI_MODEL") || AI_CONFIG.DEFAULT_MODEL,
  ).trim();
  const timezone = String(
    props.getProperty("APP_TIMEZONE") || Session.getScriptTimeZone(),
  ).trim();

  if (!apiKey) throw new Error("Falta GEMINI_API_KEY en Script Properties.");

  return {
    apiKey: apiKey,
    model: model,
    timezone: timezone,
    manualFileId: DATA_SOURCE_CONFIG.MANUAL_FILE_ID,
    databaseSpreadsheetId: DATA_SOURCE_CONFIG.DATABASE_SPREADSHEET_ID,
    databaseSheetName: DATA_SOURCE_CONFIG.DATABASE_SHEET_NAME,
  };
}

/* =========================
 * GEMINI
 * ========================= */

function callGemini_(payload, apiKey, model) {
  const url =
    AI_CONFIG.API_BASE_URL +
    "/" +
    encodeURIComponent(model) +
    ":generateContent";

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-goog-api-key": apiKey,
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    const raw = response.getContentText();
    const data = safeJsonParse_(raw);
    const finishReason = getGeminiFinishReason_(data);

    if (code >= 200 && code < 300) {
      const text = extractTextFromGeminiResponse_(data);
      if (text) {
        return {
          success: true,
          text: text,
          finishReason: finishReason,
          usageMetadata: data && data.usageMetadata ? data.usageMetadata : null,
        };
      }

      return {
        success: false,
        message:
          "Gemini respondió sin texto útil. " + extractGeminiError_(data),
      };
    }

    return {
      success: false,
      message:
        "Error API (" +
        code +
        "): " +
        (extractGeminiError_(data) || truncate_(raw, 500)),
    };
  } catch (e) {
    return {
      success: false,
      message: "Error de red: " + (e.message || e.toString()),
    };
  }
}

function continueAssistantAnswerIfIncomplete_(payload, result, cfg) {
  let current = result || {};
  let combinedText = String(current.text || "");
  let finishReason = String(current.finishReason || "").toUpperCase();
  let usageMetadata = current.usageMetadata || null;

  for (var attempt = 0; attempt < 2; attempt++) {
    if (!looksIncompleteAiAnswer_(combinedText, finishReason)) break;

    const continuationPayload = {
      systemInstruction: payload.systemInstruction,
      contents: (payload.contents || []).concat([
        {
          role: "model",
          parts: [{ text: combinedText }],
        },
        {
          role: "user",
          parts: [{
            text: "Continúa exactamente desde donde quedó la respuesta anterior, sin repetir contenido. Completa la idea pendiente y cierra correctamente cualquier lista, paréntesis o referencia de manual/procedimiento.",
          }],
        },
      ]),
      generationConfig: payload.generationConfig,
    };

    const continuation = callGemini_(continuationPayload, cfg.apiKey, cfg.model);
    if (!continuation.success || !continuation.text) break;

    const continuationText = trimContinuationOverlap_(combinedText, continuation.text);
    if (!continuationText) break;

    combinedText = cleanAiTextOutput_(combinedText + "\n" + continuationText);
    finishReason = String(continuation.finishReason || finishReason || "").toUpperCase();
    if (continuation.usageMetadata) usageMetadata = continuation.usageMetadata;
  }

  return {
    success: true,
    text: combinedText,
    finishReason: finishReason,
    usageMetadata: usageMetadata,
  };
}

function extractTextFromGeminiResponse_(data) {
  if (!data || !Array.isArray(data.candidates) || !data.candidates.length)
    return "";

  const candidate = data.candidates[0] || {};
  const content = candidate.content || {};
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const out = parts
    .map(function (part) {
      return part && typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return cleanAiTextOutput_(out);
}

function getGeminiFinishReason_(data) {
  if (!data || !Array.isArray(data.candidates) || !data.candidates.length) return "";
  return String((data.candidates[0] || {}).finishReason || "").trim();
}

function trimContinuationOverlap_(existingText, continuationText) {
  const existing = String(existingText || "").trim();
  const continuation = String(continuationText || "").trim();
  if (!continuation) return "";
  if (!existing) return continuation;

  const maxOverlap = Math.min(existing.length, continuation.length, 300);
  for (var size = maxOverlap; size >= 40; size--) {
    if (existing.slice(-size) === continuation.slice(0, size)) {
      return continuation.slice(size).trim();
    }
  }

  return continuation;
}

function looksIncompleteAiAnswer_(text, finishReason) {
  const output = String(text || "").trim();
  const reason = String(finishReason || "").toUpperCase();
  if (!output) return false;

  if (reason && reason !== "STOP" && reason !== "FINISH_REASON_UNSPECIFIED") return true;

  if ((output.match(/\*\*/g) || []).length % 2 !== 0) return true;
  if (/\*\*[^*]*$/.test(output)) return true;
  if (/\b(?:PROC|REG)-MAN-$/.test(output)) return true;
  if (/\b(?:PROC|REG)-MAN-\d{0,2}$/.test(output)) return true;
  if (/\($/.test(output) || /\[[^\]]*$/.test(output)) return true;
  if (/[:;,\-]$/.test(output)) return true;

  return false;
}

function extractGeminiError_(data) {
  if (!data) return "Sin detalle adicional.";
  if (data.error && data.error.message) return data.error.message;
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    return "Prompt bloqueado: " + data.promptFeedback.blockReason;
  }
  if (Array.isArray(data.candidates) && data.candidates.length) {
    const c = data.candidates[0];
    if (c.finishReason) return "finishReason: " + c.finishReason;
  }
  return "Respuesta vacía o incompleta.";
}

function looksLikeMojibake_(text) {
  return /(Ã.|Â.|â.|¢|¬|Ä)/.test(String(text || ""));
}

function recoverUtf8Mojibake_(text) {
  const input = String(text || "");
  if (!input || !looksLikeMojibake_(input)) return input;

  try {
    const bytes = [];
    for (var i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code > 255) return input;
      bytes.push(code);
    }

    const recovered = Utilities.newBlob(bytes).getDataAsString("UTF-8");
    if (!recovered) return input;

    const inputNoise = (input.match(/(Ã.|Â.|â.|¢|¬|Ä)/g) || []).length;
    const recoveredNoise = (recovered.match(/(Ã.|Â.|â.|¢|¬|Ä)/g) || []).length;
    return recoveredNoise <= inputNoise ? recovered : input;
  } catch (e) {
    return input;
  }
}

function cleanAiTextOutput_(text) {
  let output = String(text || "");
  output = recoverUtf8Mojibake_(output);

  const replacements = {
    "â€¢": "•",
    "Â•": "•",
    "â€“": "–",
    "â€”": "—",
    "â€œ": '"',
    "â€\x9d": '"',
    "â€˜": "'",
    "â€™": "'",
    "Â ": " ",
    "it¢,¬Ä¢": "•",
  };

  Object.keys(replacements).forEach(function (needle) {
    output = output.split(needle).join(replacements[needle]);
  });

  output = output.replace(/^[\t ]*(?:ï¢â‚¬Â¢|it¢,¬Ä¢|Ã¢â‚¬Â¢|â€¢|Â•)[\t ]*/gm, '- ');
  output = output.replace(/^[\t ]*[\u00A1-\u00FF,.;:~`^|]+[\t ]*(?=[A-ZÁÉÍÓÚÑ0-9_])/gm, '- ');
  output = output.replace(/^[\t ]*[-•]+[\t ]*(?=[A-ZÁÉÍÓÚÑ0-9_])/gm, '- ');

  return output
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================
 * CLASIFICACION DE CONSULTA
 * ========================= */

function analyzeQuery_(query) {
  const q = normalizeForSearch_(query);

  const explicitManual =
    /\b(manual|procedimiento|proc man|proc-man|reg man|reg-man|empresa|mercurio)\b/.test(
      q,
    ) || hasManualAliasMatch_(q);

  return {
    explicitManual: explicitManual,
    explicitDatabase: false,
    needsDatabase: false,
    canUseTechnicalFallback: true,
  };
}

function hasManualAliasMatch_(queryNorm) {
  const keys = Object.keys(MANUAL_SECTIONS || {});
  for (var i = 0; i < keys.length; i++) {
    const code = keys[i];
    const section = MANUAL_SECTIONS[code];
    if (!section) continue;

    if (queryNorm.indexOf(normalizeForSearch_(code)) >= 0) return true;

    const aliases = Array.isArray(section.aliases) ? section.aliases : [];
    for (var j = 0; j < aliases.length; j++) {
      if (queryNorm.indexOf(normalizeForSearch_(aliases[j])) >= 0) return true;
    }
  }
  return false;
}

function buildAssistantUserPrompt_(
  prompt,
  manualContext,
  dbContext,
  queryInfo,
) {
  return [
    "CONSULTA DEL USUARIO:",
    prompt,
    "",
    "TIPO DE CONSULTA:",
    JSON.stringify({
      explicitManual: queryInfo.explicitManual,
      explicitDatabase: queryInfo.explicitDatabase,
      needsDatabase: queryInfo.needsDatabase,
      canUseTechnicalFallback: queryInfo.canUseTechnicalFallback,
    }),
    "",
    "CONTEXTO DEL MANUAL (PRIORIDAD ABSOLUTA):",
    manualContext.found
      ? manualContext.text
      : "Sin coincidencias relevantes en el manual.",
    "",
    "CONTEXTO DE LA BASE DE DATOS:",
    dbContext.found ? dbContext.text : "Sin coincidencias en la base de datos.",
    "",
    "INSTRUCCIONES DE RESPUESTA:",
    "- Si la respuesta está en el manual, responde basándote en el manual.",
    "- Si el usuario pregunta por la base de datos, limita toda afirmación a los registros entregados.",
    '- Si no hay coincidencias en la base de datos para esa consulta, la respuesta debe ser exactamente: "No se encuentra en la base de datos."',
    "- Si la consulta no está en el manual y no es una consulta cerrada de base de datos, puedes responder con criterio técnico experto.",
    "- Cuando uses criterio técnico experto, deja claro que no proviene del manual.",
    "- No inventes información faltante.",
    "- Usa una estructura corta y cerrada: Respuesta directa, Procedimiento/criterio aplicable, Referencia si existe.",
    "- No dejes listas abiertas ni referencias incompletas.",
  ].join("\n");
}

/* =========================
 * MANUAL
 * ========================= */

function getManualContext_(query, cfg) {
  const manual = loadManualFromDrive_(cfg);
  if (!manual.text) {
    return {
      found: false,
      text: "",
      count: 0,
      fileName: manual.fileName || "",
      sections: [],
    };
  }

  const directCodes = findManualSectionCodes_(query);
  if (directCodes.length) {
    return extractManualSections_(manual, directCodes, query);
  }

  const terms = splitIntoUniqueTerms_(query);
  const ranked = [];

  for (var i = 0; i < manual.chunks.length; i++) {
    const chunk = manual.chunks[i];
    const score = scoreTextByTerms_(chunk.searchText, terms);
    if (score > 0) {
      ranked.push({
        index: i + 1,
        score: score,
        text: chunk.text,
      });
    }
  }

  ranked.sort(function (a, b) {
    return b.score - a.score;
  });

  if (!ranked.length) {
    return {
      found: false,
      text: "",
      count: 0,
      fileName: manual.fileName || "",
      sections: [],
    };
  }

  const selected = ranked.slice(0, AI_CONFIG.MAX_MANUAL_CHUNKS);
  const text = selected
    .map(function (item) {
      return "[Fragmento manual " + item.index + "]\n" + item.text;
    })
    .join("\n\n---\n\n");

  return {
    found: true,
    text: text,
    count: selected.length,
    fileName: manual.fileName || "",
    sections: [],
  };
}

function loadManualFromDrive_(cfg) {
  const now = Date.now();
  if (
    _manualCache.text &&
    _manualCache.fileId === cfg.manualFileId &&
    now - _manualCache.loadedAt < AI_CONFIG.CACHE_TTL_MS
  ) {
    return _manualCache;
  }

  const file = DriveApp.getFileById(cfg.manualFileId);
  const mime = String(file.getMimeType() || "");
  let text = "";

  if (
    mime === MimeType.GOOGLE_DOCS ||
    mime === "application/vnd.google-apps.document"
  ) {
    text = DocumentApp.openById(cfg.manualFileId).getBody().getText();
  } else {
    try {
      text = file.getBlob().getDataAsString(AI_CONFIG.DEFAULT_CHARSET);
    } catch (e) {
      text = file.getBlob().getDataAsString();
    }
  }

  text = cleanAiTextOutput_(
    String(text || "")
      .replace(/\r/g, "\n")
      .replace(/\u0000/g, " ")
      .trim(),
  );

  if (!text) {
    throw new Error("El manual está vacío o no se pudo leer.");
  }

  _manualCache = {
    loadedAt: now,
    fileId: cfg.manualFileId,
    fileName: file.getName(),
    text: text,
    chunks: buildManualChunks_(text),
    headingIndex: buildManualHeadingIndex_(text),
  };

  return _manualCache;
}

function buildManualChunks_(text) {
  const paragraphs = String(text || "")
    .split(/\n{2,}/)
    .map(function (p) {
      return p.trim();
    })
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  for (var i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const candidate = buffer ? buffer + "\n\n" + paragraph : paragraph;

    if (candidate.length > AI_CONFIG.MAX_MANUAL_CHUNK_CHARS && buffer) {
      chunks.push({
        text: buffer,
        searchText: normalizeForSearch_(buffer),
      });
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }

  if (buffer) {
    chunks.push({
      text: buffer,
      searchText: normalizeForSearch_(buffer),
    });
  }

  return chunks;
}

function buildManualHeadingIndex_(text) {
  const lines = String(text || "").split("\n");
  const headings = [];

  for (var i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || "").trim();
    if (!raw) continue;

    const norm = normalizeForSearch_(raw);
    const isProcedureCode =
      /\b(proc man|proc-man|reg man|reg-man|section)\b/.test(norm) ||
      /\bprocman\d+\b/.test(norm) ||
      /\bregman\d+\b/.test(norm);

    const looksLikeHeading =
      raw.length <= 140 &&
      !/[.;:]$/.test(raw) &&
      (/^[A-Z0-9 _()\-\/ÁÉÍÓÚÑ]+$/.test(raw) || isProcedureCode);

    if (!looksLikeHeading) continue;

    headings.push({
      lineIndex: i,
      raw: raw,
      normalized: norm,
    });
  }

  return headings;
}

function findManualSectionCodes_(query) {
  const queryNorm = normalizeForSearch_(query);
  const found = [];
  const keys = Object.keys(MANUAL_SECTIONS || {});

  for (var i = 0; i < keys.length; i++) {
    const code = keys[i];
    const section = MANUAL_SECTIONS[code];
    if (!section) continue;

    if (queryNorm.indexOf(normalizeForSearch_(code)) >= 0) {
      found.push(code);
      continue;
    }

    const aliases = Array.isArray(section.aliases) ? section.aliases : [];
    for (var j = 0; j < aliases.length; j++) {
      if (queryNorm.indexOf(normalizeForSearch_(aliases[j])) >= 0) {
        found.push(code);
        break;
      }
    }
  }

  return Array.from(new Set(found));
}

function buildHeadingCandidates_(code, sec) {
  const out = [];
  const title = sec && sec.title ? String(sec.title).trim() : "";
  const aliases = sec && Array.isArray(sec.aliases) ? sec.aliases : [];

  out.push(code);
  if (title) out.push(title);

  aliases.forEach(function (a) {
    out.push(a);
  });

  return Array.from(new Set(out)).map(normalizeForSearch_).filter(Boolean);
}

function findHeadingMatchForSection_(manual, code) {
  const sec = MANUAL_SECTIONS[code];
  if (!sec || !manual || !Array.isArray(manual.headingIndex)) return null;

  const candidates = buildHeadingCandidates_(code, sec);
  if (!candidates.length) return null;

  let best = null;

  manual.headingIndex.forEach(function (heading) {
    let score = 0;

    candidates.forEach(function (cand) {
      if (!cand) return;
      if (heading.normalized === cand) score += 100;
      else if (heading.normalized.indexOf(cand) >= 0) score += 35;
      else if (cand.indexOf(heading.normalized) >= 0) score += 20;
    });

    const codeNorm = normalizeForSearch_(code);
    if (heading.normalized.indexOf(codeNorm) >= 0) score += 60;

    if (!best || score > best.score) {
      best = {
        score: score,
        heading: heading,
      };
    }
  });

  return best && best.score > 0 ? best.heading : null;
}

function extractSectionByHeading_(manual, code) {
  const sec = MANUAL_SECTIONS[code];
  if (!sec || !manual || !manual.text) return null;

  const lines = manual.text.split("\n");
  const heading = findHeadingMatchForSection_(manual, code);

  if (!heading) {
    if (sec.parentSection) {
      return extractSectionByHeading_(manual, sec.parentSection);
    }
    return null;
  }

  const ordered = (manual.headingIndex || []).slice().sort(function (a, b) {
    return a.lineIndex - b.lineIndex;
  });

  const currentIdx = ordered.findIndex(function (h) {
    return h.lineIndex === heading.lineIndex && h.raw === heading.raw;
  });

  if (currentIdx === -1) return null;

  const start = heading.lineIndex;
  let end = lines.length;

  for (var i = currentIdx + 1; i < ordered.length; i++) {
    const next = ordered[i];
    if (next.lineIndex > start) {
      end = next.lineIndex;
      break;
    }
  }

  const body = lines.slice(start, end).join("\n").trim();
  if (!body) return null;

  return {
    code: code,
    title: sec.title || code,
    text: body,
  };
}

function extractManualSections_(manual, codes, query) {
  const extracted = [];
  const used = {};

  (codes || []).forEach(function (code) {
    if (used[code]) return;
    used[code] = true;

    const section = extractSectionByHeading_(manual, code);
    if (section && section.text) {
      extracted.push(
        "=== SECCIÓN " +
          section.code +
          ": " +
          section.title +
          " ===\n" +
          section.text,
      );
    }
  });

  if (!extracted.length) {
    return getRelevantManualContext_(query, {
      manualFileId: manual.fileId,
    });
  }

  return {
    found: true,
    text: extracted.join("\n\n"),
    count: extracted.length,
    fileName: manual.fileName || "",
    sections: Object.keys(used),
  };
}

function getRelevantManualContext_(query, cfg) {
  const manual = loadManualFromDrive_(cfg);
  const terms = splitIntoUniqueTerms_(query);
  const chunks = manual.chunks || [];

  if (!chunks.length) {
    return {
      found: false,
      text: "",
      count: 0,
      fileName: manual.fileName || "",
      sections: [],
    };
  }

  const ranked = chunks
    .map(function (chunk, idx) {
      return {
        index: idx + 1,
        text: chunk.text,
        searchText: chunk.searchText,
        score: scoreTextByTerms_(chunk.searchText, terms),
      };
    })
    .filter(function (item) {
      return item.score > 0;
    })
    .sort(function (a, b) {
      return b.score - a.score;
    })
    .slice(0, AI_CONFIG.MAX_MANUAL_CHUNKS);

  if (!ranked.length) {
    return {
      found: false,
      text: "",
      count: 0,
      fileName: manual.fileName || "",
      sections: [],
    };
  }

  const text = ranked
    .map(function (item) {
      return "[Fragmento manual " + item.index + "]\n" + item.text;
    })
    .join("\n\n---\n\n");

  return {
    found: true,
    text: text,
    count: ranked.length,
    fileName: manual.fileName || "",
    sections: [],
  };
}

/* =========================
 * BASE DE DATOS
 * ========================= */

function emptyDbContext_() {
  return {
    found: false,
    text: "",
    count: 0,
    matches: [],
    sheetNames: [],
  };
}

function isSheetAllowedForAI_(sheetName) {
  const normalized = String(sheetName || "")
    .trim()
    .toUpperCase();
  return AI_EXCLUDED_SHEETS.indexOf(normalized) === -1;
}

function canUserAccessAIRow_(user, rowObject, sheetName) {
  if (!isSheetAllowedForAI_(sheetName)) return false;

  if (typeof _canViewAllScopes_ === "function" && _canViewAllScopes_(user)) {
    return true;
  }

  if (
    typeof _getUserAssignedScopes_ !== "function" ||
    typeof _extractRecordScopes_ !== "function" ||
    typeof _userCanAccessScopes_ !== "function"
  ) {
    return true;
  }

  const rowScopes = _extractRecordScopes_(rowObject);
  const hasScopedFields =
    (rowScopes.asset && rowScopes.asset.length > 0) ||
    (rowScopes.vessel && rowScopes.vessel.length > 0) ||
    (rowScopes.unit && rowScopes.unit.length > 0);

  if (!hasScopedFields) return true;
  return _userCanAccessScopes_(_getUserAssignedScopes_(user), rowScopes);
}

function getDatabaseContext_(query, cfg) {
  const currentUser = _requireAuthenticatedUser_();
  const db = loadDatabaseIndex_(cfg);
  const queryNorm = normalizeForSearch_(query);
  const terms = splitIntoUniqueTerms_(query);
  const ranked = [];

  for (var i = 0; i < db.sheets.length; i++) {
    const sheetEntry = db.sheets[i];

    for (var j = 0; j < sheetEntry.rows.length; j++) {
      const rowEntry = sheetEntry.rows[j];
      if (
        !canUserAccessAIRow_(
          currentUser,
          rowEntry.rowObject,
          sheetEntry.sheetName,
        )
      )
        continue;
      const score = scoreDbRow_(
        queryNorm,
        terms,
        rowEntry.searchText,
        rowEntry.rowObject,
      );

      if (score > 0) {
        ranked.push({
          score: score,
          sheetName: sheetEntry.sheetName,
          rowNumber: rowEntry.rowNumber,
          rowObject: rowEntry.rowObject,
        });
      }
    }
  }

  ranked.sort(function (a, b) {
    return b.score - a.score;
  });

  const top = ranked.slice(0, AI_CONFIG.MAX_DB_MATCHES);
  if (!top.length) return emptyDbContext_();

  const sheetsUsed = {};
  const text = top
    .map(function (item, idx) {
      sheetsUsed[item.sheetName] = true;
      return [
        "[Dato base " + (idx + 1) + "]",
        "Hoja: " + item.sheetName,
        "Fila: " + item.rowNumber,
        "Contenido: " + JSON.stringify(item.rowObject),
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return {
    found: true,
    text: truncate_(text, AI_CONFIG.MAX_DB_CONTEXT_CHARS),
    count: top.length,
    matches: top,
    sheetNames: Object.keys(sheetsUsed),
  };
}

function loadDatabaseIndex_(cfg) {
  const now = Date.now();
  if (
    _dbCache.sheets.length &&
    _dbCache.spreadsheetId === cfg.databaseSpreadsheetId &&
    now - _dbCache.loadedAt < AI_CONFIG.CACHE_TTL_MS
  ) {
    return _dbCache;
  }

  const ss = SpreadsheetApp.openById(cfg.databaseSpreadsheetId);
  const allSheets = ss.getSheets();
  const selectedSheets = cfg.databaseSheetName
    ? allSheets.filter(function (s) {
        return s.getName() === cfg.databaseSheetName;
      })
    : allSheets;

  if (cfg.databaseSheetName && !selectedSheets.length) {
    throw new Error(
      "No existe la hoja configurada en DATABASE_SHEET_NAME: " +
        cfg.databaseSheetName,
    );
  }

  const indexedSheets = selectedSheets
    .map(indexSingleSheet_)
    .filter(function (s) {
      return isSheetAllowedForAI_(s.sheetName) && s.rows.length > 0;
    });

  _dbCache = {
    loadedAt: now,
    spreadsheetId: cfg.databaseSpreadsheetId,
    spreadsheetName: ss.getName(),
    sheets: indexedSheets,
  };

  return _dbCache;
}

function indexSingleSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2 || lastCol < 1) {
    return { sheetName: sheet.getName(), rows: [] };
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  if (!values || values.length < 2) {
    return { sheetName: sheet.getName(), rows: [] };
  }

  const headers = values[0].map(sanitizeHeader_);
  const rows = [];

  for (var i = 1; i < values.length; i++) {
    const rawRow = values[i];
    if (isDisplayRowEmpty_(rawRow)) continue;

    const rowObject = {};
    for (var j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) continue;
      rowObject[header] = String(rawRow[j] == null ? "" : rawRow[j]).trim();
    }

    const joined = Object.keys(rowObject)
      .map(function (k) {
        return k + ": " + rowObject[k];
      })
      .join(" | ");

    rows.push({
      rowNumber: i + 1,
      rowObject: rowObject,
      searchText: normalizeForSearch_(joined),
    });
  }

  return {
    sheetName: sheet.getName(),
    rows: rows,
  };
}

function isDisplayRowEmpty_(row) {
  for (var i = 0; i < row.length; i++) {
    if (String(row[i] == null ? "" : row[i]).trim() !== "") return false;
  }
  return true;
}

function scoreDbRow_(queryNorm, terms, rowSearchText, rowObject) {
  let score = 0;
  const haystack = " " + rowSearchText + " ";
  const keysNorm = normalizeForSearch_(Object.keys(rowObject).join(" "));

  if (queryNorm && rowSearchText.indexOf(queryNorm) >= 0) {
    score += 80;
  }

  for (var i = 0; i < terms.length; i++) {
    const term = terms[i];
    const exactWhole = haystack.indexOf(" " + term + " ") >= 0;
    const partial = rowSearchText.indexOf(term) >= 0;
    const keyHit = keysNorm.indexOf(term) >= 0;
    const idLike = isLikelyIdToken_(term);

    if (exactWhole) score += idLike ? 25 : 10;
    else if (partial) score += idLike ? 12 : 4;

    if (keyHit) score += 3;
  }

  return score;
}

/* =========================
 * SCORING / TOKENS
 * ========================= */

function scoreTextByTerms_(searchText, terms) {
  if (!searchText || !terms.length) return 0;

  let score = 0;
  const haystack = " " + searchText + " ";

  for (var i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (haystack.indexOf(" " + term + " ") >= 0) score += 5;
    else if (searchText.indexOf(term) >= 0) score += 2;
  }

  return score;
}

function splitIntoUniqueTerms_(text) {
  const stop = new Set([
    "de",
    "del",
    "la",
    "las",
    "el",
    "los",
    "un",
    "una",
    "unos",
    "unas",
    "y",
    "o",
    "u",
    "a",
    "ante",
    "bajo",
    "con",
    "contra",
    "desde",
    "durante",
    "en",
    "entre",
    "hacia",
    "hasta",
    "para",
    "por",
    "segun",
    "según",
    "sin",
    "sobre",
    "tras",
    "que",
    "como",
    "cómo",
    "cual",
    "cuál",
    "cuales",
    "cuáles",
    "cuando",
    "cuándo",
    "donde",
    "dónde",
    "manual",
    "empresa",
    "mercurio",
    "base",
    "datos",
    "tabla",
    "planilla",
    "hoja",
  ]);

  const words = normalizeForSearch_(text)
    .split(/\s+/)
    .map(function (w) {
      return w.trim();
    })
    .filter(function (w) {
      return w.length >= 2 && !stop.has(w);
    });

  return Array.from(new Set(words)).slice(0, 25);
}

function isLikelyIdToken_(token) {
  const t = String(token || "");
  return (
    /^[a-z]{1,10}[_-]?\d+[a-z0-9_-]*$/i.test(t) ||
    (/^[a-z0-9]{4,}$/i.test(t) && /\d/.test(t))
  );
}

/* =========================
 * HISTORIAL
 * ========================= */

function normalizeHistoryForGemini_(history) {
  if (!Array.isArray(history) || !history.length) return [];

  return history
    .slice(-AI_CONFIG.MAX_HISTORY_ITEMS)
    .map(function (item) {
      if (typeof item === "string") {
        return {
          role: "user",
          parts: [{ text: sanitizeText_(item, 8000) }],
        };
      }

      const rawRole = String(
        (item && (item.role || item.author || item.sender || "user")) || "user",
      ).toLowerCase();

      const role =
        rawRole === "assistant" || rawRole === "model" ? "model" : "user";

      let text = "";
      if (typeof item.text === "string") {
        text = item.text;
      } else if (typeof item.content === "string") {
        text = item.content;
      } else if (Array.isArray(item.parts)) {
        text = item.parts
          .map(function (part) {
            if (typeof part === "string") return part;
            if (part && typeof part.text === "string") return part.text;
            return "";
          })
          .filter(Boolean)
          .join("\n");
      } else if (Array.isArray(item.content)) {
        text = item.content
          .map(function (part) {
            if (typeof part === "string") return part;
            if (part && typeof part.text === "string") return part.text;
            return "";
          })
          .filter(Boolean)
          .join("\n");
      }

      text = sanitizeText_(text, 8000);
      if (!text) return null;

      return {
        role: role,
        parts: [{ text: text }],
      };
    })
    .filter(Boolean);
}

/* =========================
 * UTILIDADES DE DATOS
 * ========================= */

function sanitizeHeader_(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text
    .replace(/\s+/g, "_")
    .replace(/[^\wáéíóúÁÉÍÓÚñÑ]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeForSearch_(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeText_(value, maxLen) {
  return truncate_(
    String(value == null ? "" : value)
      .replace(/\u0000/g, " ")
      .replace(/\r/g, "")
      .trim(),
    maxLen || 10000,
  );
}

function truncate_(text, maxLen) {
  const str = String(text || "");
  if (!maxLen || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

function safeJsonParse_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/* =========================
 * CACHE / DEBUG / TESTS
 * ========================= */

function resetAICaches() {
  _manualCache = {
    loadedAt: 0,
    fileId: "",
    fileName: "",
    text: "",
    chunks: [],
    headingIndex: [],
  };

  _dbCache = {
    loadedAt: 0,
    spreadsheetId: "",
    spreadsheetName: "",
    sheets: [],
  };
}

function debugManualSource() {
  const cfg = getRuntimeConfig_();
  const manual = loadManualFromDrive_(cfg);
  Logger.log(
    JSON.stringify(
      {
        fileId: manual.fileId,
        fileName: manual.fileName,
        chars: manual.text.length,
        chunks: manual.chunks.length,
        headings: manual.headingIndex.length,
      },
      null,
      2,
    ),
  );
}

function debugDatabaseSource() {
  const cfg = getRuntimeConfig_();
  const db = loadDatabaseIndex_(cfg);
  Logger.log(
    JSON.stringify(
      {
        spreadsheetId: db.spreadsheetId,
        spreadsheetName: db.spreadsheetName,
        sheets: db.sheets.map(function (s) {
          return {
            sheetName: s.sheetName,
            rows: s.rows.length,
            sample: s.rows[0] ? s.rows[0].rowObject : {},
          };
        }),
      },
      null,
      2,
    ),
  );
}

function showConfiguredDataSources() {
  return {
    manualFileId: DATA_SOURCE_CONFIG.MANUAL_FILE_ID,
    databaseSpreadsheetId: DATA_SOURCE_CONFIG.DATABASE_SPREADSHEET_ID,
    databaseSheetName:
      DATA_SOURCE_CONFIG.DATABASE_SHEET_NAME || "(todas las hojas)",
  };
}

function testAskAssistant() {
  const result = apiAskAssistant(
    "¿Qué dice el manual sobre criticidad de equipos?",
    [],
  );
  Logger.log(JSON.stringify(result, null, 2));
}

function showRequiredScriptProperties() {
  return {
    GEMINI_API_KEY: "<<tu_api_key>>",
    GEMINI_MODEL: "gemini-2.5-flash",
    APP_TIMEZONE: Session.getScriptTimeZone(),
  };
}

/* =========================
 * WIZARDS AUXILIARES
 * ========================= */

function apiAskGeminiRca(history) {
  _requireAuthenticatedUser_();
  try {
    const cfg = getRuntimeConfig_();

    const contents = (history || []).map(function (item) {
      return {
        role: item.role === "model" ? "model" : "user",
        parts: Array.isArray(item.parts)
          ? item.parts
          : [{ text: String(item.parts || "") }],
      };
    });

    const payload = {
      contents: contents,
      generationConfig: {
        temperature: 0.3,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
    };

    const result = callGemini_(payload, cfg.apiKey, cfg.model);
    if (!result.success) {
      return "Lo siento, ocurrió un error: " + result.message;
    }
    return result.text;
  } catch (e) {
    return "Error al conectar con la IA: " + (e.message || e.toString());
  }
}

function apiAskGeminiDefect(history) {
  _requireAuthenticatedUser_();
  try {
    const cfg = getRuntimeConfig_();

    const contents = (history || []).map(function (item) {
      return {
        role: item.role === "model" ? "model" : "user",
        parts: Array.isArray(item.parts)
          ? item.parts
          : [{ text: String(item.parts || "") }],
      };
    });

    const payload = {
      contents: contents,
      generationConfig: {
        temperature: 0.3,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    };

    const result = callGemini_(payload, cfg.apiKey, cfg.model);
    if (!result.success) {
      return "Lo siento, ocurrió un error: " + result.message;
    }
    return result.text;
  } catch (e) {
    return "Error al conectar con la IA: " + (e.message || e.toString());
  }
}

function apiAnalyzeWorkOrderDeferral(context) {
  _requireAuthenticatedUser_();
  context = context || {};

  const systemPrompt =
    "Actúa como un planificador técnico naval muy concreto.\n" +
    "Evalúa una SOLICITUD DE DIFERIMIENTO asociada a una ORDEN DE TRABAJO.\n\n" +
    "REGLAS:\n" +
    "1. No apruebes ni rechaces diferimientos: eso lo decide un aprobador humano.\n" +
    "2. Tu tarea es estimar el PLAZO NORMAL de ejecución para una reparación o tarea similar, usando criterio conservador y práctico.\n" +
    "3. Debes analizar si la nueva fecha solicitada requiere realmente un diferimiento formal y qué medidas/restricciones deben imponerse.\n" +
    "4. Debes considerar tipo de tarea, criticidad, equipo, complejidad técnica, necesidad probable de repuestos/proveedor y contexto operativo.\n" +
    "5. Si la información es incompleta, igual entrega una estimación prudente.\n" +
    "6. Responde SOLO JSON válido. Sin texto adicional.\n\n" +
    "FORMATO JSON OBLIGATORIO:\n" +
    '{"IA_Plazo_Normal_Dias":7,"IA_Nivel_Riesgo":"BAJO|MEDIO|ALTO","IA_Justificacion_Plazo":"...","IA_Restriccion_Operativa":"...","Deferral_Medida_Compensatoria":"...","Deferral_Restricciones":"..."}\n\n' +
    "CONTEXTO DE LA OT:\n" +
    "- OT_ID: " + String(context.OT_ID || "") + "\n" +
    "- Embarcación: " + String(context.VesselName || "") + "\n" +
    "- SFI / Equipo: " + String(context.AssetID || "") + "\n" +
    "- Nombre del equipo: " + String(context.Equipo || "") + "\n" +
    "- TaskID origen: " + String(context.TaskID || "") + "\n" +
    "- Tipo de OT: " + String(context.Type || "") + "\n" +
    "- Criticidad: " + String(context.Criticidad || "") + "\n" +
    "- Fecha Apertura: " + String(context.OpenDate || "") + "\n" +
    "- Fecha Planificada: " + String(context.PlannedDate || "") + "\n" +
    "- Fecha de vencimiento actual: " + String(context.DueDate || "") + "\n" +
    "- Nueva fecha solicitada: " + String(context.RequestedNewDate || "") + "\n" +
    "- Descripción OT: " + String(context.Remarks || "") + "\n" +
    "- Razón del diferimiento: " + String(context.DeferralReason || "") + "\n" +
    "- Descripción defecto asociado: " + String(context.DefectDescription || "") + "\n" +
    "- Acción inmediata previa: " + String(context.Accion_Inmediata || "") + "\n" +
    "- Medida compensatoria previa: " + String(context.Medida_Compensatoria || "") + "\n" +
    "- Tarea de mantenimiento origen: " + String(context.MaintenanceTask || "") + "\n" +
    "- Criterio de aceptación origen: " + String(context.MaintenanceCriteria || "");

  try {
    const response = _callGeminiRaw(systemPrompt);
    const jsonMatch = String(response || "").match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, message: "La IA no devolvió un JSON válido para la OT." };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      success: true,
      IA_Plazo_Normal_Dias: parsed.IA_Plazo_Normal_Dias || "",
      IA_Nivel_Riesgo: parsed.IA_Nivel_Riesgo || "",
      IA_Justificacion_Plazo: parsed.IA_Justificacion_Plazo || "",
      IA_Restriccion_Operativa: parsed.IA_Restriccion_Operativa || "",
      Deferral_Medida_Compensatoria: parsed.Deferral_Medida_Compensatoria || "",
      Deferral_Restricciones: parsed.Deferral_Restricciones || "",
    };
  } catch (e) {
    return { success: false, message: "Error al conectar con la IA de OT: " + (e.message || e.toString()) };
  }
}

function _extractJsonFromGeminiText_(responseText) {
  const raw = String(responseText || '').trim();
  if (!raw) throw new Error('La IA devolvió una respuesta vacía.');

  const wholeParsed = safeJsonParse_(raw);
  if (wholeParsed) return wholeParsed;

  const fencedBlocks = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch = null;
  while ((fenceMatch = fenceRegex.exec(raw))) {
    fencedBlocks.push(String(fenceMatch[1] || '').trim());
  }

  for (var i = 0; i < fencedBlocks.length; i++) {
    const parsedFence = _tryParseLooseJsonText_(fencedBlocks[i]);
    if (parsedFence) return parsedFence;
  }

  const balancedBlocks = _extractBalancedJsonCandidates_(raw);
  for (var j = 0; j < balancedBlocks.length; j++) {
    const parsedBlock = _tryParseLooseJsonText_(balancedBlocks[j]);
    if (parsedBlock) return parsedBlock;
  }

  throw new Error('La IA no devolvió un JSON válido.');
}

function _tryParseLooseJsonText_(text) {
  const source = String(text || '').trim();
  if (!source) return null;

  const direct = safeJsonParse_(source);
  if (direct) return direct;

  const normalized = source
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

  const normalizedParsed = safeJsonParse_(normalized);
  if (normalizedParsed) return normalizedParsed;

  return null;
}

function _extractBalancedJsonCandidates_(text) {
  const source = String(text || '');
  const candidates = [];
  const openings = ['{', '['];

  for (var start = 0; start < source.length; start++) {
    if (openings.indexOf(source[start]) === -1) continue;

    var stack = [];
    var inString = false;
    var quote = '';
    var escapeNext = false;

    for (var end = start; end < source.length; end++) {
      var ch = source[end];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (inString) {
        if (ch === '\\') {
          escapeNext = true;
        } else if (ch === quote) {
          inString = false;
          quote = '';
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }

      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }

      if (ch === '}' || ch === ']') {
        if (!stack.length) break;
        var open = stack.pop();
        if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) break;
        if (!stack.length) {
          candidates.push(source.slice(start, end + 1));
          start = end;
          break;
        }
      }
    }
  }

  return candidates;
}

function _normalizeMaintenanceRecommendationAxis_(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return 'CONFIABILIDAD';
  if (normalized === 'COSTO' || normalized === 'COSTO_STOCK' || normalized === 'COSTO-STOCK' || normalized === 'COSTO/STOCK') return 'COSTO/STOCK';
  if (normalized === 'CUMPLIMIENTO' || normalized === 'ISM' || normalized === 'DOCUMENTAL' || normalized === 'COMPLIANCE') return 'CUMPLIMIENTO';
  return 'CONFIABILIDAD';
}

function _normalizeMaintenanceRecommendations_(rawRecommendations) {
  const normalized = Array.isArray(rawRecommendations) ? rawRecommendations : [];
  const parsed = normalized.map(function(item) {
    if (item && typeof item === 'object') {
      const text = String(item.text || item.recommendation || item.action || '').trim();
      if (!text) return null;
      return {
        axis: _normalizeMaintenanceRecommendationAxis_(item.axis || item.tag || item.category),
        text: text,
      };
    }
    const textValue = String(item || '').trim();
    if (!textValue) return null;
    return {
      axis: 'CONFIABILIDAD',
      text: textValue,
    };
  }).filter(Boolean);

  if (!parsed.length) {
    parsed.push({
      axis: 'CONFIABILIDAD',
      text: 'Mantener la configuracion actual del SGM y continuar el monitoreo de tendencias para detectar nuevas oportunidades de optimizacion.',
    });
  }

  return parsed;
}

function _formatMaintenanceRecommendationsText_(recommendations) {
  return (recommendations || []).map(function(item) {
    return `[${item.axis}] ${item.text}`;
  }).join('\n');
}

function _getMaintenanceInsightsResponseSchema_() {
  return {
    type: 'OBJECT',
    required: ['priority', 'insights', 'recommendations'],
    properties: {
      priority: {
        type: 'STRING',
        enum: ['CRITICO', 'ATENCION', 'NORMAL'],
      },
      insights: {
        type: 'ARRAY',
        items: {
          type: 'STRING',
        },
      },
      recommendations: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: ['axis', 'text'],
          properties: {
            axis: {
              type: 'STRING',
              enum: ['CONFIABILIDAD', 'COSTO/STOCK', 'CUMPLIMIENTO'],
            },
            text: {
              type: 'STRING',
            },
          },
        },
      },
    },
  };
}

function _callGeminiJson_(prompt, options) {
  const settings = options || {};
  const requestOptions = {
    responseMimeType: 'application/json',
    responseSchema: settings.responseSchema || null,
    temperature: typeof settings.temperature === 'number' ? settings.temperature : 0,
    maxOutputTokens: settings.maxOutputTokens || AI_CONFIG.MAX_OUTPUT_TOKENS,
  };

  const firstResponse = _callGeminiRaw(prompt, requestOptions);
  try {
    return _extractJsonFromGeminiText_(firstResponse);
  } catch (firstError) {
    Logger.log('Gemini devolvio JSON invalido. Primer intento: ' + truncate_(firstResponse, 1500));

    const repairPrompt =
      'Convierte la siguiente salida en JSON valido y responde SOLO JSON. No agregues explicaciones.\n\n' +
      'SALIDA ORIGINAL:\n' +
      String(firstResponse || '');

    const repairedResponse = _callGeminiRaw(repairPrompt, requestOptions);
    try {
      return _extractJsonFromGeminiText_(repairedResponse);
    } catch (repairError) {
      Logger.log('Gemini devolvio JSON invalido. Segundo intento: ' + truncate_(repairedResponse, 1500));
      throw repairError;
    }
  }
}

function apiAnalyzeDailyMaintenanceInsights(vesselName, reportDate) {
  _requireAuthenticatedUser_();

  const contextResult = _buildDailyMaintenanceInsightsContext_(vesselName, reportDate);
  if (!contextResult || contextResult.success === false) {
    return {
      success: false,
      message: contextResult?.message || 'No se pudo construir el contexto histórico para la IA.',
    };
  }

  const context = contextResult.context || {};
  const systemPrompt =
    'Actúa como un ingeniero de confiabilidad naval senior, especializado en OPTIMIZAR el sistema de gestion de mantenimiento.\n' +
    'Debes analizar historiales consolidados de una embarcación para detectar patrones, debilidades sistémicas y oportunidades de mejora del SGM.\n\n' +
    'REGLAS:\n' +
    '1. Basa tus conclusiones SOLO en el contexto entregado.\n' +
    '2. Prioriza recurrencias, presión de backlog, diferimientos repetidos, fallas repetidas, problemas de stock y fallas de inspección.\n' +
    '3. Balancea SIEMPRE tres ejes del SGM: (a) confiabilidad tecnica, (b) costo y disponibilidad de repuestos/recursos, (c) cumplimiento ISM, inspecciones, certificaciones y disciplina documental.\n' +
    '4. Enfócate en palancas de optimización del SGM: frecuencias PM, estrategia preventiva vs. por condición, parametrización de stock MIN/ROP, reglas de diferimiento, uso de RCA/CAPA, planificación de OTs, criticidad, inspecciones, certificación y disciplina documental.\n' +
    '5. Evita generalidades. No te limites a decir "cerrar OT" o "reparar equipo"; propone ajustes del sistema de gestión que prevengan repetición.\n' +
    '6. Cada recomendación debe ser accionable y formulada como mejora del sistema, por ejemplo: ajustar frecuencia, crear gatillo por condición, disparar RCA, revisar stock mínimo, redefinir política de diferimientos, segmentar backlog, reforzar checklist, mejorar disciplina de cierre/evidencia, etc.\n' +
    '7. Cada recomendación debe venir etiquetada con uno de estos ejes: CONFIABILIDAD, COSTO/STOCK, CUMPLIMIENTO.\n' +
    '8. Intenta que el conjunto de recomendaciones quede equilibrado entre confiabilidad, costo/stock y cumplimiento, salvo que el contexto justifique priorizar claramente uno de esos ejes.\n' +
    '9. Si no detectas patrones significativos, indícalo y sugiere mantener la configuración actual con monitoreo.\n' +
    '10. Responde SOLO JSON válido. Sin texto adicional.\n' +
    '11. Limita la salida a máximo 5 hallazgos y 6 recomendaciones. Cada texto debe ser puntual y cerrar la idea completa.\n\n' +
    'FORMATO JSON OBLIGATORIO:\n' +
    '{"priority":"CRITICO|ATENCION|NORMAL","insights":["..."],"recommendations":[{"axis":"CONFIABILIDAD|COSTO/STOCK|CUMPLIMIENTO","text":"..."}]}\n\n' +
    'CONTEXTO HISTÓRICO CONSOLIDADO (180 días):\n' +
    JSON.stringify(context);

  try {
    const parsed = _callGeminiJson_(systemPrompt, {
      responseSchema: _getMaintenanceInsightsResponseSchema_(),
      temperature: 0,
      maxOutputTokens: 1536,
    });
    const insights = Array.isArray(parsed.insights) ? parsed.insights.map(function(item) { return String(item || '').trim(); }).filter(Boolean) : [];
    const recommendations = _normalizeMaintenanceRecommendations_(parsed.recommendations);
    if (!insights.length) insights.push('No se detectaron patrones historicos relevantes que justifiquen cambios inmediatos en el sistema de gestion de mantenimiento.');

    return {
      success: true,
      priority: String(parsed.priority || 'NORMAL').trim().toUpperCase() || 'NORMAL',
      insights: insights,
      recommendations: recommendations,
      insightsText: insights.join('\n'),
      recommendationsText: _formatMaintenanceRecommendationsText_(recommendations),
      insightsJson: {
        priority: String(parsed.priority || 'NORMAL').trim().toUpperCase() || 'NORMAL',
        insights: insights,
        recommendations: recommendations,
        context: {
          vesselName: context.vesselName,
          reportDate: context.reportDate,
          historicalWindowDays: context.historicalWindowDays,
        },
      },
    };
  } catch (e) {
    return {
      success: false,
      message: 'Error al conectar con la IA de tendencias de mantenimiento: ' + (e.message || e.toString()),
    };
  }
}

function apiBarrierInterviewer(context, history) {
  _requireAuthenticatedUser_();
  history = history || [];

  const systemPrompt =
    "Actúa como un INGENIERO MENTOR DE SEGURIDAD OPERATIVA (Safety Coach).\n" +
    "Tu misión es entrevistar al usuario para determinar si una FALLA o DEFECTO reportado ha afectado una BARRERA DE SEGURIDAD.\n\n" +
    "MODO DE INTERACCIÓN:\n" +
    '- Si el usuario dice "no entiendo", "ayuda" o parece confundido: DEBES ser pedagógico.\n' +
    "- El tono debe ser profesional pero colaborativo, no punitivo.\n" +
    "- Ayuda al usuario a identificar la barrera dándole opciones si es necesario.\n\n" +
    "REGLAS DE ORO:\n" +
    "1. NO deduzcas automáticamente sin preguntar hechos.\n" +
    '2. NO preguntes "¿Es esto una barrera?". Pregunta sobre hechos técnicos operativos.\n' +
    "3. Sé BREVE pero EXPLICATIVO. Máximo 3 a 5 preguntas antes de concluir.\n" +
    "4. Usa el contexto técnico para personalizar la ayuda.\n\n" +
    "REGLAS DE SEGURIDAD OPERATIVA (CRÍTICAS):\n" +
    "- Si barrier_status es OUT_OF_SERVICE o BYPASSED, compensatory_measure_required DEBE ser YES.\n" +
    "- Si no existe barrera alternativa, deferral_impact DEBE ser BLOCKED.\n" +
    "- Si hay ambigüedad persistente, deferral_impact DEBE ser REVIEW_REQUIRED.\n\n" +
    "FORMATO DE SALIDA OBLIGATORIO JSON:\n" +
    '{"question": "Texto"}\n' +
    "o\n" +
    '{"conclusion": {"barrier_affected":"YES|NO","barrier_name":"...","barrier_type":"PREVENTIVE|DETECTIVE|MITIGATIVE|RECOVERY","barrier_status":"HEALTHY|DEGRADED|OUT_OF_SERVICE|BYPASSED","alternative_barrier_exists":"YES|NO|UNKNOWN","compensatory_measure_required":"YES|NO","compensatory_measure_description":"...","deferral_impact":"ALLOWED|REVIEW_REQUIRED|BLOCKED","rca_recommended":"YES|NO","capa_recommended":"YES|NO","assessment_basis":"..."}}\n\n' +
    "CONTEXTO DEL DEFECTO:\n" +
    "- Embarcación: " +
    String((context && context.Embarcacion) || "") +
    "\n" +
    "- Equipo (SFI): " +
    String((context && context.SFI) || "") +
    "\n" +
    "- Criticidad MOC: " +
    String((context && context.Clasificacion_Falla) || "") +
    "\n" +
    "- Descripción: " +
    String((context && context.Descripcion_Sintoma) || "") +
    "\n" +
    "- Acción Inmediata: " +
    String((context && context.Accion_Inmediata) || "") +
    "\n" +
    "- Estado Operativo: " +
    String((context && context.Estado_Operativo) || "") +
    "\n\n" +
    "HISTORIAL DE ENTREVISTA:\n" +
    history
      .map(function (h) {
        return "IA: " + String(h.q || "") + "\nUsuario: " + String(h.a || "");
      })
      .join("\n");

  try {
    const response = _callGeminiRaw(systemPrompt);
    const jsonMatch = String(response || "").match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);

    return {
      question:
        "No pude procesar la lógica. ¿Podrías describir con más detalle el impacto técnico de la falla?",
    };
  } catch (e) {
    return {
      question:
        "Error de conexión con el motor IA. Intenta de nuevo en unos segundos.",
    };
  }
}

function _callGeminiRaw(prompt, options) {
  const cfg = getRuntimeConfig_();
  const settings = options || {};
  const generationConfig = {
    maxOutputTokens: settings.maxOutputTokens || AI_CONFIG.MAX_OUTPUT_TOKENS,
    temperature: typeof settings.temperature === 'number' ? settings.temperature : 0.2,
    responseMimeType: settings.responseMimeType || 'application/json',
  };
  if (settings.responseSchema) generationConfig.responseSchema = settings.responseSchema;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: String(prompt || "") }],
      },
    ],
    generationConfig: generationConfig,
  };

  const result = callGemini_(payload, cfg.apiKey, cfg.model);
  if (result && result.success && result.text) return result.text;

  throw new Error(
    "Respuesta inválida de Gemini: " +
      ((result && result.message) || 'Respuesta vacía o incompleta.'),
  );
}
