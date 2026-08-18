// Tipos, constantes y componentes chicos compartidos entre la página de
// Análisis de Fluidos (FluidAnalyses.tsx) y el wizard guiado de registro con
// IA (ScanFluidSampleWizard.tsx). Separado en su propio módulo para que
// ninguno de los dos importe del otro (evita import circular página↔componente).
import React from "react";
import { CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";
import { ModalCloseButton } from "../ModalCloseButton";

export const FLUID_TYPES = [
  "ENGINE_OIL", "HYDRAULIC_OIL", "GEARBOX_OIL", "TRANSMISSION_OIL",
  "FUEL_DIESEL", "FUEL_GASOIL",
  "COOLING_WATER", "BOILER_WATER", "POTABLE_WATER",
  "REFRIGERANT", "OTHER",
] as const;
export type FluidType = typeof FLUID_TYPES[number];

export const VERDICTS = ["NORMAL", "CAUTION", "CRITICAL", "ACTION_REQUIRED"] as const;
export type Verdict = typeof VERDICTS[number];

export const SAMPLE_STATUSES = ["DRAFT", "SENT", "REPORTED", "ARCHIVED"] as const;
export type SampleStatus = typeof SAMPLE_STATUSES[number];

export const FLUID_LABELS: Record<FluidType, string> = {
  ENGINE_OIL:       "Aceite motor",
  HYDRAULIC_OIL:    "Hidráulico",
  GEARBOX_OIL:      "Reductora",
  TRANSMISSION_OIL: "Transmisión",
  FUEL_DIESEL:      "Diesel",
  FUEL_GASOIL:      "Gasoil",
  COOLING_WATER:    "Refrigeración",
  BOILER_WATER:     "Caldera",
  POTABLE_WATER:    "Agua potable",
  REFRIGERANT:      "Refrigerante",
  OTHER:            "Otro",
};

export const VERDICT_STYLES: Record<Verdict, { bg: string; text: string; border: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  NORMAL:           { bg: "bg-green-500/10",  text: "text-green-700 dark:text-green-400",  border: "border-green-500/20",  label: "NORMAL",           Icon: CheckCircle2 },
  CAUTION:          { bg: "bg-yellow-500/10", text: "text-yellow-700 dark:text-yellow-400", border: "border-yellow-500/20", label: "PRECAUCIÓN",       Icon: AlertTriangle },
  CRITICAL:         { bg: "bg-red-500/10",    text: "text-red-700 dark:text-red-400",    border: "border-red-500/20",    label: "CRÍTICO",          Icon: AlertOctagon },
  ACTION_REQUIRED:  { bg: "bg-red-500/15",    text: "text-red-700 dark:text-red-300",    border: "border-red-500/30",    label: "ACCIÓN REQUERIDA", Icon: AlertOctagon },
};

export interface FluidParameter { value: number | string; unit?: string; }
export interface FluidResult {
  id: string;
  receivedAt: string;
  verdict: Verdict;
  summary: string | null;
  parameters: Record<string, FluidParameter | number | string>;
  reportUrl: string | null;
  reportMime: string | null;
  aiAnalysis: string | null;
  aiAnalysisGeneratedAt: string | null;
}

// Tipos de muestreo. FLUID es el caso histórico. Al ampliar el módulo a CBM,
// la misma tabla almacena también vibración, termografía, etc. `fluidType`
// queda null cuando kind !== "FLUID".
export type SampleKind = "FLUID" | "VIBRATION" | "THERMAL" | "ULTRASOUND" | "OTHER";

export const SAMPLE_KIND_LABELS: Record<SampleKind, string> = {
  FLUID:      "Fluido",
  VIBRATION:  "Vibración",
  THERMAL:    "Termografía",
  ULTRASOUND: "Ultrasonido",
  OTHER:      "Otro",
};

export interface FluidSample {
  id: string;
  vesselCode: string;
  assetId: string;
  sampleCode: string;
  kind: SampleKind;
  fluidType: FluidType | null;
  fluidProduct: string | null;
  sampledAt: string;
  runningHours: number | null;
  containerCode: string | null;
  sentAt: string | null;
  labName: string | null;
  labReference: string | null;
  status: SampleStatus;
  notes: string | null;
  result: FluidResult | null;
  createdAt: string;
  sourceWorkOrderId: string | null;
  /** Código de la OT que generó la muestra, resuelto por el backend en el listado. */
  sourceWorkOrderCode?: string | null;
  sourcePlanId: string | null;
}

export interface AssetItem { id: string; name: string | null; assetCode: string | null; vesselCode: string; }

export const inputCls = "w-full bg-fg/5 border border-fg/10 rounded-xl px-3 py-2 text-sm text-fg placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60";
export const labelCls = "block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider mb-1.5";

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLES[verdict];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${s.bg} ${s.text} ${s.border}`}>
      <s.Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

export function assetLabel(assetId: string, assets: AssetItem[]): string {
  const a = assets.find(x => x.id === assetId);
  if (!a) return assetId.slice(0, 8) + "…";
  return a.name ?? a.assetCode ?? assetId;
}

export function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const m = {
    high:   { bg: "bg-green-500/10",  text: "text-green-700 dark:text-green-400",  label: "Alta" },
    medium: { bg: "bg-yellow-500/10", text: "text-yellow-700 dark:text-yellow-400", label: "Verificar" },
    low:    { bg: "bg-red-500/10",    text: "text-red-700 dark:text-red-400",    label: "Dudosa" },
  }[confidence];
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
}

export function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${wide ? "max-w-5xl" : "max-w-2xl"} max-h-[92vh] overflow-y-auto bg-surface dark:bg-[#0D1526] border border-fg/10 rounded-2xl shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-fg/10 sticky top-0 bg-surface dark:bg-[#0D1526] z-10">
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
