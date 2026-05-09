/**
 * Bulk-fill MaintenancePlan.acceptanceCriteria + loto + riskLevel + riskAnalysisResult
 * for every plan in tenant Mercurio that has any of those fields NULL.
 *
 * Mirrors the same prompts and logic that the UI buttons use:
 *   - "Criterios de Aceptación"  -> /app/pms/maintenance-plans/suggest-acceptance-criteria
 *   - "LOTO"                     -> /app/pms/maintenance-plans/suggest-loto
 *   - "Nivel de Riesgo"          -> /app/pms/maintenance-plans/suggest-risk
 *
 * Run from apps/api so dependencies resolve:
 *   cd /app/apps/api
 *   DATABASE_URL=...  ANTHROPIC_API_KEY=...  node scripts/bulk-fill-mercurio-ai.js
 *
 * Idempotent: only fills fields that are NULL. Skips plans that already have content.
 *
 * Concurrency: CONCURRENCY plans in parallel (default 3). Each plan triggers up to
 * 3 sequential Claude calls (criteria -> loto -> risk). Failed calls log and skip
 * that field; the script continues with the next plan.
 */
"use strict";

const { Pool } = require("pg");
const Anthropic = require("@anthropic-ai/sdk").default;

const DATABASE_URL = process.env.DATABASE_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TENANT_SLUG = process.env.TENANT_SLUG || "mercurio";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "3", 10);
const DRY_RUN = process.env.DRY_RUN === "true";
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;

if (!DATABASE_URL)      { console.error("Missing DATABASE_URL");      process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }

const MODEL = "claude-haiku-4-5-20251001";

const PROMPT_ACCEPTANCE = `Sos experto en mantenimiento de máquinas navales. Generá el siguiente contenido para esta tarea:

1. Criterios de aceptación verificables, específicos y técnicos (cuándo el trabajo está correctamente completado, con rangos y tolerancias aplicables).

2. Una sección con las herramientas, equipos de medición e instrumentos requeridos.

Usá exactamente este formato (sin introducción ni explicación adicional):
[criterios de aceptación]

HERRAMIENTAS E INSTRUMENTOS NECESARIOS:
[lista de herramientas e instrumentos]`;

const PROMPT_LOTO = `Sos experto en mantenimiento de máquinas navales. Definí los procedimientos LOTO (Lockout/Tagout) específicos para esta tarea: qué energías deben bloquearse, en qué orden, y qué verificaciones de seguridad se requieren antes de iniciar y al finalizar el trabajo. No incluyas listado de EPP ni equipos de protección personal.

Responde ÚNICAMENTE con el procedimiento LOTO, en texto plano, sin introducción ni explicación adicional.`;

const PROMPT_RISK = `Sos experto en HSE / Job Safety Analysis (JSA) para mantenimiento de máquinas navales.

CONTEXTO IMPORTANTE — qué te están pidiendo:
Este análisis evalúa el riesgo PARA EL OPERARIO al EJECUTAR la tarea. Es decir: la pregunta es "¿qué peligros corre quien hace el trabajo MIENTRAS lo hace?".

NO confundir con RCM (otra herramienta del sistema). RCM pregunta lo opuesto: "¿qué pasa si la tarea NO se hace?". RCM mira la consecuencia de la falla en el equipo. Vos NO tenés que pensar en eso.

Vos pensás en: espacio confinado, energías peligrosas, hot work, caídas, atrapamiento, exposición química, ruido, atmósferas explosivas, partes móviles, cargas suspendidas, presión residual, temperatura, electricidad. Cosas que pueden lastimar AL TRIPULANTE durante la ejecución.

Niveles de riesgo (operacional):
- LOW: tarea rutinaria sin energías peligrosas, espacio normal, EPP básico.
- MEDIUM: requiere LOTO simple, EPP específico, una persona alcanza.
- HIGH: requiere permisos especiales (espacio confinado, hot work), standby, atmósfera medida.
- CRITICAL: combina varios riesgos altos o trabajo en altura/sobre el agua/buceo.

Respondé ÚNICAMENTE con este formato exacto (sin JSON, sin markdown, sin introducción):

NIVEL: LOW|MEDIUM|HIGH|CRITICAL

[peligros identificados durante la ejecución, consecuencias para el operario y medidas de control]

EQUIPOS DE PPE:
- [equipo de protección 1]
- [equipo de protección 2]`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: DATABASE_URL });
const claude = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

function buildContext(assetLabel, taskDesc, extras = {}) {
  const lines = [
    `Activo: ${(assetLabel || "").trim() || "equipo desconocido"}`,
    `Tarea: ${(taskDesc || "").trim() || "tarea no especificada"}`,
  ];
  for (const [k, v] of Object.entries(extras)) {
    if (v && String(v).trim()) lines.push(`${k}: ${String(v).trim()}`);
  }
  return lines.join("\n");
}

async function callClaude(systemPrompt, userContent, maxTokens = 1024) {
  const r = await claude.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });
  return r.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();
}

async function suggestAcceptance(assetLabel, taskDesc) {
  return callClaude(PROMPT_ACCEPTANCE, buildContext(assetLabel, taskDesc));
}

async function suggestLoto(assetLabel, taskDesc, acceptanceCriteria) {
  return callClaude(PROMPT_LOTO, buildContext(assetLabel, taskDesc, {
    "Criterios de aceptación": acceptanceCriteria,
  }));
}

async function suggestRisk(assetLabel, taskDesc, acceptanceCriteria, loto) {
  const raw = await callClaude(PROMPT_RISK, buildContext(assetLabel, taskDesc, {
    "Criterios de aceptación": acceptanceCriteria,
    "LOTO": loto,
  }));
  const m = raw.match(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/im);
  if (!m) return { level: null, analysis: raw };
  const level = m[1].toUpperCase();
  const analysis = raw.replace(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)\s*/im, "").trim();
  return { level, analysis };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker pool
// ─────────────────────────────────────────────────────────────────────────────

async function processPlan(plan, stats) {
  const taskDesc = plan.description || plan.title;
  const assetLabel = plan.asset_name || plan.asset_id || null;

  let { acceptance_criteria: acceptance, loto, risk_level: riskLevel, risk_analysis_result: riskAnalysis } = plan;

  // 1) Acceptance criteria
  if (!acceptance) {
    try {
      acceptance = await suggestAcceptance(assetLabel, taskDesc);
      stats.acceptance++;
    } catch (e) {
      console.error(`  ✗ ${plan.task_code}: acceptance failed: ${e.message}`);
    }
  }

  // 2) LOTO (uses acceptance as context)
  if (!loto) {
    try {
      loto = await suggestLoto(assetLabel, taskDesc, acceptance);
      stats.loto++;
    } catch (e) {
      console.error(`  ✗ ${plan.task_code}: loto failed: ${e.message}`);
    }
  }

  // 3) Risk (uses both as context)
  if (!riskLevel) {
    try {
      const r = await suggestRisk(assetLabel, taskDesc, acceptance, loto);
      if (r.level) {
        riskLevel = r.level;
        riskAnalysis = r.analysis;
        stats.risk++;
      } else {
        console.error(`  ⚠ ${plan.task_code}: risk parse failed (no NIVEL line)`);
      }
    } catch (e) {
      console.error(`  ✗ ${plan.task_code}: risk failed: ${e.message}`);
    }
  }

  if (DRY_RUN) {
    console.log(`  ✓ ${plan.task_code} (DRY_RUN, no DB write)`);
    return;
  }

  // Persist whatever we got
  await pool.query(`
    UPDATE "MaintenancePlan"
       SET "acceptanceCriteria"  = COALESCE($1, "acceptanceCriteria"),
           "loto"                = COALESCE($2, "loto"),
           "riskLevel"           = COALESCE($3, "riskLevel"),
           "riskAnalysisResult"  = COALESCE($4, "riskAnalysisResult"),
           "updatedAt"           = NOW()
     WHERE id = $5
  `, [acceptance || null, loto || null, riskLevel || null, riskAnalysis || null, plan.id]);

  console.log(`  ✓ ${plan.task_code}`);
}

async function runPool(items, fn, concurrency) {
  let idx = 0;
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= items.length) return;
        try {
          await fn(items[myIdx], myIdx);
        } catch (e) {
          console.error(`  ✗ Worker ${i} error on item ${myIdx}: ${e.message}`);
        }
      }
    })());
  }
  await Promise.all(workers);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Tenant: ${TENANT_SLUG}, concurrency: ${CONCURRENCY}, DRY_RUN: ${DRY_RUN}`);

  // Resolve tenant
  const t = await pool.query(`SELECT id FROM "Tenant" WHERE slug=$1 LIMIT 1`, [TENANT_SLUG]);
  if (t.rows.length === 0) {
    console.error(`Tenant ${TENANT_SLUG} not found`);
    process.exit(1);
  }
  const tenantId = t.rows[0].id;

  // Find plans missing any of the 3 fields
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : "";
  const planQ = await pool.query(`
    SELECT mp.id, mp."taskCode" AS task_code, mp.title, mp.description,
           mp."acceptanceCriteria" AS acceptance_criteria,
           mp.loto,
           mp."riskLevel" AS risk_level,
           mp."riskAnalysisResult" AS risk_analysis_result,
           mp."assetId" AS asset_id,
           a.name AS asset_name
      FROM "MaintenancePlan" mp
      LEFT JOIN "Asset" a ON a.id = mp."assetId"
     WHERE mp."tenantId" = $1
       AND mp."deletedAt" IS NULL
       AND (mp."acceptanceCriteria" IS NULL OR mp.loto IS NULL OR mp."riskLevel" IS NULL)
     ORDER BY mp."vesselCode", mp."taskCode"
     ${limitClause}
  `, [tenantId]);

  const plans = planQ.rows;
  console.log(`Found ${plans.length} plans needing AI completion.`);
  if (plans.length === 0) { await pool.end(); return; }

  const stats = { acceptance: 0, loto: 0, risk: 0 };
  const t0 = Date.now();

  await runPool(plans, (plan) => processPlan(plan, stats), CONCURRENCY);

  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  console.log("");
  console.log(`════════════════════════════════════════════════════════════════════`);
  console.log(`✓ Done in ${dt}s.`);
  console.log(`  Acceptance criteria filled: ${stats.acceptance}`);
  console.log(`  LOTO filled:                ${stats.loto}`);
  console.log(`  Risk level filled:          ${stats.risk}`);
  console.log(`════════════════════════════════════════════════════════════════════`);

  await pool.end();
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
