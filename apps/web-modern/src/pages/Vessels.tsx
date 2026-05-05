import React, { useEffect, useState } from "react";
import { Ship, FileSpreadsheet, Plus, Trash2, X, Map } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { fmtDate, FILTER_ALL_VALUE, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useEscapeGuard, useDirtyTracker } from "../lib/escape-guard";

interface Vessel {
  id: string;
  code: string;
  name: string;
  owner?: string | null;
  vesselType?: string | null;
  imo?: string | null;
  registration?: string | null;
  powerHp?: number | null;
  dwtTons?: number | null;
  lengthM?: number | null;
  beamM?: number | null;
  depthM?: number | null;
  trnTn?: number | null;
  trbTn?: number | null;
  buildYear?: number | null;
  buildCountry?: string | null;
  incorporationDate?: string | null;
  incorporationType?: string | null;
  status: string;
  createdAt: string;
}
interface ListResponse { items: Vessel[]; total: number; }

function asInputText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function asDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}

function asNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function asNullableInt(value: string): number | null {
  const num = asNullableNumber(value);
  return num === null ? null : Math.trunc(num);
}

function asNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="space-y-1.5">
    <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider whitespace-nowrap">{label}</label>
    {hint && <p className="text-[10px] text-text-industrial/30">{hint}</p>}
    {children}
  </div>
);

const VesselForm: React.FC<{ initial?: Vessel | null; onClose: () => void; onSaved: () => void }> = ({ initial, onClose, onSaved }) => {
  const t = useT();
  const isEdit = !!initial;
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [owner, setOwner] = useState(asInputText(initial?.owner));
  const [vesselType, setVesselType] = useState(asInputText(initial?.vesselType));
  const [imo, setImo] = useState(asInputText(initial?.imo));
  const [registration, setRegistration] = useState(asInputText(initial?.registration));
  const [powerHp, setPowerHp] = useState(asInputText(initial?.powerHp));
  const [dwtTons, setDwtTons] = useState(asInputText(initial?.dwtTons));
  const [lengthM, setLengthM] = useState(asInputText(initial?.lengthM));
  const [beamM, setBeamM] = useState(asInputText(initial?.beamM));
  const [depthM, setDepthM] = useState(asInputText(initial?.depthM));
  const [trnTn, setTrnTn] = useState(asInputText(initial?.trnTn));
  const [trbTn, setTrbTn] = useState(asInputText(initial?.trbTn));
  const [buildYear, setBuildYear] = useState(asInputText(initial?.buildYear));
  const [buildCountry, setBuildCountry] = useState(asInputText(initial?.buildCountry));
  const [incorporationDate, setIncorporationDate] = useState(asDateInputValue(initial?.incorporationDate));
  const [incorporationType, setIncorporationType] = useState(asInputText(initial?.incorporationType));
  const [status, setStatus] = useState(initial?.status ?? "ACTIVE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const payload = {
        name,
        owner: asNullableText(owner),
        vesselType: asNullableText(vesselType),
        imo: asNullableText(imo),
        registration: asNullableText(registration),
        powerHp: asNullableNumber(powerHp),
        dwtTons: asNullableNumber(dwtTons),
        lengthM: asNullableNumber(lengthM),
        beamM: asNullableNumber(beamM),
        depthM: asNullableNumber(depthM),
        trnTn: asNullableNumber(trnTn),
        trbTn: asNullableNumber(trbTn),
        buildYear: asNullableInt(buildYear),
        buildCountry: asNullableText(buildCountry),
        incorporationDate: asNullableText(incorporationDate),
        incorporationType: asNullableText(incorporationType),
        status,
      };

      if (isEdit) await api.put(`/app/vessels/${initial!.id}`, payload);
      else await api.post("/app/vessels", { code, ...payload });
      onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.saveError")); }
    finally { setSaving(false); }
  };

  // ESC guard
  const isDirty = useDirtyTracker({
    code, name, owner, vesselType, imo, registration, powerHp, dwtTons,
    lengthM, beamM, depthM, trnTn, trbTn, buildYear, buildCountry,
    incorporationDate, incorporationType, status,
  });
  useEscapeGuard({
    isDirty,
    onSave: () => handleSubmit({ preventDefault: () => {} } as React.FormEvent),
    onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-4xl bg-surface border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Ship className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-white">{isEdit ? t("vessel.editTitle") : t("vessel.newTitle")}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-text-industrial/40 hover:text-white transition-all"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_7fr] gap-4">
            <div>
              <Field label="Codigo_Embarcacion *">
                <input
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  required
                  maxLength={20}
                  placeholder="CODIGO"
                  disabled={isEdit}
                  className="input-field disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </Field>
              <p className="mt-1.5 text-[10px] text-text-industrial/30">{t("vessel.codeHint")}</p>
            </div>
            <div>
              <Field label="VesselName *">
                <input value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder={t("vessel.namePlaceholder")} className="input-field" />
              </Field>
            </div>
          </div>
          <Field label="Armador">
            <input value={owner} onChange={e => setOwner(e.target.value)} maxLength={120} placeholder="Mercurio Group SA" className="input-field" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Tipo">
              <input value={vesselType} onChange={e => setVesselType(e.target.value)} maxLength={120} placeholder="Remolcador / Empuje" className="input-field" />
            </Field>
            <Field label="IMO">
              <input value={imo} onChange={e => setImo(e.target.value)} maxLength={40} placeholder="-" className="input-field" />
            </Field>
            <Field label="Matricula">
              <input value={registration} onChange={e => setRegistration(e.target.value)} maxLength={60} placeholder="4497-RE" className="input-field" />
            </Field>
            <Field label="Potencia_HP">
              <input value={powerHp} onChange={e => setPowerHp(e.target.value)} inputMode="decimal" placeholder="6400" className="input-field" />
            </Field>
            <Field label="DWT_tons">
              <input value={dwtTons} onChange={e => setDwtTons(e.target.value)} inputMode="decimal" placeholder="184,00" className="input-field" />
            </Field>
            <Field label="Eslora_m">
              <input value={lengthM} onChange={e => setLengthM(e.target.value)} inputMode="decimal" placeholder="43,00" className="input-field" />
            </Field>
            <Field label="Manga_m">
              <input value={beamM} onChange={e => setBeamM(e.target.value)} inputMode="decimal" placeholder="18,00" className="input-field" />
            </Field>
            <Field label="Puntal_m">
              <input value={depthM} onChange={e => setDepthM(e.target.value)} inputMode="decimal" placeholder="3,00" className="input-field" />
            </Field>
            <Field label="TRN_tn">
              <input value={trnTn} onChange={e => setTrnTn(e.target.value)} inputMode="decimal" placeholder="330" className="input-field" />
            </Field>
            <Field label="TRB_tn">
              <input value={trbTn} onChange={e => setTrbTn(e.target.value)} inputMode="decimal" placeholder="1097" className="input-field" />
            </Field>
            <Field label="Ano_Construcc">
              <input value={buildYear} onChange={e => setBuildYear(e.target.value)} inputMode="numeric" placeholder="2005" className="input-field" />
            </Field>
            <Field label="Pais_Construccion">
              <input value={buildCountry} onChange={e => setBuildCountry(e.target.value)} maxLength={80} placeholder="Paraguay" className="input-field" />
            </Field>
            <Field label="Fecha_Incorporacion">
              <input value={incorporationDate} onChange={e => setIncorporationDate(e.target.value)} type="date" className="input-field" />
            </Field>
            <Field label="Tipo_Incorporacion">
              <input value={incorporationType} onChange={e => setIncorporationType(e.target.value)} maxLength={40} placeholder="Propio / Charteado" className="input-field" />
            </Field>
          </div>
          <Field label={t("col.status")}>
            <select value={status} onChange={e => setStatus(e.target.value)} className="input-field">
              <option value="ACTIVE">{t("status.active")}</option>
              <option value="INACTIVE">{t("status.inactive")}</option>
              <option value="DECOMMISSIONED">{t("status.decommissioned")}</option>
            </select>
          </Field>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-white hover:bg-white/5 transition-all">{t("common.cancel")}</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
              {saving ? t("common.saving") : isEdit ? t("vessel.saveChanges") : t("vessel.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const DeleteConfirm: React.FC<{ vessel: Vessel; onClose: () => void; onDeleted: () => void }> = ({ vessel, onClose, onDeleted }) => {
  const t = useT();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.delete(`/app/vessels/${vessel.id}`); onDeleted(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.deleteError")); setDeleting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-surface border border-white/10 rounded-2xl shadow-2xl p-6 space-y-4">
        <h2 className="text-sm font-bold text-white">{t("vessel.deleteTitle")}</h2>
        <p className="text-xs text-text-industrial/60"><span className="text-white font-bold">{vessel.code} \u2014 {vessel.name}</span></p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-white hover:bg-white/5 transition-all">{t("common.cancel")}</button>
          <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 rounded-xl bg-red-500/80 text-white font-bold text-xs hover:bg-red-500 disabled:opacity-50 transition-all">
            {deleting ? t("vessel.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
};

export const VesselsPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("");
  const [showExcel, setShowExcel] = useState(false);
  const [formVessel, setFormVessel] = useState<Vessel | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Vessel | null>(null);

  useCopilotEmitter(formVessel === undefined ? { module: "VESSELS", screen: "VESSEL_LIST" } : {
    module: "VESSELS",
    screen: formVessel ? "VESSEL_EDIT" : "VESSEL_CREATE",
    entityId: formVessel?.id,
    entityCode: formVessel?.code,
    canEdit: true,
    fieldValues: {
      name:       formVessel?.name        ?? null,
      vesselType: formVessel?.vesselType  ?? null,
      status:     formVessel?.status      ?? null,
      imo:        formVessel?.imo         ?? null,
    },
  });

  const path = `/app/vessels${statusFilter ? `?status=${statusFilter}` : ""}`;
  const { data, loading, error, reload } = useFetch<ListResponse>(path, [statusFilter]);

  const openEditForm = async (row: Vessel) => {
    try {
      const detailed = await api.get<Vessel>(`/app/vessels/${row.id}`);
      setFormVessel(detailed);
    } catch {
      setFormVessel(row);
    }
  };

  const COLUMNS: Column<Vessel>[] = [
    { key: "code",      header: t("col.code"),      render: r => <span className="font-mono font-bold text-white">{r.code}</span> },
    { key: "name",      header: t("col.name"),      render: r => <span className="font-medium text-white">{r.name}</span> },
    { key: "vesselType",header: "TIPO",            render: r => <span className="text-text-industrial/80">{r.vesselType ?? "—"}</span> },
    { key: "status",    header: t("col.status"),    render: r => <StatusBadge status={r.status} /> },
    {
      key: "actions", header: "",
      render: r => (
        <button onClick={e => { e.stopPropagation(); setDeleteTarget(r); }} className="p-1.5 rounded-lg text-text-industrial/30 hover:text-red-400 hover:bg-red-500/10 transition-all" title={t("common.delete")}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {showExcel && <ExcelPanel module="vessels" onClose={() => { setShowExcel(false); reload(); }} />}
      {formVessel !== undefined && <VesselForm initial={formVessel} onClose={() => setFormVessel(undefined)} onSaved={() => { setFormVessel(undefined); reload(); }} />}
      {deleteTarget && <DeleteConfirm vessel={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); reload(); }} />}
      <PageHeader icon={Ship} title={t("page.vessels")} total={data?.total} onReload={reload}>
        {user?.role === "TENANT_ADMIN" && (
          <button onClick={() => navigate("/vessel-map")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
            <Map className="w-3.5 h-3.5 text-accent" /> {t("nav.vesselMap")}
          </button>
        )}
        <button onClick={() => setFormVessel(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all">
          <Plus className="w-3.5 h-3.5" /> {t("common.new")}
        </button>
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        <select value={toFilterSelectValue(statusFilter)} onChange={e => setStatusFilter(fromFilterSelectValue(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="ACTIVE">{t("status.active")}</option>
          <option value="INACTIVE">{t("status.inactive")}</option>
          <option value="DECOMMISSIONED">{t("status.decommissioned")}</option>
        </select>
      </PageHeader>
      <DataTable columns={COLUMNS} data={data?.items ?? null} loading={loading} error={error} keyFn={r => r.id} emptyText={t("empty.vessels")} onRowClick={r => { void openEditForm(r); }} />
    </div>
  );
};
