import React, { useMemo, useState } from "react";
import { Bot, Plus, FileText, Archive, Rocket, Layers, X } from "lucide-react";
import { useFetch } from "../lib/hooks";
import { api, ApiError } from "../lib/api";
import { fmtDate } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/DataTable";
import { useAuth } from "../lib/auth";

interface AiDocumentVersion {
  id: string;
  version: number;
  status: string;
  mimeType: string;
  sizeBytes: number;
  activatedAt?: string | null;
  createdAt: string;
  createdByUserId: string;
}

interface AiDocument {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  versions: AiDocumentVersion[];
}

interface ListResponse {
  items: AiDocument[];
  total: number;
}

export const AiDocumentsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "TENANT_ADMIN";
  const [showCreate, setShowCreate] = useState(false);
  const [versionTarget, setVersionTarget] = useState<AiDocument | null>(null);

  const { data, loading, error, reload } = useFetch<ListResponse>("/app/ai-documents");
  const documents = useMemo(() => data?.items ?? [], [data?.items]);

  return (
    <div className="space-y-5">
      {showCreate && (
        <CreateDocumentModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      {versionTarget && (
        <CreateVersionModal
          document={versionTarget}
          onClose={() => setVersionTarget(null)}
          onSaved={() => {
            setVersionTarget(null);
            reload();
          }}
        />
      )}

      <PageHeader icon={Bot} title="AI Documents" total={data?.total} onReload={reload}>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-primary-bg font-bold text-xs hover:brightness-110 transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Nuevo documento
          </button>
        )}
      </PageHeader>

      <div className="bento-card flex items-start gap-3">
        <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
          <Bot className="w-4 h-4 text-accent" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-white">Base documental del copiloto</p>
          <p className="text-xs text-text-industrial/50 leading-relaxed">
            Solo las versiones con estado `ACTIVE` entran en el contexto de IA. Las versiones `DRAFT`
            sirven para preparar cambios sin afectar respuestas en producción.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-industrial/20 gap-3">
          <FileText className="w-8 h-8" />
          <p className="text-sm">Todavía no hay documentos de IA publicados para este tenant.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {documents.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              isAdmin={isAdmin}
              onAddVersion={() => setVersionTarget(document)}
              onChanged={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function DocumentCard({
  document,
  isAdmin,
  onAddVersion,
  onChanged,
}: {
  document: AiDocument;
  isAdmin: boolean;
  onAddVersion: () => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const activeVersion = document.versions.find((version) => version.status === "ACTIVE");

  const activateVersion = async (versionId: string) => {
    setBusyId(versionId);
    try {
      await api.post(`/app/ai-documents/${document.id}/versions/${versionId}/activate`, {});
      onChanged();
    } catch {
      // ignore, reload path already gives visible state after next manual refresh
    } finally {
      setBusyId(null);
    }
  };

  const archiveDocument = async () => {
    const confirmed = window.confirm(`Archivar "${document.name}"?`);
    if (!confirmed) return;
    setBusyId(document.id);
    try {
      await api.delete(`/app/ai-documents/${document.id}`);
      onChanged();
    } catch {
      // ignore
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bento-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-white truncate">{document.name}</h3>
            <StatusBadge status={document.status} />
          </div>
          <p className="text-xs text-text-industrial/50 leading-relaxed">
            {document.description?.trim() || "Sin descripción adicional."}
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onAddVersion}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-text-industrial hover:border-accent/30 transition-all"
            >
              <Layers className="w-3.5 h-3.5 text-accent" /> Nueva versión
            </button>
            <button
              onClick={archiveDocument}
              disabled={busyId === document.id}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-all"
            >
              <Archive className="w-3.5 h-3.5" /> Archivar
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MiniStat label="Versiones" value={String(document.versions.length)} />
        <MiniStat label="Activa" value={activeVersion ? `v${activeVersion.version}` : "Ninguna"} />
        <MiniStat label="Actualizado" value={fmtDate(document.updatedAt)} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-industrial/40">
          <Layers className="w-3.5 h-3.5" />
          Historial de versiones
        </div>

        <div className="space-y-2">
          {document.versions.map((version) => (
            <div
              key={version.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white">v{version.version}</span>
                  <StatusBadge status={version.status} />
                  <span className="text-[10px] text-text-industrial/35">{formatBytes(version.sizeBytes)}</span>
                </div>
                <p className="text-xs text-text-industrial/45 mt-1">
                  Creada {fmtDate(version.createdAt)}
                  {version.activatedAt ? ` · Activa desde ${fmtDate(version.activatedAt)}` : ""}
                </p>
              </div>

              {isAdmin && version.status !== "ACTIVE" && (
                <button
                  onClick={() => activateVersion(version.id)}
                  disabled={busyId === version.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs font-bold text-accent hover:bg-accent/20 disabled:opacity-50 transition-all"
                >
                  <Rocket className="w-3.5 h-3.5" /> Activar
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateDocumentModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/app/ai-documents", { name, description, content });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el documento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Nuevo documento de IA" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nombre *">
          <input value={name} onChange={(event) => setName(event.target.value)} required className="input-field" />
        </Field>

        <Field label="Descripción">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="input-field"
          />
        </Field>

        <Field label="Contenido inicial *" hint="Texto base que podrá usarse por el copiloto cuando esta versión esté activa.">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
            rows={12}
            className="input-field resize-y min-h-[240px]"
          />
        </Field>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-white hover:bg-white/5 transition-all">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? "Guardando..." : "Crear documento"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function CreateVersionModal({
  document,
  onClose,
  onSaved,
}: {
  document: AiDocument;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/app/ai-documents/${document.id}/versions`, { content });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la nueva versión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Nueva versión · ${document.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <p className="text-xs text-text-industrial/40">
            La nueva versión se crea en estado `DRAFT`. Luego podrás activarla desde la ficha del documento.
          </p>
        </div>

        <Field label="Contenido *">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
            rows={12}
            className="input-field resize-y min-h-[240px]"
          />
        </Field>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs text-text-industrial/60 hover:text-white hover:bg-white/5 transition-all">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-accent text-primary-bg font-bold text-xs hover:brightness-110 disabled:opacity-50 transition-all">
            {saving ? "Guardando..." : "Crear versión"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-surface border border-white/10 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Bot className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-text-industrial/40 hover:text-white transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-text-industrial/60 uppercase tracking-wider">{label}</label>
      {hint ? <p className="text-[10px] text-text-industrial/30">{hint}</p> : null}
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-text-industrial/35 font-semibold">{label}</p>
      <p className="text-sm font-bold text-white mt-1">{value}</p>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
