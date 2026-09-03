// Carga rápida de horómetros desde el Dashboard.
//
// La tarjeta del Dashboard (grilla de widgets) muestra el estado de las lecturas;
// el botón de carga abre este modal con la planilla compacta, reusando
// <AssetHoursGrid>. Va en modal y no dentro de la tarjeta porque los widgets
// tienen alto fijo (172px) y una planilla no entra sin romper la grilla.
//
// La pantalla completa (/asset-hours) sigue siendo la de siempre: otras fechas,
// historial por equipo, equipos sin seguimiento y export a Excel.

import React, { useState } from "react";
import { Check, Copy, Gauge } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { ModalCloseButton } from "./ModalCloseButton";
import { AssetHoursGrid, type HoursSheet } from "./AssetHoursGrid";

interface Props {
  sheet: HoursSheet;
  readingDate: string;
  vesselName: string | null;
  onSaved: () => void;
  onClose: () => void;
}

export const AssetHoursQuickModal: React.FC<Props> = ({
  sheet, readingDate, vesselName, onSaved, onClose,
}) => {
  const t = useT();
  const navigate = useNavigate();

  // Link a la pantalla completa CON el buque de esta planilla: es lo que se
  // manda por chat. Sin el código, el que lo abre cae en el buque que tenga
  // elegido él, que no tiene por qué ser el mismo.
  const fullPath = `/asset-hours?vesselCode=${encodeURIComponent(sheet.vesselCode)}`;
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${fullPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sin portapapeles: queda el botón de abrir la pantalla completa */ }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-fg/10">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20 shrink-0">
              <Gauge className="w-4 h-4 text-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-fg">{t("assetHours.pageTitle")}</h2>
              {/* Nombre del buque, no el código. */}
              <p className="text-xs text-text-industrial/50">
                {vesselName ?? sheet.vesselCode} · {readingDate}
              </p>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="overflow-y-auto p-5">
          <AssetHoursGrid
            sheet={sheet}
            readingDate={readingDate}
            onSaved={onSaved}
            compact
          />
        </div>

        <div className="px-5 py-3 border-t border-fg/10 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => { void copyLink(); }}
            title={t("assetHours.copyLinkHint")}
            className={`flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${
              copied ? "text-success-sea" : "text-text-industrial/60 hover:text-fg"
            }`}
          >
            {copied
              ? <><Check className="w-3.5 h-3.5" />{t("common.copied")}</>
              : <><Copy className="w-3.5 h-3.5" />{t("common.copyLink")}</>}
          </button>
          <button
            type="button"
            onClick={() => { onClose(); navigate(fullPath); }}
            className="text-[11px] font-semibold text-accent hover:underline"
          >
            {t("assetHours.openFull")}
          </button>
        </div>
      </div>
    </div>
  );
};
