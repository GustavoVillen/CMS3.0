/**
 * CopilotoPanel — persistent right-sidebar AI copilot.
 *
 * Architecture:
 *   - Rendered as <aside> inside the main flex layout (not floating/fixed).
 *   - Reads CopilotScreenContext emitted by active page/modal.
 *   - Computes offline suggestions (no API call) from context heuristics.
 *   - Quick actions pre-fill the chat input with module-aware expert prompts.
 *   - Sends screenContext to the backend so the AI has full record awareness.
 *   - Collapsed/expanded state persisted in localStorage.
 *
 * Rules (never negotiable):
 *   - AI suggests. System validates. User confirms.
 *   - Never submit forms, approve records, or close workflows autonomously.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  Send,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Zap,
  AlertTriangle,
  Info,
  BarChart2,
  CheckCheck,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Square,
  Paperclip,
  X,
  Maximize2,
  Minimize2,
  Sparkles,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Voice summary — strip markdown, keep first ~200 chars at word boundary
// ---------------------------------------------------------------------------

function buildVoiceSummary(text: string): string {
  const clean = text
    .replace(/\[CAMPOS\][\s\S]*?\[\/CAMPOS\]/g, "")
    .replace(/\[RECALCULAR\][\s\S]*?\[\/RECALCULAR\]/g, "")
    .replace(/\[ABRIR\][\s\S]*?\[\/ABRIR\]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)]\([^\)]+\)/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (clean.length <= 200) return clean;

  const cut = clean.slice(0, 200);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut) + "…";
}

/**
 * Texto para la lectura automática (voz prendida). A diferencia del resumen
 * del botón "Escuchar", no puede cortar al final: en el modo guiado lo que
 * importa es la PREGUNTA, que va última. Si el mensaje es largo se lee el
 * comienzo y la última oración (la pregunta).
 */
function buildVoiceText(text: string): string {
  const clean = buildVoiceSummaryClean(text);
  if (clean.length <= 450) return clean;
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1] ?? "";
  let head = "";
  for (const s of sentences.slice(0, -1)) {
    if ((head + " " + s).length > 300) break;
    head = head ? `${head} ${s}` : s;
  }
  return `${head || clean.slice(0, 300)} … ${last}`.slice(0, 480);
}

/** Mismo limpiado que el resumen, sin recortar. */
function buildVoiceSummaryClean(text: string): string {
  return text
    .replace(/\[CAMPOS\][\s\S]*?\[\/CAMPOS\]/g, "")
    .replace(/\[RECALCULAR\][\s\S]*?\[\/RECALCULAR\]/g, "")
    .replace(/\[ABRIR\][\s\S]*?\[\/ABRIR\]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)]\([^\)]+\)/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

const LS_VOICE_ON = "gpms_copilot_voice_on";

/**
 * Parte un texto en tramos para hablarlo: la primera oración sola (suena
 * enseguida) y después tramos de al menos ~80 caracteres (menos pedidos al
 * servidor, voz más continua).
 */
function splitSpeechChunks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?:])\s+/).map(s => s.trim()).filter(Boolean);
  if (sentences.length === 0) return [];
  const out: string[] = [sentences[0]!];
  let buf = "";
  for (const s of sentences.slice(1)) {
    buf = buf ? `${buf} ${s}` : s;
    if (buf.length >= 80) { out.push(buf); buf = ""; }
  }
  if (buf) out.push(buf);
  return out;
}

// ---------------------------------------------------------------------------
// speechSynthesis helpers
// ---------------------------------------------------------------------------

function getSpanishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  // La voz elegida para el copiloto es Elena (Argentina). El navegador Edge la
  // trae como voz propia ("Microsoft Elena Online"): si está, va primero, así el
  // respaldo suena igual que la voz del servidor.
  const elena = voices.find(v => /elena/i.test(v.name) && v.lang.startsWith("es"));
  if (elena) return elena;
  for (const lang of ["es-AR", "es-MX", "es-ES", "es"]) {
    const v = voices.find(v => v.lang === lang || v.lang.startsWith(lang));
    if (v) return v;
  }
  return null;
}
import { api, ApiError } from "../lib/api";
import { useCopilotScreenContext, notifyCopilotDataChanged, type CopilotScreenContext } from "../lib/copilot-context";
import { useAuth } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { useResizable } from "../lib/hooks";
import { useT, useWoTerms, type WoTerms } from "../lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuggestedAction {
  type: string;
  target: string;
  label?: string;
  patch?: Record<string, unknown>;
  vesselCode?: string;
  /** Estado UI local: idle | applying | applied | failed */
  state?: "idle" | "applying" | "applied" | "failed";
  errorMsg?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Acciones sugeridas por la IA al final de la respuesta. Renderizadas
   * como botones "Aplicar" debajo del bubble del mensaje. */
  actions?: SuggestedAction[];
  /** Ofrecimiento de asistencia de un formulario: muestra "No volver a ofrecer". */
  assistOffer?: boolean;
  /** Mensaje del sistema a la IA que no se muestra en el chat (p. ej. "pasó al paso siguiente"). */
  hidden?: boolean;
}

/**
 * Lo que el panel le manda a la IA, sin mostrarlo, cuando un paso de un flujo
 * guiado llevó a la pantalla siguiente: así pregunta lo del paso nuevo sin que
 * el usuario tenga que escribir "seguí".
 */
const NEXT_STEP_MESSAGE = "[SIGUIENTE PASO]";
/** Al abrir un flujo: el copiloto arranca a ayudar sin preguntar si hace falta (pedido de Gustavo). */
const AUTO_START_MESSAGE = "[AYUDAR]";
/** El usuario eligió algo a mano en la misma pantalla: la IA vuelve a mirarla y sigue desde ahí. */
const SCREEN_CHANGE_MESSAGE = "[CAMBIO EN PANTALLA]";

/** Preferencia por persona (y por navegador) de no recibir ofrecimientos de ayuda en los formularios. */
function assistOptOutKey(userId: string | undefined): string {
  return `gpms_copilot_assist_off:${userId ?? "anon"}`;
}

/** Respuesta de /app/copiloto/apply-action. */
interface ApplyActionResponse {
  ok: boolean;
  applied?: { type: string; target: string; entityId: string; entityCode?: string; vesselCode?: string };
}

/** Acciones que terminan con una OT nueva: son las que se abren en pantalla. */
const CREATES_WORK_ORDER = new Set(["create_work_order_from_plan", "create_work_order", "create_work_order_from_defect"]);

interface Suggestion {
  id: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  explanation: string;
}

type FileContent =
  | { type: "text";     text: string;   fileName: string }
  | { type: "image";    base64: string; mediaType: string; fileName: string }
  | { type: "document"; base64: string; fileName: string };

const ACCEPTED_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.csv,.txt";
const MAX_FILE_MB = 10;


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAPABILITIES = [
  { value: "knowledge_assistant",    label: "Asistente de conocimiento" },
  { value: "maintenance_insights",   label: "Insights de mantenimiento" },
  { value: "defect_assistant",       label: "Asistente de defectos" },
  { value: "deferral_analysis",      label: "Análisis de diferimientos" },
  { value: "daily_executive_summary", label: "Resumen ejecutivo diario" },
];

const LS_EXPANDED = "gpms_copilot_expanded";

// ---------------------------------------------------------------------------
// [CAMPOS] block helpers — structured field values emitted by the AI
// ---------------------------------------------------------------------------

/** Extract the JSON payload from a [CAMPOS]{...}[/CAMPOS] block, or null if absent/invalid. */
function extractCamposBlock(text: string): Record<string, string> | null {
  const match = text.match(/\[CAMPOS\]([\s\S]*?)\[\/CAMPOS\]/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch { /* invalid JSON */ }
  return null;
}

/**
 * Asistentes del formulario que la IA pide correr:
 * [RECALCULAR]["acceptanceCriteria","loto","risk"][/RECALCULAR].
 *
 * No los redacta el copiloto: dispara el MISMO generador que el rótulo con la
 * chispita del formulario, para que el texto salga igual venga de donde venga.
 */
function extractRecalcBlock(text: string): string[] | null {
  const match = text.match(/\[RECALCULAR\]([\s\S]*?)\[\/RECALCULAR\]/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      const names = parsed.filter((v): v is string => typeof v === "string");
      return names.length > 0 ? names : null;
    }
  } catch { /* invalid JSON */ }
  return null;
}

/**
 * Pantalla que la IA pide abrir: [ABRIR]/asset-hours[/ABRIR].
 *
 * Es sólo navegación — la misma que si el usuario tocara el ítem del menú — así
 * que no pide confirmación: abrir una pantalla no cambia ningún dato. Todo lo
 * que SÍ escribe sigue pasando por el botón "Aplicar" de las acciones.
 *
 * Se acepta únicamente una ruta interna (empieza con "/" y sin "//"): con esto
 * el modelo no puede mandar al usuario a un sitio de afuera.
 */
function extractOpenScreenBlock(text: string): string | null {
  const match = text.match(/\[ABRIR\]([\s\S]*?)\[\/ABRIR\]/);
  if (!match) return null;
  const path = match[1].trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

/**
 * Texto que se ve en el globo del chat: sin los bloques de máquina.
 * También corta un bloque a medio llegar (el chat streamea de a pedazos), para
 * que el usuario no vea el marcador crudo por un instante.
 */
function stripAiBlocks(text: string): string {
  return text
    .replace(/\[CAMPOS\][\s\S]*?\[\/CAMPOS\]/g, "")
    .replace(/\[RECALCULAR\][\s\S]*?\[\/RECALCULAR\]/g, "")
    .replace(/\[ABRIR\][\s\S]*?\[\/ABRIR\]/g, "")
    .replace(/\[(?:CAMPOS|RECALCULAR|ABRIR)\][\s\S]*$/, "")
    // Avisos internos del panel a la IA: si el modelo los repite, no se muestran.
    .replace(/\[(?:SIGUIENTE PASO|AYUDAR|CAMBIO EN PANTALLA)\]/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Module → capability auto-routing
// ---------------------------------------------------------------------------

function capabilityForModule(module: string | undefined): string {
  switch (module) {
    case "DEFECTS":       return "defect_assistant";
    case "DEFERRALS":     return "deferral_analysis";
    case "WORK_ORDERS":   return "maintenance_insights";
    default:              return "knowledge_assistant";
  }
}

// ---------------------------------------------------------------------------
// Offline suggestion engine — zero API calls, pure heuristics
// ---------------------------------------------------------------------------

function computeSuggestions(ctx: CopilotScreenContext, woTerms: WoTerms): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const fv = ctx.fieldValues ?? {};

  // ── Work Orders heuristics ──
  if (ctx.module === "WORK_ORDERS" && ctx.screen === "WO_EDIT") {
    if (!fv.title?.trim()) {
      suggestions.push({
        id: "wo-title",
        priority: "HIGH",
        title: `Falta título de la ${woTerms.abbr}`,
        explanation: `La ${woTerms.full.toLowerCase()} no tiene título descriptivo.`,
      });
    }
    const desc = fv.description?.trim() ?? "";
    if (desc.length > 0 && desc.length < 30) {
      suggestions.push({
        id: "wo-desc",
        priority: "MEDIUM",
        title: "Descripción muy genérica",
        explanation: "La descripción es demasiado corta para ejecución y trazabilidad.",
      });
    }
  }


  // ── CAPA heuristics ──
  if (ctx.module === "CAPA") {
    if (!fv.correctiveAction?.trim()) {
      suggestions.push({
        id: "capa-action",
        priority: "HIGH",
        title: "Falta acción correctiva",
        explanation: "La CAPA requiere al menos una acción correctiva documentada.",
      });
    }
  }

  // ── Deferrals heuristics ──
  if (ctx.module === "DEFERRALS") {
    const deferStatus = ctx.workflowStage ?? "";
    if (!fv.justification?.trim()) {
      suggestions.push({
        id: "def-just",
        priority: "HIGH",
        title: "Falta justificación",
        explanation: "El diferimiento debe incluir una justificación técnica documentada.",
      });
    }
    if (!fv.compensatoryMeasures?.trim()) {
      suggestions.push({
        id: "def-comp",
        priority: ["APPROVED", "ACTIVE"].includes(deferStatus) ? "HIGH" : "MEDIUM",
        title: "Faltan medidas compensatorias",
        explanation: "Documenta las medidas implementadas para gestionar el riesgo mientras se resuelve la condición aplazada.",
      });
    }
    if (!fv.targetDate?.trim()) {
      suggestions.push({
        id: "def-date",
        priority: "MEDIUM",
        title: "Falta fecha objetivo",
        explanation: "Define cuándo se espera resolver la condición aplazada para dar trazabilidad al diferimiento.",
      });
    }
  }

  return suggestions.slice(0, 4); // max 4 simultaneous suggestions
}

// ---------------------------------------------------------------------------
// Pending items prompt — single action that covers all missing fields
// ---------------------------------------------------------------------------

function buildPendingItemsPrompt(ctx: CopilotScreenContext, suggestions: Suggestion[], woTerms: WoTerms): string {
  const fv     = ctx.fieldValues ?? {};
  const code   = ctx.entityCode  ? ` ${ctx.entityCode}`        : "";
  const vessel = ctx.vesselCode  ? ` (Vessel: ${ctx.vesselCode})` : "";

  const pendingList = suggestions
    .map(s => `• ${s.title}: ${s.explanation}`)
    .join("\n");

  const filledList = Object.entries(fv)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `• ${k}: "${v}"`)
    .join("\n");

  if (ctx.module === "WORK_ORDERS") {
    return (
      `Estoy completando la ${woTerms.full}${code}${vessel}.` +
      (filledList ? `\n\nEstado actual:\n${filledList}` : "") +
      `\n\nÍtems a mejorar:\n${pendingList}` +
      `\n\nAyúdame a completar y mejorar esta ${woTerms.full.toLowerCase()}.`
    );
  }

  if (ctx.module === "DEFERRALS") {
    const statusLine = ctx.workflowStage ? ` | Estado: ${ctx.workflowStage}` : "";
    return (
      `Estoy documentando el diferimiento${code}${vessel}${statusLine}.` +
      (filledList ? `\n\nYa tengo:\n${filledList}` : "") +
      `\n\nÍtems pendientes:\n${pendingList}` +
      `\n\nAyúdame a completarlos correctamente siguiendo buenas prácticas de gestión de riesgos navales.`
    );
  }

  if (ctx.module === "CAPA") {
    return (
      `Estoy completando la CAPA${code}${vessel}.` +
      (filledList ? `\n\nYa tengo:\n${filledList}` : "") +
      `\n\nÍtems pendientes:\n${pendingList}` +
      `\n\nAyúdame a completarlos con criterio técnico.`
    );
  }

  if (ctx.module === "DEFECTS") {
    return (
      `Estoy documentando el defecto${code}${vessel}.` +
      (filledList ? `\n\nYa tengo:\n${filledList}` : "") +
      `\n\nÍtems pendientes:\n${pendingList}` +
      `\n\nAyúdame a completar las acciones requeridas con criterio técnico.`
    );
  }

  // Generic fallback
  return (
    `Tengo ítems pendientes en ${ctx.module}${code}${vessel}:\n${pendingList}` +
    `\n\nAyúdame a completarlos.`
  );
}

// ---------------------------------------------------------------------------
// Deferral analysis prompt
// ---------------------------------------------------------------------------

function buildDeferralAnalysisPrompt(ctx: CopilotScreenContext): string {
  const fv     = ctx.fieldValues ?? {};
  const code   = ctx.entityCode  ? ` ${ctx.entityCode}`           : "";
  const vessel = ctx.vesselCode  ? ` (Vessel: ${ctx.vesselCode})` : "";
  const status = ctx.workflowStage ?? "desconocido";

  const details = [
    fv.sourceType            && `Origen: ${fv.sourceType}`,
    `Estado: ${status}`,
    fv.targetDate?.trim()    && `Fecha objetivo: ${fv.targetDate}`,
    fv.justification?.trim() && `Justificación: "${fv.justification}"`,
    fv.compensatoryMeasures?.trim() && `Medidas compensatorias: "${fv.compensatoryMeasures}"`,
  ].filter(Boolean).join("\n");

  return (
    `Analiza el diferimiento${code}${vessel}.\n\n` +
    (details ? `Datos actuales:\n${details}\n\n` : "") +
    `Por favor:\n` +
    `1. Evalúa si la justificación es técnicamente sólida\n` +
    `2. Revisa si las medidas compensatorias son adecuadas para el riesgo\n` +
    `3. Identifica riesgos o deficiencias en la documentación\n` +
    `4. Sugiere mejoras concretas para fortalecer el expediente`
  );
}

// ---------------------------------------------------------------------------
// Print / PDF helpers
// ---------------------------------------------------------------------------

function isPrintRequest(text: string): boolean {
  return /pdf|imprimir|imprim[ií]|print|genera(me)?\s+(un\s+|el\s+|este\s+)?(pdf|reporte|informe)/i.test(text);
}

function inlineFormat(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inTable = false;
  let inList  = false;
  let tableFirst = true;

  const closeList  = () => { if (inList)  { out.push("</ul>");   inList  = false; } };
  const closeTable = () => { if (inTable) { out.push("</table>"); inTable = false; } };

  for (const line of lines) {
    // Table
    if (line.trim().startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) continue;
      if (!inTable) { closeList(); out.push("<table>"); inTable = true; tableFirst = true; }
      const tag = tableFirst ? "th" : "td";
      out.push(`<tr>${cells.map(c => `<${tag}>${inlineFormat(c)}</${tag}>`).join("")}</tr>`);
      tableFirst = false;
      continue;
    }
    closeTable();

    // List item
    if (/^[-*•] /.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineFormat(line.replace(/^[-*•] /, ""))}</li>`);
      continue;
    }
    closeList();

    // Headings
    if (line.startsWith("### ")) { out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("## "))  { out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("# "))   { out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }

    // HR
    if (/^---+$/.test(line.trim())) { out.push("<hr>"); continue; }

    // Blank line
    if (!line.trim()) { out.push("<p></p>"); continue; }

    out.push(`<p>${inlineFormat(line)}</p>`);
  }
  closeList();
  closeTable();
  return out.join("\n");
}

function printReport(content: string) {
  const win = window.open("", "_blank", "width=920,height=720");
  if (!win) { alert("Permitir ventanas emergentes para imprimir."); return; }
  const html = markdownToHtml(content);
  const ts = new Date().toLocaleString("es-AR");
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Reporte CMS3.0</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:36px;color:#111;line-height:1.6}
  .hdr{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;padding-bottom:10px;border-bottom:3px solid #1d4ed8}
  .hdr-brand{font-size:15px;font-weight:700;color:#1d4ed8}
  .hdr-ts{font-size:9px;color:#6b7280}
  h1{font-size:20px;color:#111;border-bottom:2px solid #1d4ed8;padding-bottom:6px}
  h2{font-size:15px;color:#1d4ed8;margin-top:18px}
  h3{font-size:13px;color:#1e40af}
  table{border-collapse:collapse;width:100%;margin:8px 0;font-size:11px}
  th{background:#1d4ed8;color:#fff;padding:5px 8px;text-align:left}
  td{border:1px solid #d1d5db;padding:4px 8px}
  tr:nth-child(even) td{background:#f9fafb}
  ul{margin:4px 0 8px 20px}li{margin:1px 0}
  code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:11px}
  hr{border:none;border-top:1px solid #e5e7eb;margin:14px 0}
  strong{font-weight:700}
  p{margin:3px 0}
  @media print{body{margin:20px}.no-print{display:none}}
</style></head><body>
<div class="hdr"><span class="hdr-brand">CMS3.0 — Copiloto IA</span><span class="hdr-ts">Generado: ${ts}</span></div>
${html}
<script>window.onload=function(){window.print();}</script>
</body></html>`);
  win.document.close();
}

// ---------------------------------------------------------------------------
// Markdown renderer (preserve from original)
// ---------------------------------------------------------------------------

// ── Códigos de registro citados por el copiloto ──────────────────────────────
//
// El copiloto nombra registros por su código ("las muestras FA-M01-0037,
// FA-M01-0030…"). Antes eran texto muerto: había que copiarlos e ir a buscarlos
// a mano. Ahora se detectan y se vuelven clickeables.
//
// El prefijo identifica el módulo. Sólo se listan los que tienen destino REAL:
// un código que no sabemos abrir se deja como texto, que es mejor que un link
// que no lleva a ningún lado.
//
// OT/DEF/APL/NM/CAPA se abren por código (ruta /modulo/:code). Muestreos y
// Solicitudes de Servicio no tienen ruta por código, así que se pasa ?code= y
// la pantalla lo resuelve contra su lista.
const CODE_ROUTES: Array<{ prefix: string; path: (code: string) => string }> = [
  { prefix: "OT-",   path: c => `/work-orders/${encodeURIComponent(c)}` },
  { prefix: "DEF-",  path: c => `/defects/${encodeURIComponent(c)}` },
  { prefix: "APL-",  path: c => `/deferrals/${encodeURIComponent(c)}` },
  { prefix: "NM-",   path: c => `/near-miss/${encodeURIComponent(c)}` },
  { prefix: "CAPA-", path: c => `/capa/${encodeURIComponent(c)}` },
  { prefix: "FA-",   path: c => `/fluid-analyses?code=${encodeURIComponent(c)}` },
  { prefix: "SS-",   path: c => `/service-requests?code=${encodeURIComponent(c)}` },
];

/**
 * Captura los códigos, con o sin backticks alrededor (el copiloto suele
 * escribirlos como `FA-M01-0037`). Los backticks quedan fuera del texto que se
 * muestra: antes se veían literales porque el renderer no interpreta código
 * inline.
 */
const CODE_REGEX = /`?\b((?:OT|DEF|APL|NM|CAPA|FA|SS)-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b`?/g;

function routeForCode(code: string): string | null {
  const upper = code.toUpperCase();
  const hit = CODE_ROUTES.find(r => upper.startsWith(r.prefix));
  return hit ? hit.path(upper) : null;
}

/** Trocea un texto plano en nodos, volviendo botón cada código reconocido. */
const renderRecordCodes = (
  text: string,
  keyPrefix: string,
  onInternalLinkClick: (path: string) => void,
): React.ReactNode => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  for (const match of text.matchAll(CODE_REGEX)) {
    const code = match[1]!;
    const path = routeForCode(code);
    if (!path) continue;
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
    nodes.push(
      <button
        key={`${keyPrefix}-c-${i}`}
        type="button"
        onClick={() => onInternalLinkClick(path)}
        className="font-mono text-accent hover:underline"
        title="Abrir este registro"
      >
        {code}
      </button>,
    );
    lastIndex = start + match[0].length;
    i += 1;
  }
  if (nodes.length === 0) return text;
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

// `onCode` es opcional para no romper llamadas viejas: sin él, los códigos
// quedan como texto (el comportamiento anterior).
const renderBoldMarkdown = (
  content: string,
  keyPrefix: string,
  onCode?: (path: string) => void,
): React.ReactNode => {
  const codes = (text: string, k: string) =>
    onCode ? renderRecordCodes(text, k, onCode) : text;

  const tokens: React.ReactNode[] = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of content.matchAll(boldRegex)) {
    const start = match.index ?? 0;
    if (start > lastIndex) tokens.push(codes(content.slice(lastIndex, start), `${keyPrefix}-t${matchIndex}`));
    tokens.push(<strong key={`${keyPrefix}-b-${matchIndex}`}>{codes(match[1]!, `${keyPrefix}-bc${matchIndex}`)}</strong>);
    lastIndex = start + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < content.length) tokens.push(codes(content.slice(lastIndex), `${keyPrefix}-tail`));
  return tokens.length > 0 ? tokens : codes(content, `${keyPrefix}-only`);
};

const renderMarkdownLite = (
  content: string,
  keyPrefix: string,
  onInternalLinkClick: (path: string) => void,
): React.ReactNode => {
  const nodes: React.ReactNode[] = [];
  const linkRegex = /\[([^\]]+)]\((\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let linkIndex = 0;

  for (const match of content.matchAll(linkRegex)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(renderBoldMarkdown(content.slice(lastIndex, start), `${keyPrefix}-t-${linkIndex}`, onInternalLinkClick));
    }
    nodes.push(
      <button
        key={`${keyPrefix}-l-${linkIndex}`}
        type="button"
        onClick={() => onInternalLinkClick(match[2]!)}
        className="underline underline-offset-2 text-accent hover:text-fg transition-colors"
      >
        {renderBoldMarkdown(match[1]!, `${keyPrefix}-ll-${linkIndex}`)}
      </button>,
    );
    lastIndex = start + match[0].length;
    linkIndex += 1;
  }

  if (lastIndex < content.length) {
    nodes.push(renderBoldMarkdown(content.slice(lastIndex), `${keyPrefix}-tail`, onInternalLinkClick));
  }
  return nodes.length > 0 ? nodes : renderBoldMarkdown(content, `${keyPrefix}-plain`, onInternalLinkClick);
};

// ---------------------------------------------------------------------------
// Suggestion card
// ---------------------------------------------------------------------------

function SuggestionCard({ s }: { s: Suggestion }) {
  const isHigh = s.priority === "HIGH";
  const isMed  = s.priority === "MEDIUM";
  return (
    <div className={`px-2.5 py-2 rounded-lg border text-[10px] leading-relaxed ${
      isHigh ? "bg-danger/10 border-danger/25" :
      isMed  ? "bg-warning/10 border-warning/25" :
               "bg-fg/5 border-border"
    }`}>
      <p className={`font-bold flex items-center gap-1 ${
        isHigh ? "text-danger" : isMed ? "text-warning" : "text-text-industrial/60"
      }`}>
        {(isHigh || isMed) ? <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> : <Info className="w-2.5 h-2.5 shrink-0" />}
        {s.title}
      </p>
      <p className="text-text-industrial/40 mt-0.5">{s.explanation}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CopilotoPanel: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const woTerms = useWoTerms();
  const {
    screenContext, requestMessage, setRequestMessage,
    hasApplyFieldsCallback, applyFields,
    formActionNames, runFormActions,
    offer, clearCopilotOffer,
  } = useCopilotScreenContext();
  const t = useT();
  // Buque seleccionado en el header — el copiloto lo usa como contexto de trabajo
  // por defecto para no preguntar "¿de qué buque?" cuando ya hay uno elegido.
  const { selectedVessel } = useVesselContext();

  // Resizable width (only applies when expanded)
  const { width: panelWidth, startResize } = useResizable("gpms_copilot_width", 320, 240, 520);

  // Panel state
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_EXPANDED) !== "false"; } catch { return true; }
  });
  const [fullscreen, setFullscreen] = useState(false);

  // Chat state
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState("");
  const [capability, setCapability] = useState("knowledge_assistant");
  const [streaming, setStreaming] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  // Pending field values proposed by the AI — shown as "Aplicar campos" button
  const [pendingFields, setPendingFields] = useState<Record<string, string> | null>(null);
  /**
   * Modo "completémoslo juntos": la RUTA que el copiloto abrió en la pantalla
   * central. Mientras el usuario siga ahí, los campos que propone la IA entran
   * solos al formulario en vez de esperar el botón "Aplicar" — ya dijo que sí,
   * no tiene sentido pedirle un click más por cada respuesta. Igual no se
   * guarda nada: los revisa en pantalla y guarda él.
   *
   * Se guarda la ruta y no el código del registro porque esto vale para
   * CUALQUIER pantalla que el copiloto abra (una OT, una SS, la planilla de
   * horas), no sólo para las que tienen un código.
   */
  const [guidedPath, setGuidedPath] = useState<string | null>(null);
  const [recalcRunning, setRecalcRunning] = useState(false);
  /** Aviso momentáneo de "ya lo cargué en el formulario" (modo guiado). */
  const [fieldsLoadedFlash, setFieldsLoadedFlash] = useState(false);
  /**
   * Sólo mientras el usuario siga parado en la pantalla que abrió el copiloto.
   * Si se va a otro lado —o cierra la ventana del registro, que devuelve la URL
   * al listado— el modo guiado se apaga solo y vuelve el botón "Aplicar".
   */
  const guidedActive = !!guidedPath && location.pathname.startsWith(guidedPath);

  // ── Asistente de formularios (useCopilotAssist) ──
  const { user } = useAuth();
  const [assistOptOut, setAssistOptOut] = useState(false);
  useEffect(() => {
    try { setAssistOptOut(localStorage.getItem(assistOptOutKey(user?.id)) === "1"); } catch { setAssistOptOut(false); }
  }, [user?.id]);
  /**
   * Flujos a los que el copiloto ya les ofreció ayuda. Mientras el usuario esté
   * en un paso de uno de ellos, los campos que propone la IA entran solos al
   * formulario, igual que cuando el copiloto abrió la pantalla: el usuario ya
   * está conversando para completarlo, no tiene sentido un clic más por dato.
   */
  const [offeredFlows, setOfferedFlows] = useState<Set<string>>(() => new Set());
  /** Paso de elección recién cargado por la IA, esperando que aparezca la pantalla siguiente. */
  const pendingStepRef = useRef<{ flow: string; screen: string; at: number } | null>(null);
  /** Respuesta que se está recibiendo: se corta si el usuario elige algo en la pantalla. */
  const readerRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  const interruptedRef = useRef(false);
  /** Cuándo cargó algo el copiloto: lo que cambie en pantalla justo después no lo hizo el usuario. */
  const lastApplyAtRef = useRef(0);
  /** Aviso a la IA pendiente de mandar apenas termine lo que está en curso. */
  const pendingSystemMsgRef = useRef<{ flow: string; text: string } | null>(null);
  const streamingRef = useRef(false);
  streamingRef.current = streaming;
  const [systemMsgTick, setSystemMsgTick] = useState(0);
  const assistFlow = screenContext?.assist?.flow ?? null;
  const guidedNow = guidedActive || (!!assistFlow && offeredFlows.has(assistFlow));

  // File attachment state
  const [pendingFile, setPendingFile]   = useState<FileContent | null>(null);
  const [uploading, setUploading]       = useState(false);
  const fileInputRef                    = useRef<HTMLInputElement>(null);

  // Voice input state
  const [listening, setListening]   = useState(false);
  const recognitionRef              = useRef<SpeechRecognition | null>(null);

  // speechSynthesis / TTS state
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  // Persist expanded state
  useEffect(() => {
    try { localStorage.setItem(LS_EXPANDED, String(expanded)); } catch { /* noop */ }
  }, [expanded]);

  // Al terminar un mensaje (streaming true -> false) avisamos para que el badge
  // de "IA del mes" del Sidebar refresque el % consumido.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) window.dispatchEvent(new Event("ai-usage:changed"));
    prevStreamingRef.current = streaming;
  }, [streaming]);

  // Auto-select capability when module changes
  useEffect(() => {
    if (screenContext?.module) {
      setCapability(capabilityForModule(screenContext.module));
    }
  }, [screenContext?.module]);

  // Auto-scroll on new messages — scroll only within the panel, not the document
  useEffect(() => {
    const container = messagesEndRef.current?.parentElement;
    if (container) {
      container.scroll({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [messages, streaming]);

  // Focus input when expanding
  useEffect(() => {
    if (expanded) setTimeout(() => inputRef.current?.focus(), 100);
  }, [expanded]);

  // Derived
  const suggestions    = useMemo(() => screenContext ? computeSuggestions(screenContext, woTerms) : [], [screenContext, woTerms]);
  const hasSuggestions = suggestions.length > 0;

  // ---------------------------------------------------------------------------
  // File attachment — upload to backend, store parsed content in state
  // ---------------------------------------------------------------------------

  const uploadFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`El archivo supera el límite de ${MAX_FILE_MB} MB.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
      };
      const token = localStorage.getItem("gpms_token");
      const slug  = localStorage.getItem("gpms_tenant_slug");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (slug)  headers["X-Tenant-Slug"] = slug;

      const res = await fetch("/app/copiloto/parse-file", {
        method: "POST", headers, body: file,
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const content = await res.json() as FileContent;
      setPendingFile(content);
    } catch (e: unknown) {
      setError(`No se pudo procesar el archivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Voice input (Web Speech API — free, no backend)
  // ---------------------------------------------------------------------------

  const startVoiceInput = useCallback(() => {
    const SR = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

    if (!SR) { alert("Tu navegador no soporta reconocimiento de voz."); return; }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SR();
    recognition.lang = "es-AR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart  = () => setListening(true);
    recognition.onend    = () => setListening(false);
    recognition.onerror  = () => setListening(false);
    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript) setInput(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }, [listening]);

  // ---------------------------------------------------------------------------
  // TTS playback — Web Speech API (speechSynthesis), free, no backend
  // ---------------------------------------------------------------------------

  // ── Cola de voz ─────────────────────────────────────────────────────────────
  // Se habla por tramos (oraciones), en orden, y cada tramo se pide al servidor
  // apenas se conoce: mientras suena el primero ya se está generando el
  // siguiente. Antes se esperaba la respuesta ENTERA y después toda la voz de
  // una: varios segundos de silencio. `speechGenRef` invalida lo encolado
  // cuando se corta (el usuario escribe, elige en pantalla o apaga la voz).
  const speechGenRef = useRef(0);
  const speechChainRef = useRef<Promise<void>>(Promise.resolve());
  const speechPendingRef = useRef(0);

  const stopSpeaking = useCallback(() => {
    speechGenRef.current += 1;
    speechChainRef.current = Promise.resolve();
    speechPendingRef.current = 0;
    window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src.startsWith("blob:")) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeakingIdx(null);
  }, []);

  /** Voz del navegador (respaldo si el servidor no puede sintetizar). Resuelve al terminar. */
  const speakWithBrowser = useCallback((text: string) => new Promise<void>(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getSpanishVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "es-AR";
    utterance.rate = 1.05;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        const v = getSpanishVoice();
        if (v) { utterance.voice = v; utterance.lang = v.lang; }
        window.speechSynthesis.speak(utterance);
      }, { once: true });
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }), []);

  /** Pide el audio de un tramo al servidor (Azure / Edge, voz Elena). null = usar la voz del navegador. */
  const fetchSpeechUrl = useCallback(async (text: string): Promise<string | null> => {
    try {
      const { audioBase64, mime } = await api.post<{ audioBase64: string; mime: string }>("/app/copiloto/tts", { text });
      // CSP permite media-src blob: (no data:), así que usamos un Blob URL.
      const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
      return null;
    }
  }, []);

  /** Encola un tramo: se pide ya y suena cuando termine el anterior. */
  const enqueueSpeech = useCallback((text: string, msgIdx: number) => {
    const clean = text.trim();
    if (!clean) return;
    const gen = speechGenRef.current;
    const urlPromise = fetchSpeechUrl(clean);
    speechPendingRef.current += 1;
    speechChainRef.current = speechChainRef.current.then(async () => {
      if (gen !== speechGenRef.current) { const u = await urlPromise; if (u) URL.revokeObjectURL(u); return; }
      setSpeakingIdx(msgIdx);
      const url = await urlPromise;
      if (gen !== speechGenRef.current) { if (url) URL.revokeObjectURL(url); return; }
      if (!url) { await speakWithBrowser(clean); return; }
      await new Promise<void>(resolve => {
        const audio = new Audio(url);
        audioRef.current = audio;
        const done = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; resolve(); };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      });
    }).finally(() => {
      if (gen !== speechGenRef.current) return;
      speechPendingRef.current = Math.max(0, speechPendingRef.current - 1);
      if (speechPendingRef.current === 0) setSpeakingIdx(null);
    });
  }, [fetchSpeechUrl, speakWithBrowser]);

  /** Lee un texto ya completo, en tramos (así el primero suena rápido). */
  const speakText = useCallback((msgIdx: number, text: string) => {
    for (const chunk of splitSpeechChunks(text)) enqueueSpeech(chunk, msgIdx);
  }, [enqueueSpeech]);

  const speakMessage = useCallback((msgIdx: number, content: string, opts?: { full?: boolean }) => {
    if (speakingIdx === msgIdx) { stopSpeaking(); return; }
    stopSpeaking();
    // Lectura automática: el mensaje entero (con su pregunta final). Botón "Escuchar": el resumen.
    const text = opts?.full ? buildVoiceText(content) : buildVoiceSummary(content);
    if (text) speakText(msgIdx, text);
  }, [speakingIdx, stopSpeaking, speakText]);

  /**
   * Voz mientras la respuesta todavía se está escribiendo: cada vez que llega
   * texto, se habla lo que ya forma oraciones completas. `final` = cerró el
   * stream, se habla el resto. Pasados ~700 caracteres se deja de leer el
   * medio, pero la última oración (la pregunta) se lee igual.
   */
  const streamSpeechRef = useRef<{ idx: number; consumed: number; chars: number; chunks: number } | null>(null);
  const feedStreamSpeech = useCallback((display: string, final: boolean) => {
    const st = streamSpeechRef.current;
    if (!st) return;
    if (display.length < st.consumed) st.consumed = display.length;
    const pending = display.slice(st.consumed);
    let cut = -1;
    if (final) cut = pending.length;
    else {
      const re = /[.!?:](?=\s)|\n/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(pending))) cut = m.index + m[0].length;
    }
    if (cut <= 0) return;
    const piece = pending.slice(0, cut);
    const text = buildVoiceSummaryClean(piece);
    // Después del primer tramo conviene juntar un poco: menos pedidos, voz más pareja.
    if (!final && st.chunks > 0 && text.length < 60) return;
    st.consumed += cut;
    if (!text) return;
    if (st.chars < 700) {
      enqueueSpeech(text, st.idx);
      st.chars += text.length;
      st.chunks += 1;
    } else if (final) {
      const last = text.split(/(?<=[.!?])\s+/).pop() ?? "";
      if (last) enqueueSpeech(last, st.idx);
    }
  }, [enqueueSpeech]);

  // ── Voz prendida: el copiloto lee en voz alta cada respuesta y cada
  // ofrecimiento apenas termina de escribirlos. Se prende/apaga desde el
  // encabezado y queda recordado en el navegador.
  // Arranca en silencio: la voz se prende a mano desde el parlante del
  // encabezado y queda recordada en ese navegador.
  const [voiceOn, setVoiceOn] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_VOICE_ON) === "true"; } catch { return false; }
  });
  const toggleVoice = () => {
    setVoiceOn(prev => {
      const next = !prev;
      try { localStorage.setItem(LS_VOICE_ON, String(next)); } catch { /* noop */ }
      if (!next) stopSpeaking();
      return next;
    });
  };
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  // Mensajes que NO vienen por stream (ofrecimientos, confirmaciones del
  // sistema): se leen apenas aparecen. Los que vienen por stream ya se van
  // leyendo mientras se escriben (feedStreamSpeech) y quedan marcados acá.
  const lastSpokenRef = useRef(-1);
  useEffect(() => {
    if (!voiceOn || streaming) return;
    const idx = messages.length - 1;
    const last = messages[idx];
    if (!last || idx <= lastSpokenRef.current) return;
    if (last.role !== "assistant" || last.hidden || !last.content.trim()) return;
    lastSpokenRef.current = idx;
    speakMessage(idx, last.content, { full: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming, voiceOn]);

  // ---------------------------------------------------------------------------
  // Message sending
  // ---------------------------------------------------------------------------

  const buildApiMessages = useCallback((msgs: ChatMessage[]): ChatMessage[] => {
    if (!screenContext || msgs.length === 0) return msgs;

    const { entityCode, module: mod, vesselCode: vc, workflowStage: stage } = screenContext;
    const refParts = [
      entityCode             && `${entityCode}`,
      mod                    && `${mod.replace("_", " ")}`,
      vc                     && `vessel ${vc}`,
      stage                  && `estado ${stage}`,
    ].filter(Boolean);

    if (refParts.length === 0) return msgs;

    return msgs.map((m, i) =>
      i === msgs.length - 1 && m.role === "user"
        ? { ...m, content: `[Contexto activo: ${refParts.join(" · ")}]\n${m.content}` }
        : m,
    );
  }, [screenContext]);

  const sendMessage = useCallback(async (overrideText?: string, opts?: { hidden?: boolean }) => {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if (!text || streaming) return;

    if (overrideText === undefined) setInput("");
    setError(null);
    // El usuario ya contestó: se corta la lectura de la pregunta anterior.
    if (!opts?.hidden) stopSpeaking();

    // ── Print / PDF shortcut ──
    if (isPrintRequest(text)) {
      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && m.content.trim());
      const reply: ChatMessage = {
        role: "assistant",
        content: lastAssistant
          ? "Abriendo ventana de impresión con el último reporte generado."
          : "No hay ningún reporte generado aún. Pedime un reporte primero y luego solicitá la impresión.",
      };
      setMessages(prev => [...prev, { role: "user", content: text }, reply]);
      if (lastAssistant) printReport(lastAssistant.content);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text, hidden: opts?.hidden };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setStreaming(true);
    // La primera respuesta de una asistencia arrancada sola lleva el "Dejar de ayudar automáticamente".
    setMessages(prev => [...prev, { role: "assistant", content: "", assistOffer: text === AUTO_START_MESSAGE }]);
    interruptedRef.current = false;
    // Voz: esta respuesta se va leyendo mientras llega.
    const assistantIdx = nextMessages.length;
    if (voiceOnRef.current) {
      streamSpeechRef.current = { idx: assistantIdx, consumed: 0, chars: 0, chunks: 0 };
      lastSpokenRef.current = assistantIdx;
    } else {
      streamSpeechRef.current = null;
    }

    try {
      const fileSnapshot = pendingFile;
      if (pendingFile) setPendingFile(null);

      const reader = await api.stream("/app/copiloto/chat", {
        capability,
        locale: navigator.language?.split("-")[0] ?? "es",
        messages: buildApiMessages(nextMessages),
        screenContext: screenContext ?? undefined,
        fileAttachment: fileSnapshot ?? undefined,
        // Buque activo del header — contexto de trabajo por defecto del copiloto.
        vesselCode: selectedVessel?.code ?? undefined,
        vesselName: selectedVessel?.name ?? undefined,
      });
      readerRef.current = reader;

      let assistantContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of value.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as {
              text?: string;
              error?: string;
              actions?: SuggestedAction[];
              stripText?: string;
            };
            if (parsed.error) { setError(parsed.error); break; }
            if (parsed.text) {
              assistantContent += parsed.text;
              // Extract [CAMPOS] block if present (may arrive mid-stream)
              // En modo guiado no se ofrece el botón: los campos entran solos
              // al cerrar el stream (ver más abajo), sin que parpadee el botón.
              const campos = guidedNow ? null : extractCamposBlock(assistantContent);
              if (campos) setPendingFields(campos);
              // Strip the block from what's shown in the chat bubble
              const displayContent = stripAiBlocks(assistantContent);
              feedStreamSpeech(displayContent, false);
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1]!,
                  role: "assistant",
                  content: displayContent,
                };
                return updated;
              });
            }
            if (parsed.actions && parsed.actions.length > 0) {
              // El backend mandó las acciones sugeridas + el bloque crudo
              // [ACCIONES]...[/ACCIONES] para que lo borremos del texto ya mostrado.
              const stripText = parsed.stripText ?? "";
              const initialActions: SuggestedAction[] = parsed.actions.map(a => ({ ...a, state: "idle" }));
              if (stripText) {
                assistantContent = assistantContent.replace(stripText, "");
              }
              const displayContent = stripAiBlocks(assistantContent);
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1]!,
                  role: "assistant",
                  content: displayContent,
                  actions: initialActions,
                };
                return updated;
              });
            }
          } catch { /* partial SSE line */ }
        }
      }
      readerRef.current = null;

      // El usuario eligió algo en la pantalla mientras el copiloto escribía:
      // esta respuesta quedó vieja. No se carga nada de lo que proponía; el
      // panel ya le pidió a la IA que mire la pantalla nueva.
      if (interruptedRef.current) { streamSpeechRef.current = null; return; }
      feedStreamSpeech(stripAiBlocks(assistantContent), true);
      streamSpeechRef.current = null;

      // ── Pantalla que la IA pidió abrir ──
      // Va ANTES de aplicar campos: primero se abre el formulario, después se
      // carga. Al revés no habría formulario donde escribir.
      const openPath = extractOpenScreenBlock(assistantContent);
      if (openPath) {
        navigate(openPath);
        setGuidedPath(openPath);
      }

      // ── Modo guiado: se aplica al final, no de a pedazos ──
      // El bloque [CAMPOS] recién está completo cuando cerró el stream; hacerlo
      // adentro del loop lo aplicaría una vez por chunk.
      // Si la pantalla se abrió recién EN ESTE turno, el formulario todavía no
      // montó y no hay dónde escribir: los campos quedan en el botón "Aplicar",
      // que aparece solo apenas el formulario se registra. Desde el turno
      // siguiente ya entran solos.
      if (guidedNow) {
        const finalFields = extractCamposBlock(assistantContent);
        if (finalFields && hasApplyFieldsCallback) {
          // Paso de elección: la pantalla va a cambiar. Cuando llegue el paso
          // nuevo, el panel le pide a la IA que siga (ver efecto más abajo).
          if (screenContext?.assist?.step) {
            pendingStepRef.current = { flow: screenContext.assist.flow, screen: screenContext.screen, at: Date.now() };
          }
          // Lo que cambie en pantalla en los próximos segundos lo hizo el copiloto, no el usuario.
          lastApplyAtRef.current = Date.now();
          applyFields(finalFields);
          setPendingFields(null);
          setFieldsLoadedFlash(true);
          window.setTimeout(() => setFieldsLoadedFlash(false), 4000);
        }
      }

      // Recálculo pedido por la IA (criterios / LOTO / riesgo): corre los
      // asistentes que registró el formulario abierto, en orden.
      const recalc = extractRecalcBlock(assistantContent);
      if (recalc && formActionNames.length > 0) {
        setRecalcRunning(true);
        lastApplyAtRef.current = Date.now();
        try { await runFormActions(recalc); }
        finally { setRecalcRunning(false); lastApplyAtRef.current = Date.now(); }
      }
    } catch (e: any) {
      setError(e.message ?? "Error al conectar con el copiloto");
      setMessages(prev => {
        const updated = [...prev];
        if (updated[updated.length - 1]?.content === "") updated.pop();
        return updated;
      });
    } finally {
      readerRef.current = null;
      streamSpeechRef.current = null;
      setStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [buildApiMessages, capability, input, messages, screenContext, streaming, selectedVessel, pendingFile,
      guidedNow, hasApplyFieldsCallback, applyFields, formActionNames, runFormActions, navigate, feedStreamSpeech]);

  // Aplica una acción sugerida por la IA. Muta el state del action a
  // applying → applied/failed. POST /app/copiloto/apply-action.
  const applyAction = useCallback(async (msgIdx: number, actionIdx: number) => {
    const message = messages[msgIdx];
    const action = message?.actions?.[actionIdx];
    if (!action || action.state === "applying" || action.state === "applied") return;

    setMessages(prev => {
      const updated = [...prev];
      const m = { ...updated[msgIdx]! };
      m.actions = (m.actions ?? []).map((a, ai) => ai === actionIdx ? { ...a, state: "applying" as const, errorMsg: undefined } : a);
      updated[msgIdx] = m;
      return updated;
    });

    try {
      const res = await api.post<ApplyActionResponse>("/app/copiloto/apply-action", {
        type: action.type,
        target: action.target,
        patch: action.patch ?? {},
        vesselCode: action.vesselCode,
      });
      setMessages(prev => {
        const updated = [...prev];
        const m = { ...updated[msgIdx]! };
        m.actions = (m.actions ?? []).map((a, ai) => ai === actionIdx ? { ...a, state: "applied" as const } : a);
        updated[msgIdx] = m;
        return updated;
      });

      // La OT recién creada se abre en la pantalla central y el copiloto ofrece
      // completarla. Antes quedaba creada pero invisible: había que ir a
      // buscarla al listado para ver qué había salido.
      const createdCode = res?.applied?.entityCode;
      if (createdCode && CREATES_WORK_ORDER.has(action.type)) {
        const path = `/work-orders/${encodeURIComponent(createdCode)}`;
        navigate(path);
        setGuidedPath(path);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `${t("copilot.woOpened")} **${createdCode}**\n\n${t("copilot.woFillOffer")}`,
        }]);
      } else {
        // Confirmación escrita por EL SISTEMA, no por la IA, y sólo después de
        // que el servidor respondió que sí.
        //
        // Es la contracara de la regla dura del prompt: el modelo tiene
        // prohibido decir "quedó registrado" (llegó a decirlo sin haber emitido
        // ninguna acción, y el usuario se fue creyendo que el dato estaba). Si
        // la única frase en pasado del chat la escribe el sistema cuando la
        // escritura ya ocurrió, esa frase vale. Además queda en el historial,
        // así que en el turno siguiente el modelo ve que ya está hecho y no lo
        // vuelve a proponer.
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `${t("copilot.actionDone")} ${action.label ?? action.type}`,
        }]);
      }

      // La pantalla abierta puede estar mostrando justo lo que se acaba de
      // escribir: sin esto el usuario leía "hecho" con la grilla vieja delante
      // y parecía que no había pasado nada. Se avisa a TODAS las pantallas
      // abiertas; las que no escuchan, no hacen nada.
      notifyCopilotDataChanged();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Error al aplicar la acción";
      setMessages(prev => {
        const updated = [...prev];
        const m = { ...updated[msgIdx]! };
        m.actions = (m.actions ?? []).map((a, ai) => ai === actionIdx ? { ...a, state: "failed" as const, errorMsg: msg } : a);
        updated[msgIdx] = m;
        return updated;
      });
    }
  }, [messages, navigate, t]);

  // Auto-send a message requested by an external component (e.g. "Asistir con IA" button)
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  // Un paso de un flujo guiado llevó a la pantalla siguiente (del mismo flujo):
  // la IA pregunta lo que corresponde ahí sin esperar un "seguí". Si en unos
  // segundos no cambió nada (la elección no avanzaba de pantalla), se olvida.
  useEffect(() => {
    const pending = pendingStepRef.current;
    if (!pending || streaming) return;
    if (Date.now() - pending.at > 20_000) { pendingStepRef.current = null; return; }
    const assist = screenContext?.assist;
    if (!assist || assist.flow !== pending.flow || screenContext?.screen === pending.screen) return;
    pendingStepRef.current = null;
    void sendMessageRef.current(NEXT_STEP_MESSAGE, { hidden: true });
  }, [screenContext, streaming]);

  // El usuario actuó directo en la pantalla central de un flujo en asistencia:
  // eligió una opción, pasó a otra ventana o marcó una casilla de lista cerrada.
  // El copiloto se calla, deja de lado lo que estaba diciendo o escribiendo y
  // vuelve a mirar la pantalla para seguir desde ahí. Los cambios de texto
  // libre (tipear) no cuentan: interrumpirían a cada letra.
  const prevAssistRef = useRef<{ flow: string; screen: string; closed: string } | null>(null);
  useEffect(() => {
    const assist = screenContext?.assist;
    const prev = prevAssistRef.current;
    const closed = assist
      ? JSON.stringify(Object.keys(screenContext?.fieldOptions ?? {}).map(k => [k, screenContext?.fieldValues?.[k] ?? null]))
      : "";
    prevAssistRef.current = assist && screenContext ? { flow: assist.flow, screen: screenContext.screen, closed } : null;
    if (!assist || !prev || prev.flow !== assist.flow || !offeredFlows.has(assist.flow)) return;
    const screenChanged = prev.screen !== screenContext!.screen;
    if (!screenChanged && prev.closed === closed) return;
    // Lo acaba de cargar el copiloto: no es el usuario (el paso siguiente lo maneja pendingStepRef).
    if (Date.now() - lastApplyAtRef.current < 2500) return;
    stopSpeaking();
    pendingStepRef.current = null;
    if (streamingRef.current) {
      interruptedRef.current = true;
      void readerRef.current?.cancel().catch(() => {});
    }
    pendingSystemMsgRef.current = { flow: assist.flow, text: screenChanged ? NEXT_STEP_MESSAGE : SCREEN_CHANGE_MESSAGE };
    setSystemMsgTick(n => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenContext]);

  // Manda el aviso pendiente (arrancar a ayudar / la pantalla cambió) apenas
  // no hay otra respuesta en curso y la pantalla activa es la de ese flujo.
  useEffect(() => {
    const pending = pendingSystemMsgRef.current;
    if (!pending || streaming) return;
    if (screenContext?.assist?.flow !== pending.flow) return;
    pendingSystemMsgRef.current = null;
    if (!expanded) setExpanded(true);
    void sendMessageRef.current(pending.text, { hidden: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemMsgTick, streaming, screenContext]);
  useEffect(() => {
    if (!requestMessage) return;
    if (!expanded) setExpanded(true);
    // Tiny delay lets the panel expand before the message goes out. IMPORTANT:
    // consuming requestMessage (setRequestMessage(null)) has to happen INSIDE
    // the timeout, not before scheduling it — nulling it synchronously here
    // changes this effect's own dependency, so React tears down and re-runs
    // it on the next render, and the cleanup below cancels the timeout before
    // the 80ms elapse. The message never went out and nothing failed loudly.
    const tid = setTimeout(() => {
      setRequestMessage(null);
      void sendMessageRef.current(requestMessage);
    }, 80);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestMessage]);

  // Ofrecimiento por iniciativa del copiloto (lo escribe el sistema, sin IA).
  // Una sola vez por `key` en la sesión: reabrir el mismo análisis no vuelve a
  // interrumpir con la misma pregunta.
  const shownOffersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!offer) return;
    clearCopilotOffer();
    if (shownOffersRef.current.has(offer.key)) return;
    // Ofrecimiento de un formulario: respeta el "No volver a ofrecer".
    if (offer.assistFlow && assistOptOut) return;
    shownOffersRef.current.add(offer.key);
    if (!expanded) setExpanded(true);
    if (offer.assistFlow) {
      // No se pregunta si quiere ayuda: se ayuda. El panel le pide a la IA que
      // arranque con la primera pregunta del formulario (ver efecto de avisos).
      const flow = offer.assistFlow;
      setOfferedFlows(prev => new Set(prev).add(flow));
      pendingSystemMsgRef.current = { flow, text: AUTO_START_MESSAGE };
      setSystemMsgTick(n => n + 1);
      return;
    }
    setMessages(prev => [...prev, { role: "assistant", content: offer.text }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer]);

  const optOutAssist = () => {
    try { localStorage.setItem(assistOptOutKey(user?.id), "1"); } catch { /* sin almacenamiento: vale para esta sesión */ }
    setAssistOptOut(true);
    setMessages(prev => [...prev, { role: "assistant", content: t("copilot.assist.optedOut") }]);
  };
  const optInAssist = () => {
    try { localStorage.removeItem(assistOptOutKey(user?.id)); } catch { /* noop */ }
    setAssistOptOut(false);
    setMessages(prev => [...prev, { role: "assistant", content: t("copilot.assist.optedIn") }]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  };

  const handleInternalLinkClick = (path: string) => { navigate(path); };

  const clearConversation = () => {
    stopSpeaking();
    lastSpokenRef.current = -1;
    setMessages([]); setError(null); setPendingFields(null); setPendingFile(null);
    setGuidedPath(null);
  };

  // ---------------------------------------------------------------------------
  // Collapsed strip
  // ---------------------------------------------------------------------------

  if (!expanded) {
    return (
      <aside className="relative z-55 flex flex-col items-center h-screen w-10 border-l border-border bg-surface dark:bg-[#080D1D] shrink-0 pt-3 pb-3 gap-3">
        {/* Resize handle — left edge */}
        <div
          className="absolute top-0 left-0 h-full w-1.5 cursor-col-resize z-10 group"
          onMouseDown={(e) => startResize(e, "left")}
        >
          <div className="absolute left-0 top-0 h-full w-px bg-fg/10 group-hover:bg-accent/50 transition-colors duration-150" />
        </div>

        <button
          onClick={() => setExpanded(true)}
          title="Abrir Copiloto IA"
          className="text-accent hover:text-fg transition-colors"
        >
          <Bot className="w-5 h-5" />
        </button>
        {hasSuggestions && (
          <span className="w-2 h-2 rounded-full bg-warning animate-pulse" title={`${suggestions.length} sugerencia(s) activa(s)`} />
        )}
        {screenContext && (
          <span className="text-[8px] font-bold text-accent/40 uppercase tracking-widest [writing-mode:vertical-rl] rotate-180 select-none">
            {screenContext.module.replace("_", " ")}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setExpanded(true)}
          title="Expandir"
          className="text-text-industrial/20 hover:text-fg transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </aside>
    );
  }

  // ---------------------------------------------------------------------------
  // Expanded panel
  // ---------------------------------------------------------------------------

  return (
    <aside
      className={`relative flex flex-col border-l border-border bg-surface dark:bg-[#080D1D] shrink-0 ${
        fullscreen
          ? "fixed inset-0 z-100"
          : "z-55 h-screen"
      }`}
      style={fullscreen ? undefined : { width: panelWidth }}
    >
      {/* Resize handle — left edge (hidden in fullscreen) */}
      {!fullscreen && (
        <div
          className="absolute top-0 left-0 h-full w-1.5 cursor-col-resize z-10 group"
          onMouseDown={(e) => startResize(e, "left")}
        >
          <div className="absolute left-0 top-0 h-full w-px bg-fg/10 group-hover:bg-accent/50 transition-colors duration-150" />
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0 bg-fg/[0.03]">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-[11px] font-bold text-fg">Copiloto CMS3.0</span>
          {screenContext && (
            <span className="text-[9px] text-accent/50 font-mono uppercase tracking-wider truncate">
              {screenContext.module.replace("_", " ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={toggleVoice}
            title={voiceOn ? t("copilot.voice.turnOff") : t("copilot.voice.turnOn")}
            aria-pressed={voiceOn}
            className={`transition-colors ${voiceOn ? "text-accent hover:text-fg" : "text-text-industrial/30 hover:text-fg"}`}
          >
            {voiceOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
          {assistOptOut && (
            <button onClick={optInAssist} title={t("copilot.assist.reEnable")} className="text-text-industrial/30 hover:text-accent transition-colors">
              <Sparkles className="w-3 h-3" />
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={clearConversation} title="Limpiar conversación" className="text-text-industrial/30 hover:text-danger transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setFullscreen(f => !f)} title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} className="text-text-industrial/30 hover:text-fg transition-colors">
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          {!fullscreen && (
            <button onClick={() => setExpanded(false)} title="Colapsar" className="text-text-industrial/30 hover:text-fg transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Capability selector ── */}
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <select
          value={capability}
          onChange={e => setCapability(e.target.value)}
          className="w-full bg-fg/5 border border-border rounded-lg px-2 py-1 text-[10px] text-text-industrial/60 focus:outline-none focus:border-accent/30 appearance-none"
        >
          {CAPABILITIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* ── Context strip (only when a page/modal emits context) ── */}
      {screenContext && (
        <div className="px-3 py-2 border-b border-border shrink-0 bg-accent/3">
          <div className="flex items-center gap-2 flex-wrap">
            {screenContext.entityCode && (
              <span className="text-[10px] font-mono font-bold text-fg/80">{screenContext.entityCode}</span>
            )}
            {screenContext.workflowStage && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-fg/10 text-text-industrial/50 font-mono">
                {screenContext.workflowStage}
              </span>
            )}
            {screenContext.canEdit === false && (
              <span className="text-[9px] text-text-industrial/30">solo lectura</span>
            )}
          </div>
          {screenContext.vesselCode && (
            <p className="text-[9px] text-text-industrial/30 mt-0.5">Vessel: {screenContext.vesselCode}</p>
          )}
        </div>
      )}

      {/* ── Single pending-items action ── */}
      {screenContext && hasSuggestions && (
        <div className="px-2 py-2 border-b border-border shrink-0">
          <button
            onClick={() => void sendMessage(buildPendingItemsPrompt(screenContext, suggestions, woTerms))}
            disabled={streaming}
            className="w-full text-[10px] px-2.5 py-2 rounded-lg bg-accent/10 border border-accent/20 text-accent font-semibold hover:bg-accent/20 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
          >
            <Zap className="w-2.5 h-2.5 shrink-0" />
            Ayúdame a completar los ítems pendientes
          </button>
        </div>
      )}

      {/* ── DEFERRALS quick-action ── */}
      {screenContext?.module === "DEFERRALS" && (
        <div className="px-2 py-2 border-b border-border shrink-0">
          <button
            onClick={() => void sendMessage(buildDeferralAnalysisPrompt(screenContext))}
            disabled={streaming}
            className="w-full text-[10px] px-2.5 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 font-semibold hover:bg-purple-500/20 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
          >
            <BarChart2 className="w-2.5 h-2.5 shrink-0" />
            Analizar diferimiento
          </button>
        </div>
      )}

      {/* ── Recálculo de criterios / LOTO / riesgo pedido por el copiloto ── */}
      {recalcRunning && (
        <div className="px-2 py-2 border-b border-border shrink-0">
          <p className="text-[10px] text-accent font-semibold flex items-center justify-center gap-1.5">
            <Loader2 className="w-2.5 h-2.5 shrink-0 animate-spin" />
            {t("copilot.recalculating")}
          </p>
        </div>
      )}

      {/* ── Modo guiado: los campos ya entraron solos al formulario ── */}
      {fieldsLoadedFlash && (
        <div className="px-2 py-1.5 border-b border-border shrink-0">
          <p className="text-[9px] text-text-industrial/40 text-center">{t("copilot.fieldsLoaded")}</p>
        </div>
      )}

      {/* ── Apply AI-proposed fields ── */}
      {pendingFields && hasApplyFieldsCallback && (
        <div className="px-2 py-2 border-b border-border shrink-0">
          <button
            onClick={() => {
              applyFields(pendingFields);
              setPendingFields(null);
            }}
            className="w-full text-[10px] px-2.5 py-2 rounded-lg bg-success-sea/10 border border-success-sea/20 text-success-sea font-semibold hover:bg-success-sea/20 transition-all flex items-center justify-center gap-1.5"
          >
            <CheckCheck className="w-2.5 h-2.5 shrink-0" />
            Aplicar campos sugeridos al formulario
          </button>
          <p className="text-[8px] text-text-industrial/30 text-center mt-1">
            {Object.keys(pendingFields).length} campo(s) — revisá antes de guardar
          </p>
        </div>
      )}

      {/* ── Chat messages ── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-text-industrial/20 gap-2 select-none py-6">
            <Bot className="w-7 h-7" />
            <p className="text-[10px] leading-relaxed px-3">
              {screenContext
                ? `Contexto: ${screenContext.module.replace("_", " ")}. Usá las acciones rápidas o escribí tu consulta.`
                : "Preguntame sobre mantenimiento, defectos o cualquier dato operacional."}
            </p>
          </div>
        )}

        {messages.map((msg, i) => msg.hidden ? null : (
          <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[92%] rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-accent/20 border border-accent/20 text-fg"
                : "bg-fg/5 border border-border text-text-industrial/80"
            }`}>
              {msg.content
                ? renderMarkdownLite(msg.content, `msg-${i}`, handleInternalLinkClick)
                : (streaming && i === messages.length - 1
                  ? <span className="flex gap-1 items-center text-text-industrial/40">
                      <span className="w-1 h-1 bg-accent rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1 h-1 bg-accent rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1 h-1 bg-accent rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                  : ""
                )
              }
            </div>
            {msg.assistOffer && !assistOptOut && (
              <button
                type="button"
                onClick={optOutAssist}
                className="mt-0.5 px-1 text-[9px] text-text-industrial/40 hover:text-accent underline underline-offset-2 transition-colors"
              >
                {t("copilot.assist.optOut")}
              </button>
            )}
            {/* Suggested actions — botones "Aplicar" debajo del mensaje */}
            {msg.role === "assistant" && msg.actions && msg.actions.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {msg.actions.map((action, ai) => (
                  <div key={ai} className="flex items-center gap-2 bg-accent/[0.06] border border-accent/20 rounded-lg px-2.5 py-1.5">
                    <Sparkles className="w-3 h-3 text-accent shrink-0" />
                    <span className="flex-1 text-[11px] text-text-industrial leading-tight">
                      {action.label ?? `Aplicar ${action.type} en ${action.target}`}
                      {action.state === "applied" && <span className="ml-1 text-success-sea">✓ aplicado</span>}
                      {action.state === "failed" && action.errorMsg && (
                        <span className="ml-1 text-danger text-[10px]">— {action.errorMsg}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => { void applyAction(i, ai); }}
                      disabled={action.state === "applying" || action.state === "applied"}
                      className="px-2 py-1 rounded-md bg-accent text-accent-fg text-[10px] font-bold uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
                    >
                      {action.state === "applying" ? "Aplicando…" : action.state === "applied" ? "Aplicado" : "Aplicar"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* TTS play button — assistant messages only, when complete */}
            {msg.role === "assistant" && msg.content && !(streaming && i === messages.length - 1) && (
              <div className="mt-0.5 px-1">
                <button
                  onClick={() => speakMessage(i, msg.content)}
                  title={speakingIdx === i ? "Detener" : "Escuchar resumen"}
                  className="flex items-center gap-1 text-[9px] text-text-industrial/30 hover:text-accent transition-colors"
                >
                  {speakingIdx === i
                    ? <Square className="w-2.5 h-2.5 text-accent" />
                    : <Volume2 className="w-2.5 h-2.5" />
                  }
                  <span>{speakingIdx === i ? "Detener" : "Escuchar"}</span>
                </button>
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="text-[10px] text-danger bg-danger/10 border border-danger/25 rounded-lg px-2.5 py-1.5">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-2 py-2 border-t border-border shrink-0">
        {/* Attachment chip */}
        {pendingFile && (
          <div className="flex items-center gap-1.5 mb-1.5 px-2 py-1 rounded-lg bg-accent/10 border border-accent/20">
            <Paperclip className="w-2.5 h-2.5 text-accent shrink-0" />
            <span className="text-[10px] text-accent truncate flex-1">{pendingFile.fileName}</span>
            <button onClick={() => setPendingFile(null)} className="text-text-industrial/40 hover:text-danger transition-colors shrink-0">
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        )}
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }}
        />
        <div className="flex items-end gap-1.5">
          <div className="flex flex-col gap-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || uploading}
            title="Adjuntar archivo (PDF, imagen, Excel, CSV)"
            className={`shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center transition-all disabled:opacity-30 ${
              pendingFile
                ? "bg-accent/20 border-accent/40 text-accent"
                : "bg-fg/5 border-border text-text-industrial/40 hover:text-accent hover:border-accent/30"
            }`}
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
          </button>
          <button
            onClick={startVoiceInput}
            disabled={streaming}
            title={listening ? "Detener grabación" : "Hablar"}
            className={`shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center transition-all disabled:opacity-30 ${
              listening
                ? "bg-danger/20 border-danger/40 text-danger animate-pulse"
                : "bg-fg/5 border-border text-text-industrial/40 hover:text-accent hover:border-accent/30"
            }`}
          >
            {listening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
          </button>
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Escribe tu pregunta… (Enter para enviar)"
            rows={2}
            style={{ resize: "vertical" }}
            className="flex-1 resize-y min-h-[52px] max-h-[40vh] overflow-y-auto bg-fg/5 border border-border rounded-xl px-2.5 py-2 text-[11px] text-text-industrial placeholder-text-industrial/20 focus:outline-none focus:border-accent/40 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={() => { void sendMessage(); }}
            disabled={streaming || !input.trim()}
            className="shrink-0 w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 text-accent flex items-center justify-center hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {streaming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
        <p className="text-[8px] text-text-industrial/20 mt-1 text-center">
          Copiloto IA · solo sugiere, nunca actúa por vos
        </p>
      </div>
    </aside>
  );
};
