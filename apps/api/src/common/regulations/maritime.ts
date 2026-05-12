/**
 * Maritime regulations database — single source of truth.
 *
 * ─── Reglas de oro ─────────────────────────────────────────────────────────
 *
 * 1. CUALQUIER valor numérico safety-critical (umbrales de gas, concentraciones
 *    de wear metals, pH, distancias, tiempos) vive ACÁ — no en prompts ni en
 *    código de servicios. Si la IA o un servicio necesita un número, lo
 *    importa de este módulo.
 *
 * 2. Cada entrada tiene:
 *      - source: cita exacta de la norma/estándar primario (capítulo, párrafo)
 *      - confidence: "verified" o "industry-standard"
 *          · verified = sabemos que la norma existe y cubre el tema descripto
 *          · industry-standard = la práctica es universal en la industria,
 *            pero la fuente primaria puede ser diffusa (OEM, P&I, hábito) y
 *            NO debe presentarse al usuario como "según norma X" si no lo es
 *      - verifiedBy / verifiedDate: trazabilidad para auditoría
 *      - note: contexto, matices, fuentes alternativas
 *
 * 3. NO copiamos texto literal extenso de las normas (copyright). Citamos
 *    sección + describimos lo aplicable en lenguaje propio.
 *
 * 4. Para prompts: usar las funciones build*Context() que arman el bloque
 *    de contexto a inyectar en el system prompt de la IA. El prompt debe
 *    instruir explícitamente: "usá ÚNICAMENTE los umbrales y referencias
 *    del contexto. NO inventes números. Si no hay umbral en el contexto,
 *    no cites uno".
 *
 * 5. La revisión humana de cada entrada es OBLIGATORIA antes de ir a producción
 *    crítica (vetting). El campo verifiedBy refleja eso.
 */

export type RegulationConfidence = "verified" | "industry-standard";

export interface MaritimeRegulation {
  /** Identificador interno. */
  key: string;
  /** Cita exacta de la fuente: norma + capítulo/sección. */
  source: string;
  /** Notas, alcance, fuentes alternativas. */
  note: string;
  /** Nivel de confianza editorial sobre la cita. */
  confidence: RegulationConfidence;
  /** Quién y cuándo verificó. */
  verifiedBy: string;
  /** ISO date YYYY-MM-DD. */
  verifiedDate: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// BLOCK 1 — Permit to Work
// ═════════════════════════════════════════════════════════════════════════════

// ─── Enclosed Space Entry — gas test thresholds ─────────────────────────────

export const ENCLOSED_SPACE_ENTRY_THRESHOLDS = {
  o2_min_pct: 19.5,
  o2_max_pct: 23,
  lel_max_pct: 1,
  h2s_max_ppm: 10,
  co_max_ppm: 50,
} as const;

export const ENCLOSED_SPACE_ENTRY_REGS: MaritimeRegulation[] = [
  {
    key: "SOLAS_XI-1_7",
    source: "SOLAS Chapter XI-1, Regulation 7 (vigente desde 2016-07-01, vía Res. MSC.380(94))",
    note: "Exige que los buques (excepto ciertas exenciones) lleven a bordo instrumentos portátiles de medición atmosférica con capacidad de medir O₂, gases inflamables, H₂S y CO antes de entrar a espacios confinados. NO especifica umbrales numéricos — sólo la obligación del equipamiento.",
    confidence: "verified",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
  {
    key: "SOLAS_III_19",
    source: "SOLAS Chapter III, Regulation 19.3.6 (enmienda 2014, vigente 2015-01-01)",
    note: "Exige drills de entrada a y rescate en espacios confinados con periodicidad no mayor a 2 meses. Los participantes deben familiarizarse con los riesgos atmosféricos del espacio.",
    confidence: "verified",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
  {
    key: "IMO_A_1050_27",
    source: "IMO Resolution A.1050(27), adoptada 2011-11-30 — 'Revised Recommendations for Entering Enclosed Spaces Aboard Ships'",
    note: "Resolución de Asamblea — NO vinculante por sí misma, sólo recomendación. Establece el procedimiento de entrada: identificación del espacio, autorización, ventilación, atmosphere testing, comms, standby person, equipo de rescate. NO contiene tabla numérica unificada de umbrales — describe el procedimiento, los valores específicos los toma de la industria (ej. ISGOTT para tankers).",
    confidence: "verified",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
  {
    key: "ISGOTT_6_CH11",
    source: "ISGOTT 6 (International Safety Guide for Oil Tankers and Terminals, 6.ª edición, OCIMF/ICS/IAPH 2020), Chapter 11 — 'Hazardous Areas'",
    note: "Referencia industrial principal para tankers de hidrocarburos. Define los umbrales operativos de entrada que usa este sistema (O₂ 19.5%–23%, hidrocarburos <1% LEL, H₂S <10 ppm). Aceptado universalmente por flag states, P&I clubs, OCIMF, vetting SIRE/RightShip. NO es IMO directamente — es industrial, pero efectivamente la fuente práctica.",
    confidence: "industry-standard",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
];

// ─── Hot Work ───────────────────────────────────────────────────────────────

export const HOT_WORK_THRESHOLDS = {
  lel_max_pct_near_hydrocarbons: 1, // Para hot work cerca de hidrocarburos: <1% LEL antes de autorizar
} as const;

export const HOT_WORK_REGS: MaritimeRegulation[] = [
  {
    key: "SOLAS_II-2_10",
    source: "SOLAS Chapter II-2, Regulation 10 — 'Fire fighting'",
    note: "Define requerimientos generales contra incendio (equipos de extinción, sistemas fijos, ronda de incendios). No define un permit-to-work formal para hot work — esa especificidad la cubre el SMS del operador y, para tankers, ISGOTT.",
    confidence: "verified",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
  {
    key: "ISGOTT_6_CH9",
    source: "ISGOTT 6 Chapter 9 — 'Hot Work'",
    note: "Define el procedimiento de PTW para hot work en tankers: clasificación de áreas seguras vs inseguras, requerimiento de gas freeing del espacio adyacente si el trabajo es cerca de cargo/slop tanks, fire watch, equipos de medición continua. Umbral típico: <1% LEL antes de autorizar y monitoreo continuo durante el trabajo.",
    confidence: "industry-standard",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
];

// ─── Working Aloft ──────────────────────────────────────────────────────────

export const WORKING_ALOFT_REGS: MaritimeRegulation[] = [
  {
    key: "MLC_2006_A4_3",
    source: "Maritime Labour Convention 2006, Standard A4.3 — 'Health and safety protection and accident prevention'",
    note: "Obliga al estado de bandera a regular medidas de prevención de accidentes a bordo. No define un umbral específico para trabajo en altura — el detalle queda al SMS del operador. La guía referencial más usada (no internacional) es 'Code of Safe Working Practices for Merchant Seafarers' (UK MCA).",
    confidence: "verified",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
  {
    key: "ISM_CODE_7",
    source: "ISM Code, Section 7 — 'Development of plans for shipboard operations'",
    note: "Exige procedimientos documentados para operaciones a bordo, incluyendo trabajos críticos como altura. El detalle (arneses, anclajes, viento límite, comms) queda al SMS de la compañía. SIRE 2.0 espera ver: arnés de cuerpo completo con anclaje doble, área debajo del trabajo despejada y demarcada, evaluación previa de viento/condiciones, comms bidireccionales continuas.",
    confidence: "verified",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
];

// ─── Electrical Isolation (LOTO) ────────────────────────────────────────────

export const ELECTRICAL_ISOLATION_REGS: MaritimeRegulation[] = [
  {
    key: "SOLAS_II-1_D",
    source: "SOLAS Chapter II-1, Part D — 'Electrical installations'",
    note: "Establece requerimientos para instalaciones eléctricas de a bordo (alimentación principal y de emergencia, protección contra contacto, separación de circuitos). NO define LOTO directamente — el procedimiento de aislamiento está en el SMS del operador.",
    confidence: "verified",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
  {
    key: "IEC_60092",
    source: "Serie IEC 60092 — 'Electrical installations in ships'",
    note: "Estándar técnico IEC, referencia para diseño y operación eléctrica a bordo. Estándar técnico no regulatorio (IEC ≠ IMO). SIRE espera procedimiento LOTO documentado: aislar el punto, candado físico + tarjeta identificatoria, verificar tensión cero con instrumento calibrado, identificar puntos de energía residual (capacitores, UPS, ferro-resonantes).",
    confidence: "industry-standard",
    verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
    verifiedDate: "2026-05-12",
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// BLOCK 2 — Fluid analyses (oil / water / fuel)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Referencias normativas/estándares para los DEFAULT_THRESHOLDS de fluid-analyses-service.
 *
 * AVISO IMPORTANTE sobre niveles de confianza:
 *   - Wear metals en aceite (Fe, Cu, Cr, Pb, Si): los umbrales que usa el
 *     sistema son práctica industrial (CIMAC + OEM marinos como MAN, Wartsila,
 *     MAK). NO existe un valor numérico único definido por una norma ASTM/ISO
 *     específica para "marine engine 4-stroke". Los marcamos industry-standard.
 *   - ISO 4406 (hidráulico) e ISO 8217 (combustible) sí son normas con tabla
 *     numérica clara. Verified.
 *   - MARPOL Annex VI Reg 14 (azufre 0.50% global / 0.10% ECA): verified.
 *   - pH y conductividad en boiler/cooling: práctica industrial OEM-driven.
 */

export const FLUID_ANALYSIS_REGS_BY_TYPE: Record<string, MaritimeRegulation[]> = {
  ENGINE_OIL: [
    {
      key: "CIMAC_LUBE_GUIDELINES",
      source: "CIMAC (International Council on Combustion Engines), 'Recommendations regarding the lubrication of medium-speed diesel engines' (varios papers desde 1986; actualizaciones periódicas)",
      note: "Referencia industrial principal para condemnation limits de aceite en motores diesel marinos medianos. Los umbrales de hierro (Fe), cobre (Cu), cromo (Cr), plomo (Pb), silicio (Si), agua, dilución por combustible y TBN que usa el sistema están alineados con esta guía + manuales OEM (MAN B&W, Wartsila, MAK). NO hay un valor único 'oficial' — el OEM siempre tiene la última palabra.",
      confidence: "industry-standard",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
    {
      key: "ASTM_D4378",
      source: "ASTM D4378 — 'Standard Practice for In-Service Monitoring of Mineral Turbine Oils for Steam, Gas, and Combined Cycle Turbines'",
      note: "Práctica de monitoreo de aceite en servicio. Citable como referencia general de tendencia + interpretación, aunque originalmente se enfoca en turbinas industriales. Aplicable conceptualmente a aceites de motor por la metodología (toma de muestra, trend analysis).",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],

  HYDRAULIC_OIL: [
    {
      key: "ISO_4406",
      source: "ISO 4406:2021 — 'Hydraulic fluid power — Fluids — Method for coding the level of contamination by solid particles'",
      note: "Código de limpieza de fluidos hidráulicos. Define la nomenclatura (ej. 18/16/13) que indica número de partículas por tamaño. El sistema usa el parámetro 'iso' (suma de los tres componentes del código) con umbral caution 50 / critical 60 — alineado con práctica de equipos servo-hidráulicos críticos.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
    {
      key: "ISO_11171",
      source: "ISO 11171 — 'Hydraulic fluid power — Calibration of automatic particle counters for liquids'",
      note: "Calibración de contadores de partículas — relevante para validar que la lectura ISO 4406 es comparable entre laboratorios.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],

  GEARBOX_OIL: [
    {
      key: "OEM_GEARBOX_LIMITS",
      source: "Limites OEM (manuales de cajas reductoras marinas: ZF, Reintjes, Twin Disc, etc.) + práctica de laboratorios de tribología",
      note: "No hay norma única. Los umbrales (Fe < 200 ppm, Cu < 80 ppm, agua < 0.3%) reflejan práctica industrial. El laboratorio analizador usualmente provee el criterio basado en el OEM del equipo. Para una cita defendible: 'según práctica de tribología y manual OEM del fabricante de la caja'.",
      confidence: "industry-standard",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],

  FUEL_DIESEL: [
    {
      key: "ISO_8217",
      source: "ISO 8217:2017 — 'Petroleum products — Fuels (class F) — Specifications of marine fuels'",
      note: "Especificación de combustibles marinos. Grados destilados DMA / DMZ / DMB / DMX y residuales RMA…RMK. Define máximos de agua, sedimentos, viscosidad, densidad, azufre, punto de inflamación. Los umbrales del sistema (agua < 0.2%, sedimentos < 0.1%, densidad 810–870 kg/m³) están en línea con DMA/DMZ.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
    {
      key: "MARPOL_ANNEX_VI_REG_14",
      source: "MARPOL Anexo VI, Regulación 14 (enmiendas vigentes 2020-01-01) — 'Sulphur oxides and particulate matter'",
      note: "Cap global de azufre en combustibles marinos: 0.50% m/m (= 5000 ppm) desde 2020-01-01. Dentro de Emission Control Areas (ECAs — Báltico, Mar del Norte, costa de Norteamérica, Caribe US, costa china): 0.10% m/m (= 1000 ppm). El umbral 'caution 1000 / critical 5000 ppm' del sistema corresponde a estos dos límites.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],

  FUEL_HFO: [
    {
      key: "ISO_8217_RESIDUAL",
      source: "ISO 8217:2017 grados residuales RMA, RMB, RMD, RME, RMG, RMK",
      note: "Aplica a HFO. Tabla extensiva de propiedades — agua < 0.5%, sedimentos < 0.10%, viscosidad cinemática a 50°C según grado (10–700 cSt), CCAI, densidad, vanadio, alumino+silicio, etc.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
    {
      key: "MARPOL_ANNEX_VI_REG_14",
      source: "MARPOL Anexo VI, Regulación 14 — ver entrada en FUEL_DIESEL",
      note: "Mismos límites de azufre aplican a HFO. El uso de HFO con >0.50% requiere scrubber abierto/cerrado homologado.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],

  COOLING_WATER: [
    {
      key: "OEM_COOLING_LIMITS",
      source: "Especificaciones OEM (MAN — Werkstattbericht 23 84 / Wartsila Service Bulletin / MAK / Caterpillar Marine Engine Fluid Specifications)",
      note: "No hay norma internacional única. Los umbrales (pH 8.3–10, nitritos mínimos para inhibidor, cloruros < 50 ppm) reflejan compromiso entre OEMs principales. La cita defendible: 'según especificación del fabricante del motor'.",
      confidence: "industry-standard",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],

  BOILER_WATER: [
    {
      key: "ASME_BPVC_BOILER_WATER",
      source: "ASME Boiler and Pressure Vessel Code, Section VII (Recommended Guidelines for the Care of Power Boilers)",
      note: "Referencia técnica primaria para tratamiento de boiler water — pH, alcalinidad, sílice, conductividad. Está pensado para calderas industriales pero la metodología es la base de las prácticas marinas. Para calderas marinas, la cita más adecuada es ABS Steel Vessel Rules o el manual del fabricante (Aalborg, Saacke, etc.).",
      confidence: "industry-standard",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],

  POTABLE_WATER: [
    {
      key: "WHO_GDWQ",
      source: "WHO 'Guidelines for Drinking-Water Quality', 4.ª edición + addenda 2022",
      note: "Referencia internacional para parámetros físico-químicos y microbiológicos de agua potable. Define umbrales para coliformes (idealmente 0/100 mL), pH 6.5–8.5, cloro libre residual 0.2–1.0 ppm como objetivo operativo.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
    {
      key: "MLC_2006_REG_3_2",
      source: "Maritime Labour Convention 2006, Regulation 3.2 — 'Food and catering'",
      note: "Obliga al estado de bandera a asegurar provisión de agua potable de calidad adecuada a la tripulación. El detalle queda al estado de bandera + WHO como referencia.",
      confidence: "verified",
      verifiedBy: "Claude Sonnet 4.6 + revisión 2026-05-12",
      verifiedDate: "2026-05-12",
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// Helpers para componer contexto de prompts
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Bloque de contexto a inyectar en el system prompt de un suggestion de PTW.
 * Recibe el PermitType y retorna el texto con thresholds + lista de regulaciones.
 */
export function buildPermitTypeRegulationContext(type: string): string {
  const lines: string[] = [];

  if (type === "ENCLOSED_SPACE_ENTRY") {
    const t = ENCLOSED_SPACE_ENTRY_THRESHOLDS;
    lines.push("ENTRADA A ESPACIO CONFINADO (tanques, sentinas, pañoles cerrados, voids).");
    lines.push("");
    lines.push("UMBRALES DE GAS TEST PARA ENTRADA PERMITIDA (fuente: ISGOTT 6 Cap. 11 — práctica industrial estándar):");
    lines.push(`  - O₂: ${t.o2_min_pct}% – ${t.o2_max_pct}%`);
    lines.push(`  - LEL: < ${t.lel_max_pct}% (umbral de ENTRADA — NO el de alarma sonora de detector personal, que típicamente es 10% LEL)`);
    lines.push(`  - H₂S: < ${t.h2s_max_ppm} ppm`);
    lines.push(`  - CO: < ${t.co_max_ppm} ppm`);
    lines.push("");
    lines.push("REGULACIONES APLICABLES — CITALAS textualmente cuando hagas una recomendación:");
    for (const r of ENCLOSED_SPACE_ENTRY_REGS) {
      lines.push(`  - ${r.source}${r.confidence === "industry-standard" ? "  [estándar industrial — no es IMO directamente]" : ""}`);
    }
  } else if (type === "HOT_WORK") {
    lines.push("TRABAJO EN CALIENTE (soldadura, oxicorte, esmerilado).");
    lines.push("");
    lines.push("Si el trabajo es cerca de hidrocarburos (cargo/slop tanks, líneas de combustible, espacios adyacentes a éstos), aplican:");
    lines.push(`  - Gas freeing del espacio adyacente, verificar < ${HOT_WORK_THRESHOLDS.lel_max_pct_near_hydrocarbons}% LEL antes de autorizar (ISGOTT 6 Cap. 9).`);
    lines.push("  - Monitoreo continuo de LEL durante todo el trabajo.");
    lines.push("");
    lines.push("REGULACIONES APLICABLES — CITALAS:");
    for (const r of HOT_WORK_REGS) {
      lines.push(`  - ${r.source}${r.confidence === "industry-standard" ? "  [estándar industrial]" : ""}`);
    }
  } else if (type === "WORKING_ALOFT") {
    lines.push("TRABAJO EN ALTURA (mástiles, antenas, exterior de casco, escaleras de gato).");
    lines.push("");
    lines.push("No hay umbral numérico universal IMO para 'altura'. Práctica industrial: trabajo en altura es cualquier operación > 2 m del nivel de trabajo o donde una caída pueda causar lesión. Los específicos (anclaje, viento límite, área despejada) están en el SMS del operador.");
    lines.push("");
    lines.push("REGULACIONES APLICABLES:");
    for (const r of WORKING_ALOFT_REGS) {
      lines.push(`  - ${r.source}`);
    }
  } else if (type === "ELECTRICAL_ISOLATION") {
    lines.push("AISLAMIENTO ELÉCTRICO / LOTO (Lock-Out / Tag-Out).");
    lines.push("");
    lines.push("Tensiones de aislamiento, distancias, tiempos: vienen del SMS del operador y del manual OEM. No inventes umbrales.");
    lines.push("");
    lines.push("REGULACIONES APLICABLES:");
    for (const r of ELECTRICAL_ISOLATION_REGS) {
      lines.push(`  - ${r.source}${r.confidence === "industry-standard" ? "  [estándar industrial]" : ""}`);
    }
  } else {
    lines.push("Tipo de permiso desconocido. Aplicá criterio general de seguridad marítima.");
  }

  lines.push("");
  lines.push("REGLA CRÍTICA — SOURCING DE NÚMEROS:");
  lines.push("  - Los umbrales numéricos (concentraciones, distancias, tiempos) DEBEN provenir de los listados arriba.");
  lines.push("  - Cuando uses un número, indicá la fuente entre paréntesis: ej. '(ISGOTT 6 Cap. 11)'.");
  lines.push("  - Si un peligro no tiene umbral en el contexto, descrílo cualitativo — NO inventes una cifra.");
  lines.push("  - NO confundas umbrales: entrada (LEL <1%) ≠ alarma de detector (10% LEL).");

  return lines.join("\n");
}

/**
 * Bloque de contexto para fluid analyses. Le pasa al modelo los estándares
 * aplicables al fluidType + la regla "no inventes números".
 */
export function buildFluidAnalysisRegulationContext(fluidType: string): string {
  const regs = FLUID_ANALYSIS_REGS_BY_TYPE[fluidType];
  const lines: string[] = [];

  lines.push(`ESTÁNDARES/REGULACIONES APLICABLES PARA ${fluidType}:`);
  if (!regs || regs.length === 0) {
    lines.push("  (sin estándares registrados para este tipo — basate sólo en los thresholds que vienen en los datos)");
  } else {
    for (const r of regs) {
      lines.push(`  - ${r.source}${r.confidence === "industry-standard" ? "  [estándar industrial — no necesariamente regulación IMO]" : ""}`);
    }
  }

  lines.push("");
  lines.push("REGLA CRÍTICA — SOURCING DE NÚMEROS:");
  lines.push("  - Los umbrales y rangos que uses al interpretar la muestra DEBEN venir de los thresholds del sistema (vienen en los datos) o de los estándares listados arriba.");
  lines.push("  - Cuando uses un valor de referencia o un rango, citá la fuente entre paréntesis cuando sea posible.");
  lines.push("  - NO inventes umbrales propios. Si una norma del listado no aplica al parámetro concreto, decí 'según especificación del laboratorio analizador' o 'según manual OEM' — no inventes un valor.");

  return lines.join("\n");
}
