import React, { useState } from "react";
import { FileSpreadsheet, Maximize2, Minimize2, Plus, Truck, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DataTable, StatusBadge, fmtDate, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { VesselLabel } from "../components/EntityLabels";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Provider {
  id: string; providerCode: string; name: string; vesselCode: string;
  category: string | null; status: string;
  contactName: string | null; contactEmail: string | null;
  contactPhone: string | null; location: string | null; createdAt: string;
}
interface ListResponse { items: Provider[]; total: number; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-accent/50";
const labelCls = "block text-[10px] font-semibold text-white/50 uppercase tracking-wider mb-1";

// ---------------------------------------------------------------------------
// ProviderModal
// ---------------------------------------------------------------------------

interface ModalProps {
  provider: Provider | null;
  onClose: () => void;
  onSaved: (p: Provider) => void;
}

const ProviderModal: React.FC<ModalProps> = ({ provider, onClose, onSaved }) => {
  const t = useT();
  const isNew = provider === null;

  const [vesselCode,    setVesselCode]    = useState(provider?.vesselCode    ?? "");
  const [providerCode,  setProviderCode]  = useState(provider?.providerCode  ?? "");
  const [name,          setName]          = useState(provider?.name          ?? "");
  const [category,      setCategory]      = useState(provider?.category      ?? "");
  const [status,        setStatus]        = useState(provider?.status        ?? "ACTIVE");
  const [contactName,   setContactName]   = useState(provider?.contactName   ?? "");
  const [contactEmail,  setContactEmail]  = useState(provider?.contactEmail  ?? "");
  const [contactPhone,  setContactPhone]  = useState(provider?.contactPhone  ?? "");
  const [location,      setLocation]      = useState(provider?.location      ?? "");

  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (isNew) {
        const vessel = vesselCode.trim().toUpperCase();
        if (!vessel) { setError("Vessel es requerido."); setSaving(false); return; }
        if (!name.trim()) { setError("Nombre es requerido."); setSaving(false); return; }
        const result = await api.post<Provider>("/app/providers", {
          vesselCode:   vessel,
          providerCode: providerCode.trim() || null,
          name:         name.trim(),
          category:     category.trim() || null,
          status:       status,
          contactName:  contactName.trim()  || null,
          contactEmail: contactEmail.trim() || null,
          contactPhone: contactPhone.trim() || null,
          location:     location.trim()     || null,
        });
        onSaved(result);
      } else {
        if (!name.trim()) { setError("Nombre es requerido."); setSaving(false); return; }
        const result = await api.patch<Provider>(`/app/providers/${provider.id}`, {
          name:         name.trim(),
          category:     category.trim() || null,
          status:       status,
          contactName:  contactName.trim()  || null,
          contactEmail: contactEmail.trim() || null,
          contactPhone: contactPhone.trim() || null,
          location:     location.trim()     || null,
        });
        onSaved(result);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar.");
    } finally { setSaving(false); }
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    vesselCode, providerCode, name, category, status,
    contactName, contactEmail, contactPhone, location,
  });
  useEscapeGuard({ isDirty, onSave: handleSave, onClose });

  const handleDelete = async () => {
    if (!provider) return;
    if (!window.confirm(t("confirm.deleteProvider").replace("{name}", provider.name))) return;
    setSaving(true);
    try {
      await api.delete(`/app/providers/${provider.id}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al eliminar.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col transition-all duration-200 ${expanded ? "w-full h-full" : "max-w-xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <Truck className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-bold text-white">{isNew ? "Nuevo Proveedor" : provider.name}</h2>
              {!isNew && <p className="text-[10px] text-white/40 mt-0.5">{provider.providerCode} · Vessel: {provider.vesselCode}</p>}
            </div>
            {!isNew && <StatusBadge status={provider.status} />}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors" title={expanded ? "Reducir" : "Ampliar"}>
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-white/40 hover:text-white" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Vessel *</label>
              {isNew
                ? <input value={vesselCode} onChange={e => setVesselCode(e.target.value.toUpperCase())} placeholder="VESSEL" className={inputCls} />
                : <p className="text-sm"><VesselLabel code={provider.vesselCode} className="text-sm" showCode /></p>}
            </div>
            <div>
              <label className={labelCls}>Código proveedor</label>
              {isNew
                ? <input value={providerCode} onChange={e => setProviderCode(e.target.value.toUpperCase())} placeholder="Auto-generado si vacío" className={inputCls} />
                : <p className="text-sm font-mono text-white/60">{provider.providerCode}</p>}
            </div>
          </div>

          <div>
            <label className={labelCls}>Nombre *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del proveedor" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Categoría</label>
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ej. Repuestos, Servicios…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Estado</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </div>
          </div>

          {/* Contact info */}
          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Contacto</p>
            <div>
              <label className={labelCls}>Nombre de contacto</label>
              <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Nombre y apellido" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="correo@proveedor.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Teléfono</label>
                <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+54 11…" className={inputCls} />
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Ubicación / Dirección</label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Ciudad, País…" className={inputCls} />
          </div>

          {!isNew && <p className="text-[10px] text-white/20">Alta: {fmtDate(provider.createdAt)}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 space-y-2">
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <div>
              {!isNew && (
                <button onClick={() => void handleDelete()} disabled={saving} className="px-3 py-1.5 text-xs text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg transition-colors disabled:opacity-40">
                  Eliminar
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-1.5 text-xs text-white/50 hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-colors">Cerrar</button>
              <button onClick={() => void handleSave()} disabled={saving} className="px-5 py-1.5 text-xs font-semibold bg-accent/20 border border-accent/30 text-accent rounded-lg hover:bg-accent/30 disabled:opacity-40 transition-all">
                {saving ? "Guardando…" : (isNew ? "Crear proveedor" : "Guardar")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ProvidersPage
// ---------------------------------------------------------------------------

export const ProvidersPage: React.FC = () => {
  const t = useT();

  const [vesselInput,  setVesselInput]  = useState("");
  const [vesselFilter, setVesselFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [catFilter,    setCatFilter]    = useState("");
  const [showExcel,    setShowExcel]    = useState(false);
  const [selected,     setSelected]     = useState<Provider | null | "new">(null);

  const buildPath = () => {
    const p = new URLSearchParams();
    if (vesselFilter) p.set("vesselCode", vesselFilter);
    if (statusFilter) p.set("status",     statusFilter);
    if (catFilter)    p.set("category",   catFilter);
    const qs = p.toString();
    return `/app/providers${qs ? `?${qs}` : ""}`;
  };

  const { data, loading, error, reload } = useFetch<ListResponse>(buildPath(), [vesselFilter, statusFilter, catFilter]);

  const handleSaved = (p: Provider) => { reload(); setSelected(p); };

  // Derive unique categories for filter dropdown
  const categories = [...new Set((data?.items ?? []).map(p => p.category).filter(Boolean) as string[])].sort();

  const COLUMNS: Column<Provider>[] = [
    { key: "providerCode", header: t("col.code"),     render: r => <span className="font-mono font-bold text-white text-xs">{r.providerCode}</span> },
    { key: "name",         header: t("col.name"),     render: r => <span className="font-medium text-white text-xs">{r.name}</span> },
    { key: "vesselCode",   header: t("col.vessel"),   render: r => <VesselLabel code={r.vesselCode} className="text-xs" showCode /> },
    { key: "category",     header: t("col.category"), render: r => <span className="text-xs text-white/60">{r.category ?? "—"}</span> },
    { key: "status",       header: t("col.status"),   render: r => <StatusBadge status={r.status} /> },
    { key: "contactName",  header: "Contacto",        render: r => <span className="text-xs text-white/70">{r.contactName ?? "—"}</span> },
    { key: "contactEmail", header: "Email",           render: r => r.contactEmail ? <a href={`mailto:${r.contactEmail}`} onClick={e => e.stopPropagation()} className="text-accent hover:underline text-xs">{r.contactEmail}</a> : <span className="text-white/20 text-xs">—</span> },
    { key: "contactPhone", header: t("col.phone"),    render: r => <span className="text-xs text-white/60">{r.contactPhone ?? "—"}</span> },
    { key: "location",     header: t("col.location"), render: r => <span className="text-xs text-white/50">{r.location ?? "—"}</span> },
    { key: "createdAt",    header: t("col.createdAt"),render: r => fmtDate(r.createdAt) },
  ];

  return (
    <div className="space-y-5">
      {showExcel && <ExcelPanel module="providers" onClose={() => { setShowExcel(false); reload(); }} />}
      {selected && (
        <ProviderModal
          provider={selected === "new" ? null : selected}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}

      <PageHeader icon={Truck} title={t("page.providers")} total={data?.total} onReload={reload}>
        {/* Excel */}
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>

        {/* Create */}
        <button onClick={() => setSelected("new")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-all font-semibold">
          <Plus className="w-3.5 h-3.5" /> Nuevo proveedor
        </button>
      </PageHeader>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? null}
        loading={loading}
        error={error}
        keyFn={r => r.id}
        emptyText={t("empty.providers")}
        onRowClick={r => setSelected(r)}
      />
    </div>
  );
};
