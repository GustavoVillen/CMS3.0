import React, { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { downloadDocx } from "../lib/download-docx";
import { useT } from "../lib/i18n";
import { AlertDialog } from "./AlertDialog";

/**
 * Botón del encabezado que baja el formulario controlado EN BLANCO en Word
 * (.docx), para imprimirlo y completarlo a mano (OT y SS).
 */
export const BlankFormButton: React.FC<{ url: string; filename: string; label: string }> = ({ url, filename, label }) => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
      <button type="button" disabled={busy} title={t("forms.blank.hint")}
        onClick={async () => {
          setBusy(true);
          try {
            if (!await downloadDocx(url, filename)) setError(t("forms.blank.error"));
          } finally { setBusy(false); }
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fg/5 border border-fg/10 text-xs text-text-industrial hover:border-accent/30 transition-all disabled:opacity-50">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5 text-accent" />}
        {label}
      </button>
    </>
  );
};
