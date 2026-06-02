import React, { useEffect, useRef, useState } from "react";
import { Bell, AlertTriangle, CheckCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotifications, type NotificationDto } from "../lib/notifications";
import { useT } from "../lib/i18n";

function severityClasses(sev: string): { dot: string; label: string } {
  if (sev === "CRITICAL") return { dot: "bg-red-500", label: "text-red-700 dark:text-red-400" };
  if (sev === "HIGH")     return { dot: "bg-amber-500", label: "text-amber-700 dark:text-amber-400" };
  return { dot: "bg-sky-500", label: "text-sky-700 dark:text-sky-400" };
}

function timeAgo(iso: string, t: (k: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t("notifications.justNow");
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export const NotificationsBell: React.FC = () => {
  const { items, unreadCount, markRead, markAllRead, dismiss } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const t = useT();

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleOpen = (n: NotificationDto) => {
    if (!n.readAt) void markRead(n.id);
    setOpen(false);
    if (n.linkUrl) navigate(n.linkUrl);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-full hover:bg-fg/5 transition-colors"
        aria-label={t("notifications.bellAria")}
      >
        <Bell className="w-5 h-5 text-text-industrial/60" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-fg text-[10px] font-bold flex items-center justify-center shadow-md">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-96 max-h-[70vh] bg-surface border border-fg/10 rounded-xl shadow-2xl overflow-hidden z-200 flex flex-col">
          <div className="px-4 py-3 border-b border-fg/10 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-fg">{t("notifications.title")}</p>
              <p className="text-xs text-text-industrial/50">
                {unreadCount > 0
                  ? t("notifications.unreadCount").replace("{n}", String(unreadCount))
                  : t("notifications.allCaughtUp")}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                className="flex items-center gap-1 text-xs text-accent hover:text-fg transition-colors"
                title={t("notifications.markAllRead")}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-text-industrial/40">
                {t("notifications.empty")}
              </div>
            )}
            {items.map((n) => {
              const sev = severityClasses(n.severity);
              return (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-fg/5 hover:bg-fg/3 transition-colors cursor-pointer group ${n.readAt ? "opacity-60" : ""}`}
                  onClick={() => handleOpen(n)}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-fg truncate">{n.title}</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); void dismiss(n.id); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-industrial/40 hover:text-fg shrink-0"
                          title={t("notifications.dismiss")}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {n.body && <p className="text-xs text-text-industrial/60 mt-0.5 line-clamp-2">{n.body}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        {n.severity === "CRITICAL" && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-red-700 dark:text-red-400 uppercase">
                            <AlertTriangle className="w-3 h-3" />
                            {t("notifications.critical")}
                          </span>
                        )}
                        {n.vesselCode && (
                          <span className="text-[10px] text-text-industrial/50">{n.vesselCode}</span>
                        )}
                        <span className="text-[10px] text-text-industrial/40 ml-auto">{timeAgo(n.createdAt, t)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
