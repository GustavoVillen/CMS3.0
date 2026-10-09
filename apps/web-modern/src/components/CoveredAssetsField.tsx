import { useMemo } from "react";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";
import { AssetSearchDropdown, type AssetOption } from "./AssetSearchDropdown";

export interface CoveredAssetRef { id: string; assetCode: string; name: string | null }

/**
 * "Equipos que revisa" de una tarea del plan, además de su equipo principal.
 * El checklist mensual consolidado cuelga de un equipo "Inspecciones MENSUALES"
 * pero revisa las balsas, las luces portátiles, el CO2…: declarándolos acá esos
 * equipos dejan de figurar "Sin plan". Sólo equipos del mismo buque (la lista
 * `assets` ya viene filtrada por el buque de la tarea).
 */
export function CoveredAssetsField({ assets, value, mainAssetId, onChange, disabled, labelCls }: {
  assets: AssetOption[];
  value: CoveredAssetRef[];
  mainAssetId: string;
  onChange: (next: CoveredAssetRef[]) => void;
  disabled?: boolean;
  labelCls: string;
}) {
  const t = useT();
  const chosen = value.filter(a => a.id !== mainAssetId);
  const options = useMemo(() => {
    const taken = new Set([mainAssetId, ...value.map(a => a.id)]);
    return assets.filter(a => !taken.has(a.id));
  }, [assets, value, mainAssetId]);

  const add = (id: string) => {
    const a = assets.find(x => x.id === id);
    if (!a || value.some(v => v.id === id)) return;
    onChange([...value, { id: a.id, assetCode: a.assetCode, name: a.name }]
      .sort((x, y) => x.assetCode.localeCompare(y.assetCode)));
  };

  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{t("mp.coveredAssets")}</label>
      <p className="text-[11px] text-text-industrial/45">{t("mp.coveredAssetsHint")}</p>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map(a => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-lg border border-accent/25 bg-accent/10 pl-2 pr-1 py-0.5 text-[11.5px] text-fg">
              <span className="font-mono text-[10.5px] text-text-industrial/60">{a.assetCode}</span>
              <span className="font-semibold">{a.name ?? a.assetCode}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter(v => v.id !== a.id))}
                  title={t("mp.coveredAssetsRemove")}
                  className="rounded p-0.5 text-text-industrial/50 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <AssetSearchDropdown
          assets={options}
          value=""
          onChange={add}
          disabled={options.length === 0}
          placeholder={t("mp.coveredAssetsAdd")}
        />
      )}
    </div>
  );
}
