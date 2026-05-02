import React from "react";
import { Loader2, ShieldAlert, X, Check } from "lucide-react";
import { api, ApiError } from "../lib/api";

export interface PendingStandbyTest {
  assetId: string;
  assetCode: string;
  assetName: string;
  vesselCode: string;
  sfiCode: string | null;
  frequencyDays: number;
  lastTestedAt: string | null;
  lastResult: "OK" | "FAILED" | null;
  daysSinceLastTest: number | null;
  overdueDays: number;
  isOverdue: boolean;
}

/**
 * ISM 10.3 — Lista de pruebas pendientes (vencidas o por vencer en 7 días)
 * sobre equipos isSafetyCritical con standbyTestFrequencyDays definido.
 * Click en "Registrar prueba" abre modal con 3 campos: fecha, resultado, notas.
 */
export const StandbyTestsWidget: React.FC<{
  items: PendingStandbyTest[];
  loading: boolean;
  onChanged: () => void;
}> = ({ items, loading, onChanged }) => {
  const [registering, setRegistering] = React.useState<PendingStandbyTest | null>(null);

  if (!loading && items.length === 0) return null;

  return (
    <div className="bento-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">Pruebas de standby ISM</h2>
          <span className="text-[10px] text-text-industrial/50">(ISM 10.3)</span>
        </div>
        {loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-text-industrial/40 py-2">Sin pruebas pendientes.</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {items.map(item => (
            <div
              key={item.assetId}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${
                item.isOverdue
                  ? "bg-red-500/10 border-red-500/30"
                  : "bg-amber-500/5 border-amber-500/20"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm text-white truncate">
                  <span className="font-mono text-[10px] text-accent shrink-0">{item.vesselCode}</span>
                  <span className="font-medium truncate">{item.assetName}</span>
                  <span className="text-[10px] text-text-industrial/40 shrink-0">({item.assetCode})</span>
                </div>
                <div className="text-[11px] text-text-industrial/60 mt-0.5">
                  {item.lastTestedAt
                    ? <>Última prueba hace <strong className={item.isOverdue ? "text-red-400" : "text-amber-300"}>{item.daysSinceLastTest} días</strong> · frecuencia cada {item.frequencyDays} días</>
                    : <>Nunca probado · frecuencia cada {item.frequencyDays} días</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRegistering(item)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all"
              >
                Registrar prueba
              </button>
            </div>
          ))}
        </div>
      )}

      {registering && (
        <RegisterStandbyTestModal
          asset={registering}
          onClose={() => setRegistering(null)}
          onSaved={() => { setRegistering(null); onChanged(); }}
        />
      )}
    </div>
  );
};

const RegisterStandbyTestModal: React.FC<{
  asset: PendingStandbyTest;
  onClose: () => void;
  onSaved: () => void;
}> = ({ asset, onClose, onSaved }) => {
  const [testedAt, setTestedAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = React.useState<"OK" | "FAILED">("OK");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.post("/app/pms/standby-tests", {
        assetId: asset.assetId,
        testedAt,
        result,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo registrar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">Registrar prueba de standby</h2>
            <p className="text-xs text-text-industrial/50 mt-0.5">{asset.assetName} ({asset.assetCode})</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Fecha de la prueba</label>
            <input
              type="date"
              value={testedAt}
              onChange={e => setTestedAt(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Resultado</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setResult("OK")}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-semibold text-sm transition-all ${
                  result === "OK"
                    ? "bg-green-500/20 border-green-500/50 text-green-300"
                    : "bg-white/5 border-white/10 text-text-industrial/60 hover:bg-white/10"
                }`}
              >
                <Check className="w-4 h-4" /> OK
              </button>
              <button
                type="button"
                onClick={() => setResult("FAILED")}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-semibold text-sm transition-all ${
                  result === "FAILED"
                    ? "bg-red-500/20 border-red-500/50 text-red-300"
                    : "bg-white/5 border-white/10 text-text-industrial/60 hover:bg-white/10"
                }`}
              >
                <X className="w-4 h-4" /> Falló
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Observaciones (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Detalles del estado del equipo, anomalías, recomendaciones..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 resize-y"
            />
          </div>

          {err && <div className="text-xs text-red-400 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">{err}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-text-industrial/60 hover:text-white text-sm font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-sm hover:brightness-110 transition-all disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
