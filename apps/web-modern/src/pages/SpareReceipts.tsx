// Recepción de repuestos: historial de lo que entró al buque y acceso a la
// ventana de carga (la misma que abre el botón verde del Dashboard).
//
// La pantalla anterior era un formulario propio, sin traducciones, que elegía
// el repuesto en un desplegable plano y no controlaba duplicados. Todo eso vive
// ahora en SpareReceiptModal, que busca primero en el stock del buque; acá sólo
// queda la lista de recepciones con su remito y su proveedor.
import React, { useState } from "react";
import { PackagePlus, Plus } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { useT } from "../lib/i18n";
import { useCan } from "../lib/auth";
import { useVesselContext } from "../lib/vessel-context";
import { PageHeader } from "../components/PageHeader";
import { fmtDate } from "../components/DataTable";
import { SpareReceiptModal } from "../components/spares/SpareReceiptModal";
import { AuthedDocLink } from "../lib/authed-media";

interface ReceiptLine { sku: string | null; name: string | null; quantity: number; unit: string; }

interface GoodsReceipt {
  id: string;
  receiptCode: string;
  vesselCode: string;
  documentNumber: string | null;
  providerName: string | null;
  receivedAt: string;
  fileUrl: string | null;
  fileName: string | null;
  notes: string | null;
  lineCount: number;
  lines: ReceiptLine[];
}

export const SpareReceiptsPage: React.FC = () => {
  const t = useT();
  const can = useCan();
  const { vessels, selectedVesselCode } = useVesselContext();
  const [showModal, setShowModal] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const query = selectedVesselCode ? `?vesselCode=${encodeURIComponent(selectedVesselCode)}` : "";
  const { data, loading } = useFetch<{ items: GoodsReceipt[] }>(
    `/app/pms/goods-receipts${query}`,
    [refresh, selectedVesselCode],
  );
  const receipts = data?.items ?? [];
  const canReceive = can("stock.manage");

  return (
    <div className="space-y-6">
      <PageHeader icon={PackagePlus} title={t("page.spareReceipts")} total={receipts.length}>
        {canReceive && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-success-sea/15 border border-success-sea/40 text-success-sea rounded-xl hover:bg-success-sea/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            {t("rcp.page.new")}
          </button>
        )}
      </PageHeader>

      <p className="text-xs text-fg/40">{t("rcp.page.subtitle")}</p>

      {!loading && receipts.length === 0 && (
        <p className="text-xs text-fg/30 py-8 text-center">{t("rcp.page.empty")}</p>
      )}

      <div className="space-y-2">
        {receipts.map(r => (
          <div key={r.id} className="border border-fg/10 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-sm font-bold text-accent">{r.receiptCode}</span>
              <span className="font-mono text-xs text-fg/50">{r.vesselCode}</span>
              {r.documentNumber && <span className="text-xs text-fg/60">{t("rcp.docNumber")}: {r.documentNumber}</span>}
              {r.providerName && <span className="text-xs text-fg/60">{r.providerName}</span>}
              <span className="text-xs text-fg/40">{fmtDate(r.receivedAt)}</span>
              <span className="text-xs text-fg/40">{r.lineCount} {t("rcp.page.items")}</span>
              {r.fileUrl && (
                <AuthedDocLink
                  src={r.fileUrl}
                  label={t("rcp.page.viewFile")}
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                />
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {r.lines.map((l, i) => (
                <span key={i} className="text-xs text-fg/70">
                  {l.name ?? "—"} <span className="font-mono text-fg/40">{l.sku ?? ""}</span>
                  <strong className="text-success-sea ml-1">+{l.quantity} {l.unit}</strong>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <SpareReceiptModal
          vessels={vessels.map(v => ({ code: v.code, name: v.name ?? null }))}
          defaultVesselCode={selectedVesselCode}
          onClose={() => setShowModal(false)}
          onSaved={() => setRefresh(n => n + 1)}
        />
      )}
    </div>
  );
};
