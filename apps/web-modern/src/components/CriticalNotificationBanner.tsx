import React, { useMemo } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../lib/notifications";
import { useT } from "../lib/i18n";

/**
 * Banner persistente arriba del main cuando hay >=1 notificación CRITICAL
 * no leída + no descartada. Se cierra al marcarla como leída (acción "Ver")
 * o al darle X (descartar). Si hay varias, mostramos la más reciente y la
 * cantidad total entre paréntesis.
 */
export const CriticalNotificationBanner: React.FC = () => {
  const { items, markRead, dismiss } = useNotifications();
  const navigate = useNavigate();
  const t = useT();

  const unreadCritical = useMemo(
    () => items.filter((n) => n.severity === "CRITICAL" && !n.readAt),
    [items],
  );

  if (unreadCritical.length === 0) return null;

  const latest = unreadCritical[0]!;
  const extra = unreadCritical.length - 1;

  const handleView = () => {
    void markRead(latest.id);
    if (latest.linkUrl) navigate(latest.linkUrl);
  };

  return (
    <div className="bg-red-500/15 border-b border-red-500/40 px-6 py-3 flex items-center gap-4">
      <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0 animate-pulse" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-red-700 dark:text-red-300 truncate">
          {latest.title}
          {extra > 0 && (
            <span className="ml-2 text-xs font-normal text-red-700 dark:text-red-300/70">
              {t("notifications.plusMore").replace("{n}", String(extra))}
            </span>
          )}
        </p>
        {latest.body && (
          <p className="text-xs text-red-200/80 truncate mt-0.5">{latest.body}</p>
        )}
      </div>
      <button
        onClick={handleView}
        className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-fg text-xs font-bold transition-colors shrink-0"
      >
        {t("notifications.view")}
      </button>
      <button
        onClick={() => void dismiss(latest.id)}
        className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-700 dark:text-red-300 transition-colors shrink-0"
        title={t("notifications.dismiss")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
