// Asesor técnico — pantalla exclusiva del Director de Mantenimiento
// (admin con la marca en Equipo). Preview V2 aprobada el 19/09/2026.
//
// Pensada para entenderse de un vistazo:
//   - Arriba: lo más importante hoy, 4 semáforos y los buques que preocupan.
//   - Abajo: lista de temas por "para cuándo". Cada tema se abre con un solo
//     botón y muestra 3 pasos: Qué pasa → Qué hacer → Actuar.
// El buque es el del encabezado. Sin buque elegido se pide elegir uno, o un
// grupo entero (todas las barcazas juntas, ?grupo=barcazas).
//
// El análisis lo arma el servidor (maintenance-advisor-service.ts): el código
// junta los registros reales y la IA los analiza. Los semáforos, los buckets y
// los buques de cada tema salen de datos del sistema, no del texto de la IA.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Compass, Loader2, RefreshCw, ChevronRight, ChevronDown, History, Ship } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { fmtDate } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { AlertDialog } from "../components/AlertDialog";
import { CreateWorkOrderModal } from "../components/CreateWorkOrderModal";
import { useCopilotEmitter } from "../lib/copilot-context";
import { useVesselContext } from "../lib/vessel-context";
import { EvidenceList, DraftPanel, FollowPanel, TalkBox } from "../components/maintenance-advisor/AdvisorParts";
import {
  AREAS, AREA_ICON, AREA_LABEL, BUCKETS, BUCKET_ICON, BUCKET_LABEL, BUCKET_OF, BUCKET_STYLE, HEALTH_LABEL, HEALTH_STYLE,
  areaHealth, currentPlan, dueBadge, findingAreas, findingEvidence, findingVesselCodes,
  type AdvisorAction, type AdvisorFinding, type AdvisorMessage, type AdvisorMetrics, type Area, type Bucket, type EvidenceItem,
} from "../components/maintenance-advisor/advisor-types";

interface AdvisorReport {
  id: string;
  createdAt: string;
  vesselCodes: string[];
  metrics: AdvisorMetrics;
  summary: { whatNeedsAttentionNow: string };
  findings: AdvisorFinding[];
  insufficient: Array<{ topic: string; missingData: string }>;
  evidence: EvidenceItem[];
}

interface ReportListItem { id: string; createdAt: string; findings: number }

type Tab = "todo" | "follow";

/** Barcaza = el tipo de buque la nombra (mismo criterio que el servidor). */
const isBargeType = (vesselType: string | null | undefined) =>
  !!vesselType && vesselType.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes("BARCAZA");

const whenText = (iso: string, t: ReturnType<typeof useT>) => {
  const d = new Date(iso);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? `${t("advisor.today")} ${hhmm}` : `${fmtDate(iso)} ${hhmm}`;
};

// ─── Página ──────────────────────────────────────────────────────────────────

export const MaintenanceAdvisorPage: React.FC = () => {
  const t = useT();
  const { selectedVesselCode, setSelectedVesselCode, vessels } = useVesselContext();
  // Además de un buque, un grupo entero (hoy: todas las barcazas). Va en la URL
  // (?grupo=barcazas) para que recargar o compartir el link deje lo mismo. Si
  // se elige un buque en el encabezado, manda el buque.
  const [searchParams, setSearchParams] = useSearchParams();
  const barges = useMemo(() => vessels.filter(v => isBargeType(v.vesselType)), [vessels]);
  const group: "BARGES" | null = !selectedVesselCode && searchParams.get("grupo") === "barcazas" && barges.length > 0 ? "BARGES" : null;
  const setGroup = useCallback((g: "BARGES" | null) => {
    const next = new URLSearchParams(searchParams);
    if (g) next.set("grupo", "barcazas"); else next.delete("grupo");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const scopeName = selectedVesselCode
    ? vessels.find(v => v.code === selectedVesselCode)?.name ?? selectedVesselCode
    : group ? t("advisor.group.barges").replace("{n}", String(barges.length)) : t("advisor.scope.fleet");
  const vesselName = useCallback((code: string) => vessels.find(v => v.code === code)?.name ?? code, [vessels]);

  const [reports, setReports] = useState<ReportListItem[] | null>(null);
  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("todo");
  const [areaFilter, setAreaFilter] = useState<Area | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actions, setActions] = useState<AdvisorAction[]>([]);
  const [woFor, setWoFor] = useState<{ vesselCode?: string; title: string; priority: string } | null>(null);
  // Conversación del Director con el asesor, de todos los temas del informe abierto.
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const mergeMessages = useCallback((items: AdvisorMessage[]) => {
    setMessages(prev => {
      const byId = new Map(prev.map(m => [m.id, m]));
      for (const m of items) byId.set(m.id, m);
      return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  useCopilotEmitter({ module: "MAINTENANCE_ADVISOR", screen: "ADVISOR_DASHBOARD", entityId: report?.id, vesselCode: selectedVesselCode ?? undefined });

  const scopeQs = selectedVesselCode ? `vesselCode=${encodeURIComponent(selectedVesselCode)}` : group ? `group=${group}` : "";

  const openReport = useCallback(async (id: string) => {
    const r = await api.get<AdvisorReport>(`/app/maintenance-advisor/reports/${encodeURIComponent(id)}`);
    setReport(r);
    setMessages([]);
    api.get<{ items: AdvisorMessage[] }>(`/app/maintenance-advisor/reports/${encodeURIComponent(id)}/messages`)
      .then(m => setMessages(m.items))
      .catch(() => { /* sin charla previa visible; al escribir se informa el error */ });
    const first = [...r.findings].sort((a, b) => BUCKETS.indexOf(BUCKET_OF[a.priority]) - BUCKETS.indexOf(BUCKET_OF[b.priority]))[0];
    setOpenKey(first?.key ?? null);
  }, []);

  // El buque del encabezado manda: al cambiarlo se carga su último análisis.
  const load = useCallback(async () => {
    setLoading(true); setReport(null); setAreaFilter(null);
    try {
      const list = await api.get<{ items: ReportListItem[] }>(`/app/maintenance-advisor/reports${scopeQs ? `?${scopeQs}` : ""}`);
      setReports(list.items);
      if (list.items[0]) await openReport(list.items[0].id);
    } catch (err) {
      setReports([]);
      setAlert(err instanceof ApiError ? err.message : t("advisor.error.generic"));
    } finally {
      setLoading(false);
    }
  }, [scopeQs, openReport, t]);

  const loadActions = useCallback(async () => {
    try {
      const r = await api.get<{ items: AdvisorAction[] }>(`/app/maintenance-advisor/actions?status=ACTIVE${scopeQs ? `&${scopeQs}` : ""}`);
      setActions(r.items);
    } catch { /* la pestaña queda vacía; el error real aparece al operar */ }
  }, [scopeQs]);

  // Elegir un buque (en el encabezado o tocando su barra) deja el grupo atrás.
  useEffect(() => {
    if (selectedVesselCode && searchParams.get("grupo")) setGroup(null);
  }, [selectedVesselCode, searchParams, setGroup]);

  // El asesor trabaja de a un buque o un grupo: con "Todos los buques" y sin
  // grupo no se carga nada (se pide elegir).
  useEffect(() => {
    if (!selectedVesselCode && !group) { setReport(null); setReports(null); setActions([]); setLoading(false); return; }
    void load(); void loadActions();
  }, [selectedVesselCode, group, load, loadActions]);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api.post<{ id: string }>("/app/maintenance-advisor/reports", group ? { group } : { vesselCode: selectedVesselCode ?? null });
      const list = await api.get<{ items: ReportListItem[] }>(`/app/maintenance-advisor/reports${scopeQs ? `?${scopeQs}` : ""}`);
      setReports(list.items);
      await openReport(r.id);
      setTab("todo");
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("advisor.error.generic"));
    } finally {
      setGenerating(false);
    }
  };

  // ── Datos derivados ──
  const evidence = useMemo(() => report?.evidence ?? [], [report]);
  const followedKeys = useMemo(() => new Set(actions.filter(a => a.reportId === report?.id && a.findingKey).map(a => a.findingKey!)), [actions, report]);
  const visibleFindings = useMemo(() => (report?.findings ?? []).filter(f => !areaFilter || findingAreas(f, evidence).has(areaFilter)), [report, areaFilter, evidence]);
  const bucketCount = useMemo(() => {
    const c: Record<Bucket, number> = { today: 0, week: 0, month: 0, later: 0 };
    for (const f of report?.findings ?? []) c[BUCKET_OF[f.priority]] += 1;
    return c;
  }, [report]);
  const health = report ? areaHealth(report.metrics) : null;

  // Modo grupo: qué barcazas preocupan más (temas por buque, por "para cuándo").
  const shipBars = useMemo(() => {
    const map = new Map<string, Record<Bucket, number>>();
    for (const f of report?.findings ?? []) {
      for (const code of findingVesselCodes(f, evidence)) {
        const row = map.get(code) ?? { today: 0, week: 0, month: 0, later: 0 };
        row[BUCKET_OF[f.priority]] += 1;
        map.set(code, row);
      }
    }
    const rows = Array.from(map, ([code, c]) => ({ code, c, total: c.today + c.week + c.month + c.later }));
    rows.sort((a, b) => b.c.today - a.c.today || b.c.week - a.c.week || b.total - a.total);
    return rows.slice(0, 8);
  }, [report, evidence]);
  const maxBar = Math.max(1, ...shipBars.map(r => r.total));

  // Buques del encabezado agrupados por tipo, para elegir uno de un toque.
  const vesselGroups = useMemo(() => {
    const groups = new Map<string, typeof vessels>();
    for (const v of vessels) {
      const key = v.vesselType?.trim() || "";
      groups.set(key, [...(groups.get(key) ?? []), v]);
    }
    return Array.from(groups, ([type, list]) => ({ type, list: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => (Number(!a.type) - Number(!b.type)) || a.type.localeCompare(b.type));
  }, [vessels]);

  if (!selectedVesselCode && !group) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
        <PageHeader icon={Compass} title={t("advisor.title")} />
        <div className="rounded-2xl border border-fg/10 bg-surface p-6 md:p-8">
          <div className="text-center space-y-2 mb-6">
            <Ship className="w-9 h-9 mx-auto text-violet-600" />
            <p className="text-lg font-extrabold text-fg">{t("advisor.pick.title")}</p>
            <p className="text-sm text-text-industrial/70 max-w-lg mx-auto">{t("advisor.pick.body")}</p>
          </div>
          <div className="space-y-4 max-w-4xl mx-auto">
            {barges.length > 1 && (
              <button onClick={() => setGroup("BARGES")}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border-[1.5px] border-violet-400 bg-violet-500/5 px-4 py-3 text-[14px] font-extrabold text-violet-800 dark:text-violet-200 hover:bg-violet-500/10">
                🛳️ {t("advisor.group.analyzeBarges").replace("{n}", String(barges.length))}
              </button>
            )}
            {vesselGroups.map(g => (
              <div key={g.type || "_"}>
                <p className="mb-2 text-[11.5px] font-extrabold uppercase tracking-wider text-text-industrial/60">{g.type || t("advisor.pick.other")}</p>
                <div className="flex flex-wrap gap-2">
                  {g.list.map(v => (
                    <button key={v.code} onClick={() => setSelectedVesselCode(v.code)}
                      className="rounded-xl border-[1.5px] border-fg/15 bg-surface px-3.5 py-2 text-[13px] font-extrabold text-fg hover:border-violet-500 hover:bg-violet-500/5">
                      🚢 {v.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <PageHeader icon={Compass} title={t("advisor.title")}>
        <button onClick={() => { void generate(); }} disabled={generating}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 bg-violet-700 text-white text-sm font-extrabold hover:bg-violet-800 disabled:opacity-60">
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {t(generating ? "advisor.refreshing" : "advisor.refresh")}
        </button>
      </PageHeader>

      {/* Alcance + análisis anteriores */}
      <div className="relative -mt-2 text-[13px] text-text-industrial/70 flex flex-wrap items-center gap-x-2">
        <b className="text-fg">{scopeName}</b>
        {group && (
          <button className="font-bold text-blue-700 dark:text-blue-400 hover:underline" onClick={() => setGroup(null)}>· {t("advisor.group.change")}</button>
        )}
        {report && <span>· {t("advisor.analyzedAt").replace("{when}", whenText(report.createdAt, t))}</span>}
        {reports && reports.length > 1 && (
          <button className="inline-flex items-center gap-1 font-bold text-blue-700 dark:text-blue-400 hover:underline" onClick={() => setHistoryOpen(o => !o)}>
            · <History className="w-3.5 h-3.5" /> {t("advisor.history")} <ChevronDown className="w-3 h-3" />
          </button>
        )}
        {historyOpen && reports && (
          <div className="absolute top-6 left-0 z-20 min-w-[240px] bg-surface border border-fg/10 rounded-xl shadow-xl p-1.5">
            {reports.map(r => (
              <button key={r.id} onClick={() => { setHistoryOpen(false); void openReport(r.id); }}
                className={`block w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-fg/5 ${r.id === report?.id ? "font-bold text-fg" : ""}`}>
                {whenText(r.createdAt, t)} · {t("advisor.historyItem").replace("{n}", String(r.findings))}
              </button>
            ))}
          </div>
        )}
      </div>

      {generating && (
        <div className="flex items-center gap-3 rounded-2xl border border-violet-400/40 bg-violet-500/5 px-4 py-3 text-sm text-fg">
          <Loader2 className="w-4 h-4 animate-spin text-violet-600" /> {t("advisor.generatingDetail").replace("{scope}", scopeName)}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-industrial/60 py-12 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}</div>
      ) : !report ? (
        <div className="rounded-2xl border border-dashed border-fg/20 bg-surface p-10 text-center space-y-3">
          <Compass className="w-9 h-9 mx-auto text-violet-600" />
          <p className="text-base font-extrabold text-fg">{t("advisor.empty.title").replace("{scope}", scopeName)}</p>
          <p className="text-sm text-text-industrial/70 max-w-lg mx-auto">{t("advisor.empty.body")}</p>
          {!generating && (
            <button onClick={() => { void generate(); }} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 bg-violet-700 text-white text-sm font-extrabold hover:bg-violet-800">
              <RefreshCw className="w-4 h-4" /> {t("advisor.empty.cta")}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ═══ De un vistazo ═══ */}
          <div className={`grid gap-3 grid-cols-1 ${group ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
            <Card title={t("advisor.card.today")} ai>
              <p className="text-[17px] font-extrabold text-fg leading-snug">{report.summary.whatNeedsAttentionNow || "—"}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {BUCKETS.filter(b => b !== "later" || bucketCount.later > 0).map(b => (
                  <span key={b} className={`inline-flex items-center gap-2 rounded-xl border-[1.5px] px-3 py-1.5 text-[13px] font-extrabold ${BUCKET_STYLE[b].pill}`}>
                    <span className="text-xl font-black leading-none">{bucketCount[b]}</span> {t(BUCKET_LABEL[b]).toLowerCase()}
                  </span>
                ))}
              </div>
            </Card>

            <Card title={t(group ? "advisor.card.healthBarges" : "advisor.card.healthVessel")}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {health && AREAS.map(area => {
                  const h = health[area];
                  const active = areaFilter === area;
                  return (
                    <button key={area} onClick={() => { setAreaFilter(active ? null : area); setTab("todo"); }}
                      className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${active ? "border-fg ring-2 ring-fg/10" : "border-fg/10 hover:border-fg/25"}`}>
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 ${HEALTH_STYLE[h.health].dot}`} aria-hidden>{AREA_ICON[area]}</span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-extrabold text-fg leading-tight">{t(AREA_LABEL[area])}</span>
                        <span className="block text-[11.5px] text-text-industrial/70 leading-tight mt-0.5">
                          <b className={HEALTH_STYLE[h.health].word}>{t(HEALTH_LABEL[h.health])}</b> · {t(h.text).replace("{n}", String(h.n ?? ""))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {group && (
              <Card title={t("advisor.card.ships")}>
                {shipBars.length === 0 ? (
                  <p className="text-sm text-text-industrial/60">{t("advisor.ships.none")}</p>
                ) : (
                  <div className="space-y-2">
                    {shipBars.map(row => (
                      <button key={row.code} onClick={() => setSelectedVesselCode(row.code)} title={t("advisor.ships.pick")}
                        className="grid grid-cols-[110px_1fr_20px] gap-2 items-center w-full text-left text-[12.5px] hover:opacity-80">
                        <span className="font-extrabold text-fg truncate">{vesselName(row.code)}</span>
                        <span className="h-3.5 rounded-full bg-fg/5 flex overflow-hidden">
                          {BUCKETS.map(b => row.c[b] > 0 && (
                            <i key={b} className={`block h-full ${BUCKET_STYLE[b].bar}`} style={{ width: `${(row.c[b] / maxBar) * 100}%` }} />
                          ))}
                        </span>
                        <span className="font-extrabold text-text-industrial/70 text-right">{row.total}</span>
                      </button>
                    ))}
                    <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-text-industrial/60">
                      {BUCKETS.filter(b => b !== "later").map(b => (
                        <span key={b} className="inline-flex items-center gap-1"><i className={`inline-block w-2.5 h-2.5 rounded-sm ${BUCKET_STYLE[b].bar}`} />{t(BUCKET_LABEL[b]).toLowerCase()}</span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* ═══ Pestañas ═══ */}
          <div className="inline-flex bg-fg/10 rounded-xl p-1 gap-1">
            {([["todo", "advisor.tab.todo", report.findings.length], ["follow", "advisor.tab.follow", actions.length]] as const).map(([key, label, n]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-4 py-2 rounded-lg text-[13px] font-extrabold ${tab === key ? "bg-surface text-fg shadow-sm" : "text-text-industrial/70 hover:text-fg"}`}>
                {t(label)} <span className="ml-1 text-[11px] bg-fg/10 rounded-full px-1.5">{n}</span>
              </button>
            ))}
          </div>

          {tab === "todo" && (
            <section className="space-y-4">
              {areaFilter && (
                <p className="flex items-center gap-2 text-[13px] text-text-industrial/70">
                  {t("advisor.filtering")} <b className="text-fg">{t(AREA_LABEL[areaFilter])}</b>
                  <button className="rounded-full border border-fg/15 bg-surface px-2.5 py-0.5 text-[12px] font-bold hover:bg-fg/5" onClick={() => setAreaFilter(null)}>✕ {t("advisor.showAll")}</button>
                </p>
              )}
              {visibleFindings.length === 0 && (
                <p className="rounded-2xl border border-dashed border-fg/20 p-8 text-center text-sm text-text-industrial/70">{t("advisor.noTopics")}</p>
              )}
              {BUCKETS.map(bucket => {
                const list = visibleFindings.filter(f => BUCKET_OF[f.priority] === bucket);
                if (list.length === 0) return null;
                return (
                  <div key={bucket}>
                    <p className="flex items-center gap-2 mb-2 text-[13.5px] font-black text-fg">
                      {BUCKET_ICON[bucket]} {t(BUCKET_LABEL[bucket])}
                      <span className={`text-[11px] font-extrabold rounded-full border px-2 ${BUCKET_STYLE[bucket].pill}`}>{list.length}</span>
                    </p>
                    <div className="space-y-2">
                      {list.map(f => (
                        <Topic
                          key={f.key}
                          reportId={report.id}
                          finding={f}
                          evidence={findingEvidence(f, evidence)}
                          vesselNames={findingVesselCodes(f, evidence).map(vesselName)}
                          singleVessel={findingVesselCodes(f, evidence).length === 1 ? findingVesselCodes(f, evidence)[0]! : selectedVesselCode}
                          following={followedKeys.has(f.key)}
                          messages={messages.filter(m => m.findingKey === f.key)}
                          onMessages={mergeMessages}
                          open={openKey === f.key}
                          onToggle={() => setOpenKey(k => (k === f.key ? null : f.key))}
                          onCreateWo={(vesselCode) => setWoFor({ vesselCode: vesselCode ?? undefined, title: f.title.slice(0, 180), priority: f.priority })}
                          onFollowed={() => { void loadActions(); }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {report.insufficient.length > 0 && (
                <p className="rounded-xl border border-dashed border-fg/20 bg-surface px-4 py-2.5 text-[12.5px] text-text-industrial/70">
                  ℹ️ <b className="text-fg">{t("advisor.cant")}</b> {report.insufficient.map(x => x.topic).join(" · ")} — {t("advisor.cantWhy")}
                </p>
              )}
            </section>
          )}

          {tab === "follow" && (
            <FollowList actions={actions} onChanged={() => { void loadActions(); }} />
          )}
        </>
      )}

      {woFor && (
        <CreateWorkOrderModal
          initialVesselCode={woFor.vesselCode}
          initialTitle={woFor.title}
          initialPriority={woFor.priority}
          onClose={() => setWoFor(null)}
          onSaved={() => { setWoFor(null); }}
        />
      )}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </div>
  );
};

// ─── Piezas ──────────────────────────────────────────────────────────────────

const Card: React.FC<{ title: string; ai?: boolean; children: React.ReactNode }> = ({ title, ai, children }) => (
  <div className="rounded-2xl border border-fg/10 bg-surface p-4">
    <p className="mb-3 flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-wider text-text-industrial/60">
      {title} {ai && <AiTag />}
    </p>
    {children}
  </div>
);

const AiTag: React.FC = () => {
  const t = useT();
  return <span className="normal-case tracking-normal text-[10px] font-extrabold text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/50 bg-violet-500/5 rounded-full px-1.5">{t("advisor.tag.ai")}</span>;
};

const Chip: React.FC<{ cls?: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={`text-[11.5px] font-bold rounded-full px-2.5 py-0.5 ${cls ?? "bg-fg/5 text-text-industrial"}`}>{children}</span>
);

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="rounded-xl border border-fg/5 bg-fg/[0.03] p-3">
    <p className="flex items-center gap-2 mb-2 text-[13.5px] font-black text-fg">
      <span className="w-5.5 h-5.5 min-w-[22px] min-h-[22px] rounded-full bg-fg text-surface text-[12px] flex items-center justify-center">{n}</span> {title}
    </p>
    {children}
  </div>
);

const Topic: React.FC<{
  reportId: string;
  finding: AdvisorFinding;
  evidence: EvidenceItem[];
  vesselNames: string[];
  singleVessel: string | null;
  following: boolean;
  open: boolean;
  onToggle: () => void;
  onCreateWo: (vesselCode: string | null) => void;
  onFollowed: () => void;
  messages: AdvisorMessage[];
  onMessages: (items: AdvisorMessage[]) => void;
}> = ({ reportId, finding: f, evidence, vesselNames, singleVessel, following, open, onToggle, onCreateWo, onFollowed, messages, onMessages }) => {
  const t = useT();
  // Si el Director ajustó el plan con el asesor, ese plan manda en todo el tema.
  const plan = currentPlan(f, messages);
  const [showOriginal, setShowOriginal] = useState(false);
  const [panel, setPanel] = useState<"mail" | "follow" | null>(null);
  const bucket = BUCKET_OF[f.priority];
  const actBtn = "flex items-center gap-2.5 w-full text-left rounded-xl border-[1.5px] px-3 py-2.5 bg-surface hover:border-fg/40";
  const actOn = "border-violet-500";
  return (
    <div className={`rounded-2xl border border-fg/10 border-l-[5px] ${BUCKET_STYLE[bucket].border} bg-surface`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-[14.5px] font-extrabold text-fg leading-snug">{f.title}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Chip>🚢 {vesselNames.length ? vesselNames.join(", ") : t("advisor.scope.fleet")}</Chip>
            {plan.who && <Chip>👤 {plan.who}</Chip>}
            {plan.targetDays != null && <Chip>⏱ {t("advisor.days").replace("{n}", String(plan.targetDays))}</Chip>}
            {plan.adjusted && <Chip cls="bg-violet-500/10 text-violet-700 dark:text-violet-300">✏️ {t("advisor.chip.adjusted")}</Chip>}
            {following && <Chip cls="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">📌 {t("advisor.chip.following")}</Chip>}
            {f.noEvidence && <Chip cls="bg-orange-500/10 text-orange-700 dark:text-orange-400">⚠ {t("advisor.noEvidence")}</Chip>}
          </div>
        </div>
        <button onClick={onToggle} aria-expanded={open}
          className={`inline-flex items-center gap-1 rounded-xl px-4 py-2 text-[13px] font-extrabold ${open ? "border border-fg/15 bg-surface text-fg hover:bg-fg/5" : "bg-fg text-surface hover:opacity-90"}`}>
          {open ? t("advisor.close") : t("advisor.resolve")} <ChevronRight className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-fg/5 p-3 md:p-4 grid gap-3 lg:grid-cols-3">
          <Step n={1} title={t("advisor.step.what")}>
            <p className="text-[13px] text-fg leading-relaxed mb-2">{f.whyItMatters || "—"}</p>
            <EvidenceList items={evidence} />
            <TalkBox reportId={reportId} findingKey={f.key} step="WHAT" messages={messages.filter(m => m.step === "WHAT")} appliedId={plan.appliedId} onChanged={onMessages} />
          </Step>

          <Step n={2} title={t("advisor.step.do")}>
            {plan.adjusted && (
              <div className="mb-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11.5px] font-extrabold text-violet-700 dark:text-violet-300">
                  ✏️ {t("advisor.talk.adjusted")}
                  <button className="underline" onClick={() => setShowOriginal(o => !o)}>{t(showOriginal ? "advisor.talk.hideOriginal" : "advisor.talk.seeOriginal")}</button>
                </span>
                {showOriginal && (
                  <p className="mt-1.5 rounded-lg border border-dashed border-fg/20 bg-fg/[0.03] px-2.5 py-1.5 text-[12px] text-text-industrial/80">
                    <b>{t("advisor.talk.original")}</b> {[f.recommendedAction, f.responsibleRole, f.target, f.verify].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            )}
            <p className="text-[13px] text-fg leading-relaxed mb-2">{plan.action || "—"}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px] mb-2">
              <dt className="text-text-industrial/70 font-bold">{t("advisor.kv.who")}</dt><dd className="font-bold text-fg">{plan.who || "—"}</dd>
              <dt className="text-text-industrial/70 font-bold">{t("advisor.kv.when")}</dt><dd className="font-bold text-fg">{plan.when || (plan.targetDays != null ? t("advisor.days").replace("{n}", String(plan.targetDays)) : "—")}</dd>
              <dt className="text-text-industrial/70 font-bold">{t("advisor.kv.closeWith")}</dt><dd className="font-bold text-fg">{plan.verify || "—"}</dd>
            </dl>
            {f.managementAdvice && <More title={`💡 ${t("advisor.howToHandle")}`}>{f.managementAdvice}</More>}
            {(f.assessment || f.facts) && <More title={`🧠 ${t("advisor.whyAdvisor")}`}>{f.assessment}</More>}
            {f.alternatives.length > 0 && (
              <More title={`⚖️ ${t("advisor.alternatives")}`}>
                <ul className="space-y-1.5">
                  {f.alternatives.map((a, i) => (
                    <li key={i}><b>{a.option}</b> — {[a.pros && `${t("advisor.alt.pros")}: ${a.pros}`, a.cons && `${t("advisor.alt.cons")}: ${a.cons}`, a.risk && `${t("advisor.alt.risk")}: ${a.risk}`].filter(Boolean).join(" · ")}</li>
                  ))}
                </ul>
              </More>
            )}
            <TalkBox reportId={reportId} findingKey={f.key} step="DO" messages={messages.filter(m => m.step === "DO")} appliedId={plan.appliedId} onChanged={onMessages} />
          </Step>

          <Step n={3} title={t("advisor.step.act")}>
            <div className="space-y-2">
              <button className={`${actBtn} ${panel === "mail" ? actOn : "border-fg/10"}`} onClick={() => setPanel(p => (p === "mail" ? null : "mail"))}>
                <span className="text-xl" aria-hidden>✉️</span>
                <span><b className="block text-[13.5px] text-fg">{t("advisor.act.ask").replace("{who}", plan.who || t("advisor.act.responsible"))}</b><small className="block text-[11.5px] text-text-industrial/70">{t("advisor.act.askHint")}</small></span>
              </button>
              {/* Sin evidencia verificable no se abre una OT: primero se confirma el hecho. */}
              {!f.noEvidence && (
                <button className={`${actBtn} border-fg/10`} onClick={() => onCreateWo(singleVessel)}>
                  <span className="text-xl" aria-hidden>🛠️</span>
                  <span><b className="block text-[13.5px] text-fg">{t("advisor.act.wo")}</b><small className="block text-[11.5px] text-text-industrial/70">{t("advisor.act.woHint")}</small></span>
                </button>
              )}
              {!following && (
                <button className={`${actBtn} ${panel === "follow" ? actOn : "border-fg/10"}`} onClick={() => setPanel(p => (p === "follow" ? null : "follow"))}>
                  <span className="text-xl" aria-hidden>📌</span>
                  <span><b className="block text-[13.5px] text-fg">{t("advisor.act.follow")}</b><small className="block text-[11.5px] text-text-industrial/70">{t("advisor.act.followHint")}</small></span>
                </button>
              )}
            </div>
            {panel === "mail" && <DraftPanel reportId={reportId} findingKey={f.key} defaultRecipient={plan.who} kind="REQUEST_INFO" />}
            {panel === "follow" && !following && (
              <FollowPanel
                reportId={reportId} findingKey={f.key} title={f.title} priority={f.priority} vesselCode={singleVessel}
                defaultWho={plan.who} targetDays={plan.targetDays} verify={plan.verify} evidenceIds={f.evidenceIds}
                onDone={() => { setPanel(null); onFollowed(); }}
              />
            )}
          </Step>
        </div>
      )}
    </div>
  );
};

const More: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 text-[12.5px]">
      <button className="font-extrabold text-violet-700 dark:text-violet-400 hover:underline" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {title} {open ? "▴" : "▾"}
      </button>
      {open && <div className="mt-1 text-text-industrial leading-relaxed">{children}</div>}
    </div>
  );
};

// ─── En seguimiento ──────────────────────────────────────────────────────────

const FollowList: React.FC<{ actions: AdvisorAction[]; onChanged: () => void }> = ({ actions, onChanged }) => {
  const t = useT();
  const [closing, setClosing] = useState<{ id: string; status: "VERIFIED" | "CANCELLED" } | null>(null);
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const confirmClose = async () => {
    if (!closing) return;
    if (!note.trim()) { setAlert(t(closing.status === "VERIFIED" ? "advisor.fu.required" : "advisor.fu.reasonRequired")); return; }
    setSaving(true);
    try {
      await api.patch(`/app/maintenance-advisor/actions/${encodeURIComponent(closing.id)}`, { status: closing.status, verificationNote: note.trim() });
      setClosing(null); setNote(""); onChanged();
    } catch (err) {
      setAlert(err instanceof ApiError ? err.message : t("advisor.error.generic"));
    } finally {
      setSaving(false);
    }
  };

  if (actions.length === 0) {
    return <p className="rounded-2xl border border-dashed border-fg/20 p-8 text-center text-sm text-text-industrial/70">{t("advisor.fu.empty")}</p>;
  }
  const sorted = [...actions].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  return (
    <section className="space-y-2">
      {sorted.map(a => {
        const due = dueBadge(a.targetDate, t);
        const isClosing = closing?.id === a.id;
        return (
          <div key={a.id} className="rounded-2xl border border-fg/10 bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-lg px-2.5 py-1.5 text-[12px] font-black text-center min-w-[104px] ${due.cls}`}>{due.text}</span>
              <div className="flex-1 min-w-[200px]">
                <p className="text-[14px] font-extrabold text-fg leading-snug">{a.title}</p>
                <p className="text-[12px] text-text-industrial/70 mt-0.5">🚢 {a.vesselName ?? t("advisor.scope.fleet")} · 👤 {a.responsibleName}</p>
              </div>
              {a.reportId && a.findingKey && (
                <button className="inline-flex items-center gap-1.5 rounded-xl border border-fg/15 bg-surface px-3.5 py-2 text-[13px] font-bold hover:bg-fg/5"
                  onClick={() => setRemind(r => (r === a.id ? null : a.id))}>✉️ {t("advisor.fu.remind")}</button>
              )}
              <button className="inline-flex items-center gap-1.5 rounded-xl bg-fg text-surface px-3.5 py-2 text-[13px] font-extrabold hover:opacity-90"
                onClick={() => { setClosing({ id: a.id, status: "VERIFIED" }); setNote(""); }}>✔ {t("advisor.fu.done")}</button>
              <button className="text-[12px] font-bold text-text-industrial/60 hover:underline"
                onClick={() => { setClosing({ id: a.id, status: "CANCELLED" }); setNote(""); }}>{t("advisor.fu.notApply")}</button>
            </div>
            {remind === a.id && a.reportId && a.findingKey && (
              <DraftPanel reportId={a.reportId} findingKey={a.findingKey} defaultRecipient={a.responsibleName} kind="FOLLOW_UP" />
            )}
            {isClosing && (
              <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border-[1.5px] border-violet-300 dark:border-violet-500/50 p-3">
                <label className="flex-1 min-w-[240px] text-[11.5px] font-bold text-text-industrial/80">
                  {t(closing.status === "VERIFIED" ? "advisor.fu.evidenceQ" : "advisor.fu.reasonQ")}<span className="ml-0.5 font-black text-red-600">*</span>
                  <input autoFocus className="mt-1 w-full bg-surface border border-fg/15 rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-violet-500"
                    value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void confirmClose(); }} />
                </label>
                <button className="rounded-xl border border-fg/15 px-3.5 py-2 text-[13px] font-bold hover:bg-fg/5" onClick={() => setClosing(null)}>{t("common.cancel")}</button>
                <button className="inline-flex items-center gap-1.5 rounded-xl bg-fg text-surface px-3.5 py-2 text-[13px] font-extrabold disabled:opacity-40" disabled={saving}
                  onClick={() => { void confirmClose(); }}>{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t("advisor.fu.confirm")}</button>
              </div>
            )}
          </div>
        );
      })}
      {alert && <AlertDialog message={alert} onClose={() => setAlert(null)} />}
    </section>
  );
};
