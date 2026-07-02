// Botón "Copiar link" — copia la URL actual (deep-link del registro abierto) al
// portapapeles, con feedback breve. Se usa en el header de los modales de
// detalle (OT, Plan, Diferimiento…).

import React, { useState, useCallback } from "react";
import { Link2, Check } from "lucide-react";

export const CopyLinkButton: React.FC<{ className?: string; title?: string }> = ({ className, title }) => {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback para contextos sin permiso de clipboard.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? "Copiar link"}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
        copied
          ? "text-success-sea border-success-sea/30 bg-success-sea/10"
          : "text-text-industrial/60 border-fg/10 hover:text-accent hover:border-accent/40"
      } ${className ?? ""}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
      {copied ? "¡Copiado!" : "Copiar link"}
    </button>
  );
};
