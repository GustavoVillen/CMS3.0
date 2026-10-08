// "EQUIPO Y TRABAJO" — franja debajo del encabezado de la OT (Preview V1 aprobada,
// 08-oct-2026). Al abrir la OT tiene que verse de un vistazo qué máquina y qué
// trabajo es, sin bajar a "Qué hay que hacer". Antes decía sólo "Varios equipos (2)".
//
// Una línea por equipo: el nombre en negrita y las tareas de sus planes, juntas.
// Sale de los planes que ya trae la OT; una OT sin plan muestra el equipo y su título.

import { useState } from "react";
import { Cog } from "lucide-react";
import { useT } from "../../lib/i18n";
import type { WoPlanRow } from "./WoPlansPanel";

/** Equipos que se ven sin desplegar; el resto queda tras "Ver N más". */
const VISIBLES = 3;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * La tarea sin el equipo repetido adelante: "RADAR DE BABOR SAMYUNG SMR 3700:
 * Verificación…" → "Verificación…", porque el equipo ya va en negrita. Sólo si lo
 * de antes de los dos puntos tiene todas las palabras del equipo: "SERVICE:",
 * "CONTROL:" o "TOMA DE MUESTRAS:" dicen qué tipo de trabajo es y se quedan.
 */
function sinEquipo(asset: string | null, title: string): string {
  const i = title.indexOf(":");
  if (!asset || i < 0) return title;
  const antes = fold(title.slice(0, i));
  const palabras = fold(asset).split(/[^a-z0-9#]+/).filter(w => w.length > 2);
  const repite = palabras.length > 0 && palabras.every(w => antes.includes(w));
  return repite ? title.slice(i + 1).trim() || title : title;
}

export function WoWorkSummary({ plans, assetName, title }: {
  plans?: WoPlanRow[];
  /** Equipo y título de la OT: lo que se muestra cuando no tiene planes. */
  assetName?: string | null;
  title?: string | null;
}) {
  const t = useT();
  const [abierto, setAbierto] = useState(false);

  const grupos: Array<{ asset: string | null; tasks: string[] }> = [];
  if (plans && plans.length > 0) {
    for (const p of plans) {
      const asset = p.assetName ?? null;
      let g = grupos.find(x => x.asset === asset);
      if (!g) { g = { asset, tasks: [] }; grupos.push(g); }
      const tarea = sinEquipo(asset, p.title);
      if (!g.tasks.includes(tarea)) g.tasks.push(tarea);
    }
  } else if (assetName || title) {
    grupos.push({ asset: assetName ?? null, tasks: title ? [title] : [] });
  }
  if (grupos.length === 0) return null;

  const visibles = abierto ? grupos : grupos.slice(0, VISIBLES);
  const ocultos = grupos.length - VISIBLES;

  return (
    <div className="px-6 pt-2 pb-2.5 bg-fg/[0.03] border-b border-fg/10 shrink-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-industrial/40 mb-1">
        {t("wo.header.work")}
      </p>
      <div className="divide-y divide-dashed divide-fg/10">
        {visibles.map((g, i) => (
          <div key={`${g.asset ?? ""}-${i}`}
            className="grid grid-cols-1 sm:grid-cols-[minmax(9rem,14rem)_1fr] gap-x-3.5 gap-y-0.5 py-1 items-baseline">
            {g.asset ? (
              <div className="flex items-baseline gap-1.5 min-w-0" title={g.asset}>
                <Cog className="w-3.5 h-3.5 shrink-0 text-accent translate-y-0.5" />
                <span className="text-sm font-bold text-fg truncate">{g.asset}</span>
              </div>
            ) : <div className="hidden sm:block" />}
            <p className="text-[13px] leading-snug text-fg/80 line-clamp-2" title={g.tasks.join(" · ")}>
              {g.tasks.map((tarea, j) => (
                <span key={j}>
                  {j > 0 && <span className="px-1 text-text-industrial/40">·</span>}
                  {tarea}
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
      {ocultos > 0 && (
        <button type="button" onClick={() => setAbierto(v => !v)}
          className="mt-0.5 text-xs font-bold text-accent hover:underline">
          {abierto ? t("wo.header.less") : t("wo.header.more").replace("{n}", String(ocultos))}
        </button>
      )}
    </div>
  );
}
