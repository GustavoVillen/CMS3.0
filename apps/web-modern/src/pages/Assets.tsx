import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileSpreadsheet, Loader2, Plus, Settings, Trash2, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { FILTER_ALL_VALUE, fmtDate, fromFilterSelectValue, toFilterSelectValue } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { ExcelPanel } from "../components/ExcelPanel";
import { useT } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useCopilotEmitter } from "../lib/copilot-context";

interface Asset {
  id: string;
  tenantId: string;
  vesselCode: string;
  assetCode: string;
  sfiCode: string | null;
  name: string;
  criticality: string;
  status: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  installationDate: string | null;
  lastOverhaulDate: string | null;
  replacementDate: string | null;
  trackDailyReport: boolean;
  currentHours: number | null;
  equipmentClassId: string | null;
  parentAssetId: string | null;
  createdAt: string;
}

interface ListResponse {
  items: Asset[];
  total: number;
}

interface Vessel {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface VesselListResponse {
  items: Vessel[];
  total: number;
}

interface SfiNode {
  id: string;
  code: string;
  description: string;
  groupNumber: number;
  groupName: string;
}

interface SfiListResponse {
  items: SfiNode[];
  total: number;
}

function toDateInputValue(value: string | null): string {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function toAssetCodeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNamePrefix(name: string): string {
  const tokens = toAssetCodeToken(name).split("-").filter(Boolean);
  if (tokens.length === 0) return "AS";
  const ignored = new Set(["SYSTEM", "SYSTEMS", "EQUIPMENT", "UNIT", "GENERAL"]);
  const meaningful = tokens.filter(token => !ignored.has(token));
  if (meaningful.length >= 2) return `${meaningful[0][0]}${meaningful[1][0]}`.slice(0, 4);
  if (meaningful.length === 1) return meaningful[0].slice(0, 4);
  return tokens[0].slice(0, 4) || "AS";
}

function codePrefixFromExisting(assetCode: string): string {
  const normalized = toAssetCodeToken(assetCode);
  const match = normalized.match(/^([A-Z0-9]{2,8})-(\d{3,4})$/);
  if (match?.[1]) return match[1];
  const firstChunk = normalized.split("-").find(Boolean);
  return (firstChunk ?? "AS").slice(0, 8);
}

function nextSequentialAssetCode(prefix: string, existingCodes: Set<string>): string {
  const normalizedPrefix = toAssetCodeToken(prefix).slice(0, 8) || "AS";
  const matcher = new RegExp(`^${escapeRegExp(normalizedPrefix)}-(\\d{3,4})$`);
  let maxSeq = 0;

  for (const code of existingCodes) {
    const match = code.match(matcher);
    if (!match) continue;
    const seq = Number(match[1]);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }

  const next = maxSeq + 1;
  const width = next >= 1000 ? 4 : 3;
  return `${normalizedPrefix}-${String(next).padStart(width, "0")}`;
}

function suggestFromExistingCode(assetCode: string, existingCodes: Set<string>): string {
  return nextSequentialAssetCode(codePrefixFromExisting(assetCode), existingCodes);
}

function buildSuggestedAssetCode(name: string, existingCodes: Set<string>): string {
  return nextSequentialAssetCode(buildNamePrefix(name), existingCodes);
}

interface AssetModalProps {
  initial: Asset | null;
  vessels: Vessel[];
  sfiNodes: SfiNode[];
  sfiLoading: boolean;
  sfiError: string | null;
  tenantAssets: Asset[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface AssetNameOption {
  name: string;
  suggestedAssetCode: string;
}

const AssetModal: React.FC<AssetModalProps> = ({
  initial,
  vessels,
  sfiNodes,
  sfiLoading,
  sfiError,
  tenantAssets,
  isAdmin,
  onClose,
  onSaved,
}) => {
  const t = useT();
  const isEdit = Boolean(initial);

  const { data: assetDetail } = useFetch<Asset>(
    initial?.id ? `/app/pms/assets/${initial.id}` : null,
    [initial?.id ?? ""],
  );
  const currentHours = assetDetail?.currentHours ?? initial?.currentHours ?? null;

  const [vesselCode, setVesselCode] = useState(initial?.vesselCode ?? "");
  const [assetCode, setAssetCode] = useState(initial?.assetCode ?? "");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedSubgroup, setSelectedSubgroup] = useState("");
  const [name, setName] = useState(initial?.name ?? "");
  const [criticality, setCriticality] = useState(initial?.criticality ?? "B");
  const [status, setStatus] = useState(initial?.status ?? "OPERATIONAL");
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? "");
  const [trackDailyReport, setTrackDailyReport] = useState(initial?.trackDailyReport ?? false);
  const [installationDate, setInstallationDate] = useState(toDateInputValue(initial?.installationDate ?? null));
  const [lastOverhaulDate, setLastOverhaulDate] = useState(toDateInputValue(initial?.lastOverhaulDate ?? null));
  const [replacementDate, setReplacementDate] = useState(toDateInputValue(initial?.replacementDate ?? null));
  const [assetCodeTouched, setAssetCodeTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useCopilotEmitter({
    module: "ASSETS",
    screen: isEdit ? "ASSET_EDIT" : "ASSET_CREATE",
    entityId: initial?.id,
    entityCode: initial?.assetCode,
    vesselCode: vesselCode || initial?.vesselCode,
    canEdit: true,
    fieldValues: {
      assetCode:    assetCode    || null,
      name:         name         || null,
      criticality:  criticality  || null,
      status:       status       || null,
      manufacturer: manufacturer || null,
      model:        model        || null,
      serialNumber: serialNumber || null,
    },
  });

  const groupOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const node of sfiNodes) {
      if (!map.has(node.groupNumber)) map.set(node.groupNumber, node.groupName);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([groupNumber, groupName]) => ({ groupNumber, groupName }));
  }, [sfiNodes]);

  const subgroupOptions = useMemo(() => {
    if (!selectedGroup) {
      return [...sfiNodes].sort((a, b) => a.code.localeCompare(b.code));
    }
    const group = Number(selectedGroup);
    return sfiNodes
      .filter(node => node.groupNumber === group)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [selectedGroup, sfiNodes]);

  const nameOptions = useMemo<AssetNameOption[]>(() => {
    if (!selectedSubgroup) return [];

    const grouped = new Map<string, Map<string, number>>();
    for (const asset of tenantAssets) {
      if (asset.sfiCode !== selectedSubgroup) continue;
      const normalizedName = asset.name.trim();
      const normalizedCode = asset.assetCode.trim().toUpperCase();
      if (!normalizedName || !normalizedCode) continue;
      const codes = grouped.get(normalizedName) ?? new Map<string, number>();
      codes.set(normalizedCode, (codes.get(normalizedCode) ?? 0) + 1);
      grouped.set(normalizedName, codes);
    }

    const options = [...grouped.entries()].map(([normalizedName, codes]) => {
      const sortedCodes = [...codes.entries()].sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });
      return {
        name: normalizedName,
        suggestedAssetCode: sortedCodes[0]?.[0] ?? "",
      };
    });

    if (initial?.name?.trim() && initial?.assetCode?.trim()) {
      const existing = options.find(option => option.name === initial.name.trim());
      if (!existing) {
        options.push({
          name: initial.name.trim(),
          suggestedAssetCode: initial.assetCode.trim().toUpperCase(),
        });
      }
    }

    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, [initial?.assetCode, initial?.name, selectedSubgroup, tenantAssets]);

  const selectedNameOption = useMemo(() => {
    const normalized = name.trim().toLocaleLowerCase();
    if (!normalized) return null;
    return (
      nameOptions.find(option => option.name.trim().toLocaleLowerCase() === normalized) ?? null
    );
  }, [name, nameOptions]);

  const existingCodesForSelectedVessel = useMemo(() => {
    const vessel = vesselCode.trim().toUpperCase();
    const set = new Set<string>();
    if (!vessel) return set;
    for (const asset of tenantAssets) {
      if (asset.vesselCode.trim().toUpperCase() !== vessel) continue;
      if (isEdit && initial?.id && asset.id === initial.id) continue;
      const normalized = toAssetCodeToken(asset.assetCode);
      if (normalized) set.add(normalized);
    }
    return set;
  }, [initial?.id, isEdit, tenantAssets, vesselCode]);

  useEffect(() => {
    setVesselCode(initial?.vesselCode ?? "");
    setAssetCode(initial?.assetCode ?? "");
    setName(initial?.name ?? "");
    setCriticality(initial?.criticality ?? "B");
    setStatus(initial?.status ?? "OPERATIONAL");
    setTrackDailyReport(initial?.trackDailyReport ?? false);
    setManufacturer(initial?.manufacturer ?? "");
    setModel(initial?.model ?? "");
    setSerialNumber(initial?.serialNumber ?? "");
    setInstallationDate(toDateInputValue(initial?.installationDate ?? null));
    setLastOverhaulDate(toDateInputValue(initial?.lastOverhaulDate ?? null));
    setReplacementDate(toDateInputValue(initial?.replacementDate ?? null));
    setAssetCodeTouched(false);
    setActionError(null);

    const existingSfi = initial?.sfiCode ?? "";
    if (!existingSfi) {
      setSelectedGroup("");
      setSelectedSubgroup("");
      return;
    }
    const node = sfiNodes.find(item => item.code === existingSfi);
    setSelectedSubgroup(existingSfi);
    setSelectedGroup(node ? String(node.groupNumber) : "");
  }, [initial, sfiNodes]);

  const onGroupChanged = useCallback((groupValue: string) => {
    setSelectedGroup(groupValue);
    setSelectedSubgroup("");
    if (!isEdit) {
      setName("");
      setAssetCode("");
      setAssetCodeTouched(false);
    }
  }, [isEdit]);

  const onSubgroupChanged = useCallback((subgroupCode: string) => {
    setSelectedSubgroup(subgroupCode);
    const node = sfiNodes.find(item => item.code === subgroupCode);
    if (node) setSelectedGroup(String(node.groupNumber));
    if (!isEdit) {
      setName("");
      setAssetCode("");
      setAssetCodeTouched(false);
    }
  }, [isEdit, sfiNodes]);

  const onNameChanged = useCallback((nextName: string) => {
    setName(nextName);
    if (isEdit) return;
    const normalized = nextName.trim().toLocaleLowerCase();
    const selected = normalized
      ? nameOptions.find(option => option.name.trim().toLocaleLowerCase() === normalized)
      : null;
    if (!normalized) {
      setAssetCode("");
      setAssetCodeTouched(false);
      return;
    }

    if (selected?.suggestedAssetCode) {
      const uniqueFromExisting = suggestFromExistingCode(selected.suggestedAssetCode, existingCodesForSelectedVessel);
      setAssetCode(uniqueFromExisting);
      setAssetCodeTouched(false);
      return;
    }

    const suggested = buildSuggestedAssetCode(nextName, existingCodesForSelectedVessel);
    setAssetCode(suggested);
    setAssetCodeTouched(false);
  }, [existingCodesForSelectedVessel, isEdit, nameOptions]);

  useEffect(() => {
    if (isEdit) return;
    if (!selectedSubgroup) return;
    if (!name.trim()) return;
    if (assetCodeTouched && assetCode.trim()) return;

    const normalized = name.trim().toLocaleLowerCase();
    const selected = nameOptions.find(option => option.name.trim().toLocaleLowerCase() === normalized);
    if (selected?.suggestedAssetCode) {
      setAssetCode(suggestFromExistingCode(selected.suggestedAssetCode, existingCodesForSelectedVessel));
      return;
    }
    setAssetCode(buildSuggestedAssetCode(name, existingCodesForSelectedVessel));
  }, [
    assetCode,
    assetCodeTouched,
    existingCodesForSelectedVessel,
    isEdit,
    name,
    nameOptions,
  ]);

  const onSave = useCallback(async () => {
    if (!vesselCode.trim() && !isEdit) {
      setActionError("Vessel es requerido.");
      return;
    }
    if (!assetCode.trim() && !isEdit) {
      setActionError("Asset Code es requerido.");
      return;
    }
    if (!selectedGroup) {
      setActionError(t("mp.selectSfiGroupRequired"));
      return;
    }
    if (!selectedSubgroup) {
      setActionError(t("mp.selectSfiSubgroupRequired"));
      return;
    }
    if (!name.trim()) {
      setActionError("Debe seleccionar o indicar el nombre del asset.");
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const vesselUpper = vesselCode.trim().toUpperCase();
      const codeUpper = assetCode.trim().toUpperCase();
      if (!isEdit) {
        const duplicated = tenantAssets.some(asset =>
          asset.vesselCode.trim().toUpperCase() === vesselUpper &&
          asset.assetCode.trim().toUpperCase() === codeUpper,
        );
        if (duplicated) {
          setActionError("Asset Code ya existe para este vessel. Se requiere uno único.");
          setSaving(false);
          return;
        }
      }

      const payload = {
        name: name.trim(),
        sfiCode: selectedSubgroup,
        criticality,
        status,
        trackDailyReport,
        manufacturer: normalizeOptionalText(manufacturer),
        model: normalizeOptionalText(model),
        serialNumber: normalizeOptionalText(serialNumber),
        installationDate: installationDate || null,
        lastOverhaulDate: lastOverhaulDate || null,
        replacementDate: replacementDate || null,
      };

      if (isEdit && initial) {
        await api.patch(`/app/pms/assets/${initial.id}`, {
          ...payload,
          ...(isAdmin ? { vesselCode: vesselUpper, assetCode: codeUpper } : {}),
        });
      } else {
        await api.post("/app/pms/assets", {
          vesselCode: vesselUpper,
          assetCode: codeUpper,
          ...payload,
        });
      }
      onSaved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }, [
    assetCode,
    criticality,
    initial,
    installationDate,
    isEdit,
    lastOverhaulDate,
    manufacturer,
    model,
    name,
    onSaved,
    replacementDate,
    selectedGroup,
    selectedSubgroup,
    serialNumber,
    status,
    t,
    tenantAssets,
    trackDailyReport,
    vesselCode,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{isEdit ? "Editar Asset" : "Nuevo Asset"}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white transition-colors" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Vessels</label>
              <select
                value={vesselCode}
                onChange={e => setVesselCode(e.target.value)}
                disabled={isEdit && !isAdmin}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50 disabled:opacity-60"
              >
                <option value="">Seleccionar vessel</option>
                {vessels.map(vessel => (
                  <option key={vessel.id} value={vessel.code}>
                    {vessel.code} - {vessel.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Asset Code</label>
              <input
                value={assetCode}
                onChange={e => {
                  setAssetCode(e.target.value.toUpperCase());
                  setAssetCodeTouched(true);
                }}
                disabled={(isEdit && !isAdmin) || (!isEdit && Boolean(selectedNameOption))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("mp.sfiGroup")}</label>
              <select
                value={selectedGroup}
                onChange={e => onGroupChanged(e.target.value)}
                disabled={sfiLoading || Boolean(sfiError)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50"
              >
                <option value="">
                  {sfiLoading ? t("mp.loadingSfiGroups") : t("mp.selectSfiGroup")}
                </option>
                {groupOptions.map(group => (
                  <option key={group.groupNumber} value={String(group.groupNumber)}>
                    {group.groupNumber} - {t(`sfi.g.${group.groupNumber}` as Parameters<typeof t>[0]) || group.groupName}
                  </option>
                ))}
              </select>
              {sfiError && (
                <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                  {t("mp.errorLoadingSfi")}{sfiError}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("mp.sfiSubgroup")}</label>
              <select
                value={selectedSubgroup}
                onChange={e => onSubgroupChanged(e.target.value)}
                disabled={sfiLoading || Boolean(sfiError)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50 disabled:opacity-60"
              >
                <option value="">{t("mp.selectSfiSubgroup")}</option>
                {subgroupOptions.map(node => (
                  <option key={node.id} value={node.code}>
                    {node.code} - {t(`sfi.c.${node.code}` as Parameters<typeof t>[0]) || node.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">
                {t("col.name")}
              </label>
              {nameOptions.length > 0 && (
                <select
                  value={selectedNameOption?.name ?? ""}
                  onChange={e => onNameChanged(e.target.value)}
                  disabled={!selectedSubgroup}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50 disabled:opacity-60"
                >
                  <option value="">Seleccionar nombre existente</option>
                  {nameOptions.map(option => (
                    <option key={`${option.name}-${option.suggestedAssetCode}`} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={name}
                onChange={e => onNameChanged(e.target.value)}
                disabled={!selectedSubgroup}
                placeholder={nameOptions.length > 0 ? "Seleccionar y luego editar nombre del asset" : "No hay nombre previo para este SFI. Ingresar nuevo."}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.criticality")}</label>
              <select
                value={criticality}
                onChange={e => setCriticality(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50"
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.status")}</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50"
              >
                <option value="OPERATIONAL">OPERATIONAL</option>
                <option value="DEGRADED">DEGRADED</option>
                <option value="OUT_OF_SERVICE">OUT_OF_SERVICE</option>
              </select>
            </div>
            <label className="flex items-center gap-3 bg-white/3 border border-white/8 rounded-xl px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors">
              <input
                type="checkbox"
                checked={trackDailyReport}
                onChange={e => setTrackDailyReport(e.target.checked)}
                className="w-4 h-4 rounded accent-accent shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium">Reporte diario</p>
                <p className="text-xs text-text-industrial/50">Incluir en horas de equipo del reporte diario</p>
              </div>
              {currentHours != null && (
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-text-industrial/40 uppercase tracking-wider">Hs. acumuladas</p>
                  <p className="font-mono text-base font-bold text-accent leading-tight">{Number(currentHours).toLocaleString()}h</p>
                </div>
              )}
            </label>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.manufacturer")}</label>
              <input
                value={manufacturer}
                onChange={e => setManufacturer(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{t("col.model")}</label>
              <input
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Serial</label>
              <input
                value={serialNumber}
                onChange={e => setSerialNumber(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Installation</label>
              <input
                type="date"
                value={installationDate}
                onChange={e => setInstallationDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Last Overhaul</label>
              <input
                type="date"
                value={lastOverhaulDate}
                onChange={e => setLastOverhaulDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">Replacement</label>
              <input
                type="date"
                value={replacementDate}
                onChange={e => setReplacementDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-text-industrial/30 focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onSave(); }} disabled={saving} className="px-4 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeleteAssetModalProps {
  asset: Asset;
  onClose: () => void;
  onDeleted: () => void;
}

const DeleteAssetModal: React.FC<DeleteAssetModalProps> = ({ asset, onClose, onDeleted }) => {
  const t = useT();
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onDelete = useCallback(async () => {
    setDeleting(true);
    setActionError(null);
    try {
      await api.delete(`/app/pms/assets/${asset.id}`);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.deleteError"));
      setDeleting(false);
    }
  }, [asset.id, onDeleted, t]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">{t("common.delete")}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-text-industrial/40 hover:text-white transition-colors" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-text-industrial/70">
            ¿Eliminar asset <span className="text-white font-semibold">{asset.assetCode}</span> ({asset.name})?
          </p>
          {actionError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{actionError}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial hover:text-white transition-colors">{t("common.cancel")}</button>
          <button onClick={() => { void onDelete(); }} disabled={deleting} className="px-4 py-2 rounded-xl bg-red-500/80 text-white font-bold text-xs hover:bg-red-500 disabled:opacity-50 transition-all">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
};

export const AssetsPage: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExcel, setShowExcel] = useState(false);
  const [editing, setEditing] = useState<Asset | null | undefined>(undefined);

  useCopilotEmitter(editing === undefined ? { module: "ASSETS", screen: "ASSET_LIST" } : null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const statusFilter = (searchParams.get("status") ?? "").trim();
  const criticalityFilter = (searchParams.get("criticality") ?? "").trim();
  const vesselFilter = (searchParams.get("vesselCode") ?? "").trim();
  const [vesselInput, setVesselInput] = useState(vesselFilter);

  useEffect(() => {
    setVesselInput(vesselFilter);
  }, [vesselFilter]);

  const updateFilters = useCallback((next: { status?: string; criticality?: string; vesselCode?: string }) => {
    const params = new URLSearchParams(searchParams);
    const nextStatus = next.status !== undefined ? next.status : statusFilter;
    const nextCriticality = next.criticality !== undefined ? next.criticality : criticalityFilter;
    const nextVessel = next.vesselCode !== undefined ? next.vesselCode : vesselFilter;
    if (nextStatus) params.set("status", nextStatus); else params.delete("status");
    if (nextCriticality) params.set("criticality", nextCriticality); else params.delete("criticality");
    if (nextVessel) params.set("vesselCode", nextVessel); else params.delete("vesselCode");
    setSearchParams(params, { replace: true });
  }, [criticalityFilter, searchParams, setSearchParams, statusFilter, vesselFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (criticalityFilter) params.set("criticality", criticalityFilter);
    if (vesselFilter) params.set("vesselCode", vesselFilter);
    const query = params.toString();
    return `/app/pms/assets${query ? `?${query}` : ""}`;
  }, [criticalityFilter, statusFilter, vesselFilter]);

  const { data, loading, error, reload } = useFetch<ListResponse>(path, [path]);
  const { data: vesselsData } = useFetch<VesselListResponse>("/app/vessels", ["/app/vessels"]);
  const { data: sfiData, loading: sfiLoading, error: sfiError } = useFetch<SfiListResponse>("/app/pms/sfi", ["/app/pms/sfi"]);
  const { data: tenantAssetsData, reload: reloadTenantAssets } = useFetch<ListResponse>("/app/pms/assets", ["/app/pms/assets"]);

  const openEdit = useCallback(async (row: Asset) => {
    setDetailLoadingId(row.id);
    try {
      const detailed = await api.get<Asset>(`/app/pms/assets/${row.id}`);
      setEditing(detailed);
    } catch {
      setEditing(row);
    } finally {
      setDetailLoadingId(null);
    }
  }, []);

  const onDeleteRequested = useCallback((row: Asset) => {
    setDeleteTarget(row);
  }, []);

  const onDeleted = useCallback(() => {
    setDeleteTarget(null);
    void reload();
    void reloadTenantAssets();
  }, [reload, reloadTenantAssets]);

  const columns: Column<Asset>[] = useMemo(() => [
    { key: "assetCode", header: t("col.code"), render: row => <span className="font-mono font-bold text-white text-xs">{row.assetCode}</span> },
    { key: "name", header: t("col.name"), render: row => <span className="font-medium text-white line-clamp-1">{row.name}</span> },
    { key: "vesselCode", header: t("col.vessel"), render: row => <span className="font-mono text-accent text-xs">{row.vesselCode}</span> },
    { key: "sfiCode", header: t("col.sfiCode"), render: row => row.sfiCode ?? "—" },
    { key: "criticality", header: t("col.criticality"), render: row => row.criticality },
    { key: "status", header: t("col.status"), render: row => <StatusBadge status={row.status} /> },
    { key: "manufacturer", header: t("col.manufacturer"), render: row => row.manufacturer ?? "—" },
    { key: "model", header: t("col.model"), render: row => row.model ?? "—" },
    { key: "createdAt", header: t("col.createdAt"), render: row => fmtDate(row.createdAt) },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: row => (
        <button
          onClick={e => {
            e.stopPropagation();
            onDeleteRequested(row);
          }}
          className="p-1.5 rounded-lg text-text-industrial/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title={t("common.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ], [onDeleteRequested, t]);

  return (
    <div className="space-y-5">
      {showExcel && <ExcelPanel module="assets" onClose={() => { setShowExcel(false); reload(); }} />}
      {editing !== undefined && (
        <AssetModal
          initial={editing}
          vessels={vesselsData?.items ?? []}
          sfiNodes={sfiData?.items ?? []}
          sfiLoading={sfiLoading}
          sfiError={sfiError}
          tenantAssets={tenantAssetsData?.items ?? []}
          isAdmin={isAdmin}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void reload();
            void reloadTenantAssets();
          }}
        />
      )}
      {deleteTarget && <DeleteAssetModal asset={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={onDeleted} />}
      <PageHeader icon={Settings} title={t("page.assets")} total={data?.total} onReload={reload}>
        <button onClick={() => setEditing(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all">
          <Plus className="w-3.5 h-3.5" /> {t("common.new")}
        </button>
        <button onClick={() => setShowExcel(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> Excel
        </button>
        <select value={toFilterSelectValue(statusFilter)} onChange={e => updateFilters({ status: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="OPERATIONAL">OPERATIONAL</option>
          <option value="DEGRADED">DEGRADED</option>
          <option value="OUT_OF_SERVICE">OUT_OF_SERVICE</option>
        </select>
        <select value={toFilterSelectValue(criticalityFilter)} onChange={e => updateFilters({ criticality: fromFilterSelectValue(e.target.value) })} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial focus:outline-none focus:border-accent/50">
          <option value={FILTER_ALL_VALUE}>{t("status.all")}</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
        <div className="flex items-center gap-2">
          <input value={vesselInput} onChange={e => setVesselInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") updateFilters({ vesselCode: vesselInput.trim() }); }} placeholder={t("common.filterByVessel")} className="w-44 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-industrial placeholder-text-industrial/30 focus:outline-none focus:border-accent/50" />
          <button onClick={() => updateFilters({ vesselCode: vesselInput.trim() })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all">{t("common.apply")}</button>
          {(statusFilter || criticalityFilter || vesselFilter) && (
            <button onClick={() => updateFilters({ status: "", criticality: "", vesselCode: "" })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial/80 hover:text-white hover:border-red-400/40 transition-all">{t("common.clear")}</button>
          )}
        </div>
      </PageHeader>

      {detailLoadingId && <div className="flex items-center gap-2 text-xs text-text-industrial/60"><Loader2 className="w-4 h-4 animate-spin text-accent" />Cargando detalle del asset...</div>}
      <DataTable columns={columns} data={data?.items ?? null} loading={loading} error={error} keyFn={row => row.id} emptyText={t("empty.assets")} onRowClick={row => { void openEdit(row); }} />
    </div>
  );
};
