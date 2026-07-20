// Matriz de Requerimientos (config) — define qué entrenamientos son obligatorios
// para cada rango. Solo TENANT_ADMIN.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, Plus, X } from "lucide-react";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { api } from "../lib/api";
import { useEscapeGuard } from "../lib/escape-guard";
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
  "":            "bg-fg/[0.02] text-text-industrial/30 border-fg/5",
  "OBRIGATORIO": "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40",
  "VALIDO":      "bg-success-sea/15 text-success-sea border-success-sea/40",
  "DESEJAVEL":   "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/40",
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
  const [showNewItem, setShowNewItem] = useState(false);
  const [newItem, setNewItem] = useState({ code: "", name: "", regulation: "", category: "", validityYears: "" });
  const [savingNew, setSavingNew] = useState(false);
  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  const [showNewRank, setShowNewRank] = useState(false);
  const [newRank, setNewRank] = useState({ code: "", name: "", sortOrder: "" });
  const [savingNewRank, setSavingNewRank] = useState(false);
  const [deletingRank, setDeletingRank] = useState<string | null>(null);

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

  async function onCreateItem(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin || !newItem.code.trim() || !newItem.name.trim()) return;
    setSavingNew(true);
    try {
      await api.post(`/app/crew/training-items`, {
        code: newItem.code.trim().toUpperCase(),
        name: newItem.name.trim(),
        regulation: newItem.regulation.trim() || undefined,
        category: newItem.category.trim() || undefined,
        validityYears: newItem.validityYears ? Number(newItem.validityYears) : undefined,
      });
      setNewItem({ code: "", name: "", regulation: "", category: "", validityYears: "" });
      setShowNewItem(false);
      await reload();
    } finally {
      setSavingNew(false);
    }
  }

  async function onDeleteItem(itemId: string, code: string) {
    if (!isAdmin) return;
    const msg = t("rm.confirmDeleteItem").replace("{code}", code);
    if (!window.confirm(msg)) return;
    setDeletingItem(itemId);
    try {
      await api.delete(`/app/crew/training-items/${itemId}`);
      await reload();
    } finally {
      setDeletingItem(null);
    }
  }

  async function onCreateRank(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin || !newRank.code.trim() || !newRank.name.trim()) return;
    setSavingNewRank(true);
    try {
      await api.post(`/app/crew/ranks`, {
        code: newRank.code.trim().toUpperCase(),
        name: newRank.name.trim(),
        sortOrder: newRank.sortOrder ? Number(newRank.sortOrder) : undefined,
      });
      setNewRank({ code: "", name: "", sortOrder: "" });
      setShowNewRank(false);
      await reload();
    } finally {
      setSavingNewRank(false);
    }
  }

  // ESC: cerrar / preguntar guardar en los modales de nuevo ítem / nuevo rango
  const requestCloseNewItem = useEscapeGuard({
    enabled: showNewItem,
    isDirty: !!(newItem.code || newItem.name || newItem.regulation || newItem.category || newItem.validityYears),
    onSave: () => onCreateItem({ preventDefault: () => {} } as React.FormEvent),
    onClose: () => setShowNewItem(false),
  });
  const requestCloseNewRank = useEscapeGuard({
    enabled: showNewRank,
    isDirty: !!(newRank.code || newRank.name || newRank.sortOrder),
    onSave: () => onCreateRank({ preventDefault: () => {} } as React.FormEvent),
    onClose: () => setShowNewRank(false),
  });

  async function onDeleteRank(rankId: string, code: string) {
    if (!isAdmin) return;
    const msg = t("rm.confirmDeleteRank").replace("{code}", code);
    if (!window.confirm(msg)) return;
    setDeletingRank(rankId);
    try {
      await api.delete(`/app/crew/ranks/${rankId}`);
      await reload();
    } finally {
      setDeletingRank(null);
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
        <select value={category} onChange={e => setCategory(e.target.value)} className="bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg">
          <option value="">{t("rm.allCategories")}</option>
          {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <button
          type="button"
          onClick={() => setShowNewItem(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("rm.newItem")}
        </button>

        <button
          type="button"
          onClick={() => setShowNewRank(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("rm.newRank")}
        </button>

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
        <div className="overflow-x-auto bg-fg/[0.03] border border-fg/10 rounded-xl">
          <table className="text-[10px] min-w-full">
            <thead>
              <tr className="border-b border-fg/10">
                <th className="sticky left-0 z-10 bg-surface dark:bg-[#0D1B2A] text-left px-3 py-2 font-bold uppercase tracking-widest text-text-industrial/60 min-w-[200px]">{t("rm.colRank")}</th>
                {data.trainingItems.map(it => (
                  <th key={it.id} className="group relative px-2 py-2 text-center font-bold uppercase tracking-wider text-text-industrial/50 min-w-[80px] whitespace-nowrap">
                    <span title={`${it.name}${it.regulation ? " — " + it.regulation : ""}${it.validityYears ? " · " + it.validityYears + "y" : ""}`}>{it.code}</span>
                    <button
                      type="button"
                      onClick={() => onDeleteItem(it.id, it.code)}
                      disabled={deletingItem === it.id}
                      title={t("common.delete")}
                      className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-red-700 dark:text-red-400 hover:text-red-300 hover:bg-red-500/20 disabled:opacity-30"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.ranks.map(r => (
                <tr key={r.id} className="group border-b border-fg/5 last:border-b-0">
                  <td className="sticky left-0 z-10 bg-surface dark:bg-[#0D1B2A] px-3 py-2 relative">
                    <div className="text-xs font-bold text-fg">{r.name}</div>
                    <div className="text-[9px] text-text-industrial/40 uppercase tracking-wider">{r.code}</div>
                    <button
                      type="button"
                      onClick={() => onDeleteRank(r.id, r.code)}
                      disabled={deletingRank === r.id}
                      title={t("common.delete")}
                      className="absolute top-1/2 -translate-y-1/2 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-red-700 dark:text-red-400 hover:text-red-300 hover:bg-red-500/20 disabled:opacity-30"
                    >
                      <X className="w-3 h-3" />
                    </button>
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
                            <option key={o.value} value={o.value} className="bg-surface dark:bg-[#0D1B2A] text-fg">{o.label}</option>
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

      {showNewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !savingNew && setShowNewItem(false)}>
          <form
            onSubmit={onCreateItem}
            onClick={e => e.stopPropagation()}
            className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-xl p-6 w-full max-w-md space-y-3"
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-fg">{t("rm.createItemTitle")}</h2>
              {/* El `!savingNew` sigue: mientras se está grabando, la X no
                  hace nada — cerrar a mitad del POST deja el alta a ciegas. */}
              <ModalCloseButton onClose={() => !savingNew && requestCloseNewItem()} />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("rm.itemCode")} *</label>
              <input
                type="text"
                required
                value={newItem.code}
                onChange={e => setNewItem({ ...newItem, code: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
                placeholder="STCW_VI_3"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("common.name")} *</label>
              <input
                type="text"
                required
                value={newItem.name}
                onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("rm.itemRegulation")}</label>
              <input
                type="text"
                value={newItem.regulation}
                onChange={e => setNewItem({ ...newItem, regulation: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("rm.itemCategory")}</label>
              <input
                type="text"
                list="rm-categories"
                value={newItem.category}
                onChange={e => setNewItem({ ...newItem, category: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
              />
              <datalist id="rm-categories">
                {(data?.categories ?? []).map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("rm.itemValidity")}</label>
              <input
                type="number"
                min="0"
                value={newItem.validityYears}
                onChange={e => setNewItem({ ...newItem, validityYears: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewItem(false)}
                disabled={savingNew}
                className="px-3 py-1.5 rounded-lg text-xs bg-fg/5 border border-fg/10 text-text-industrial/70 hover:bg-fg/10"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={savingNew || !newItem.code.trim() || !newItem.name.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 disabled:opacity-50"
              >
                {savingNew && <Loader2 className="w-3 h-3 animate-spin" />}
                {t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}

      {showNewRank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !savingNewRank && setShowNewRank(false)}>
          <form
            onSubmit={onCreateRank}
            onClick={e => e.stopPropagation()}
            className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-xl p-6 w-full max-w-md space-y-3"
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-fg">{t("rm.createRankTitle")}</h2>
              <ModalCloseButton onClose={() => !savingNewRank && requestCloseNewRank()} />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("rm.rankCode")} *</label>
              <input
                type="text"
                required
                value={newRank.code}
                onChange={e => setNewRank({ ...newRank, code: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
                placeholder="OS_2"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("common.name")} *</label>
              <input
                type="text"
                required
                value={newRank.name}
                onChange={e => setNewRank({ ...newRank, name: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-industrial/60 mb-1">{t("rm.rankSortOrder")}</label>
              <input
                type="number"
                min="0"
                value={newRank.sortOrder}
                onChange={e => setNewRank({ ...newRank, sortOrder: e.target.value })}
                className="w-full bg-fg/5 border border-fg/10 rounded-lg px-3 py-1.5 text-xs text-fg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewRank(false)}
                disabled={savingNewRank}
                className="px-3 py-1.5 rounded-lg text-xs bg-fg/5 border border-fg/10 text-text-industrial/70 hover:bg-fg/10"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={savingNewRank || !newRank.code.trim() || !newRank.name.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 disabled:opacity-50"
              >
                {savingNewRank && <Loader2 className="w-3 h-3 animate-spin" />}
                {t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
