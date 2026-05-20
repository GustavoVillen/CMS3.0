// Matriz de Requerimientos (config) — define qué entrenamientos son obligatorios
// para cada rango. Solo TENANT_ADMIN.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { useT } from "../lib/i18n";

interface Rank {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

interface TrainingItem {
  id: string;
  code: string;
  name: string;
  regulation: string | null;
  category: string | null;
  validityYears: number | null;
  sortOrder: number;
}

interface Requirement {
  id: string;
  rankDefinitionId: string;
  trainingItemId: string;
  level: string; // OBRIGATORIO | VALIDO | DESEJAVEL
  validityYears: number | null;
}

interface MatrixData {
  ranks: Rank[];
  trainingItems: TrainingItem[];
  categories: string[];
  requirements: Requirement[];
}

const LEVEL_CLS: Record<string, string> = {
  "":            "bg-white/[0.02] text-text-industrial/30 border-white/5",
  "OBRIGATORIO": "bg-red-500/15 text-red-300 border-red-500/40",
  "VALIDO":      "bg-success-sea/15 text-success-sea border-success-sea/40",
  "DESEJAVEL":   "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
};

export const RequirementsMatrixPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const LEVEL_OPTIONS = [
    { value: "",            label: "—" },
    { value: "OBRIGATORIO", label: t("rm.lvlObligatorio") },
    { value: "VALIDO",      label: t("rm.lvlValido") },
    { value: "DESEJAVEL",   label: t("rm.lvlDeseable") },
  ];
  const LEVEL_LABEL: Record<string, string> = Object.fromEntries(LEVEL_OPTIONS.map(o => [o.value, o.label]));
  const isAdmin = user?.role === "TENANT_ADMIN";

  const [category, setCategory] = useState<string>("");
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null); // key rankId|itemId

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const qs = category ? `?category=${encodeURIComponent(category)}` : "";
      const r = await api.get<MatrixData>(`/app/crew-requirements-matrix${qs}`);
      setData(r);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [category]);

  useEffect(() => { void reload(); }, [reload]);

  // Index requirements para lookup O(1) por rankId|itemId
  const reqByCell = useMemo(() => {
    const m = new Map<string, Requirement>();
    for (const r of data?.requirements ?? []) m.set(`${r.rankDefinitionId}|${r.trainingItemId}`, r);
    return m;
  }, [data?.requirements]);

  async function onChangeLevel(rankId: string, itemId: string, newLevel: string) {
    if (!isAdmin) return;
    const cellKey = `${rankId}|${itemId}`;
    setSavingCell(cellKey);
    try {
      if (newLevel === "") {
        await api.delete(`/app/crew-requirements/${rankId}/${itemId}`);
      } else {
        await api.post(`/app/crew-requirements`, {
          rankDefinitionId: rankId,
          trainingItemId: itemId,
          level: newLevel,
        });
      }
      // Update local state sin reload completo
      setData(prev => {
        if (!prev) return prev;
        const others = prev.requirements.filter(r => !(r.rankDefinitionId === rankId && r.trainingItemId === itemId));
        if (newLevel === "") return { ...prev, requirements: others };
        const existing = prev.requirements.find(r => r.rankDefinitionId === rankId && r.trainingItemId === itemId);
        return {
          ...prev,
          requirements: [...others, {
            id: existing?.id ?? `${rankId}-${itemId}`,
            rankDefinitionId: rankId,
            trainingItemId: itemId,
            level: newLevel,
            validityYears: existing?.validityYears ?? null,
          }],
        };
      });
    } finally {
      setSavingCell(null);
    }
  }

  const totalRequirements = data?.requirements.length ?? 0;

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-orange-200 text-sm">
          {t("rm.adminOnly")}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={ClipboardList} title={t("nav.requirementsMatrix")} total={totalRequirements} onReload={reload}>
        <></>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={e => setCategory(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
          <option value="">{t("rm.allCategories")}</option>
          {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-3 text-[10px] text-text-industrial/60">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/40 border border-red-500/60" /> {t("rm.legendObligatorio")}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-sea/40 border border-success-sea/60" /> {t("rm.legendValido")}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-500/40 border border-yellow-500/60" /> {t("rm.legendDeseable")}</span>
        </div>
      </div>

      <div className="text-[11px] text-text-industrial/50">
        {t("rm.helpPart1")} {t("rm.helpPart2")} <strong>{t("rm.trainingsMatrix")}</strong>.
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
      ) : !data || data.ranks.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">{t("rm.noRanks")}</div>
      ) : data.trainingItems.length === 0 ? (
        <div className="text-center py-10 text-text-industrial/40 text-sm">
          {t("rm.noItems")}
          {category && <span className="block mt-1">{t("rm.tryRemoveFilter")}</span>}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white/[0.03] border border-white/10 rounded-xl">
          <table className="text-[10px] min-w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="sticky left-0 z-10 bg-[#0D1B2A] text-left px-3 py-2 font-bold uppercase tracking-widest text-text-industrial/60 min-w-[200px]">{t("rm.colRank")}</th>
                {data.trainingItems.map(it => (
                  <th key={it.id} className="px-2 py-2 text-center font-bold uppercase tracking-wider text-text-industrial/50 min-w-[80px] whitespace-nowrap">
                    <span title={`${it.name}${it.regulation ? " — " + it.regulation : ""}${it.validityYears ? " · " + it.validityYears + "y" : ""}`}>{it.code}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.ranks.map(r => (
                <tr key={r.id} className="border-b border-white/5 last:border-b-0">
                  <td className="sticky left-0 z-10 bg-[#0D1B2A] px-3 py-2">
                    <div className="text-xs font-bold text-white">{r.name}</div>
                    <div className="text-[9px] text-text-industrial/40 uppercase tracking-wider">{r.code}</div>
                  </td>
                  {data.trainingItems.map(it => {
                    const req = reqByCell.get(`${r.id}|${it.id}`);
                    const currentLevel = req?.level ?? "";
                    const cellKey = `${r.id}|${it.id}`;
                    const isSaving = savingCell === cellKey;
                    const cls = LEVEL_CLS[currentLevel] ?? LEVEL_CLS[""];
                    return (
                      <td key={it.id} className="px-1 py-1 text-center">
                        <select
                          value={currentLevel}
                          disabled={isSaving}
                          onChange={e => { void onChangeLevel(r.id, it.id, e.target.value); }}
                          title={req ? t("rm.cellTitleHas").replace("{level}", LEVEL_LABEL[currentLevel]).replace("{rank}", r.name) : t("rm.cellTitleEmpty")}
                          className={`w-full h-7 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${cls} ${isSaving ? "opacity-50" : ""}`}
                        >
                          {LEVEL_OPTIONS.map(o => (
                            <option key={o.value} value={o.value} className="bg-[#0D1B2A] text-white">{o.label}</option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
