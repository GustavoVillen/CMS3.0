/**
 * Notifications client — context + hook con polling cada 30s.
 * Expone la lista, conteos y acciones (markRead, dismiss, markAll).
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

const POLL_INTERVAL_MS = 30_000;

export interface NotificationDto {
  id: string;
  vesselCode: string | null;
  type: string;
  severity: "CRITICAL" | "HIGH" | "INFO" | string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
  readAt: string | null;
}

interface NotificationsState {
  items: NotificationDto[];
  unreadCount: number;
  criticalUnreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

const Ctx = createContext<NotificationsState | null>(null);

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [criticalUnreadCount, setCriticalUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const res = await api.get<{ items: NotificationDto[]; unreadCount: number; criticalUnreadCount: number }>("/app/notifications");
      if (!mounted.current) return;
      setItems(res.items ?? []);
      setUnreadCount(res.unreadCount ?? 0);
      setCriticalUnreadCount(res.criticalUnreadCount ?? 0);
    } catch {
      // best-effort: errores 401 ya los maneja api.ts; el resto se ignora
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]); setUnreadCount(0); setCriticalUnreadCount(0);
      return;
    }
    void refresh();
    const t = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [isAuthenticated, refresh]);

  const markRead = useCallback(async (id: string) => {
    await api.post(`/app/notifications/${id}/read`, {});
    setItems((prev) => prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    const target = items.find((n) => n.id === id);
    if (target?.severity === "CRITICAL" && !target.readAt) {
      setCriticalUnreadCount((c) => Math.max(0, c - 1));
    }
  }, [items]);

  const markAllRead = useCallback(async () => {
    await api.post(`/app/notifications/read-all`, {});
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    setCriticalUnreadCount(0);
  }, []);

  const dismiss = useCallback(async (id: string) => {
    await api.post(`/app/notifications/${id}/dismiss`, {});
    setItems((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target?.severity === "CRITICAL" && !target.readAt) {
        setCriticalUnreadCount((c) => Math.max(0, c - 1));
      }
      if (target && !target.readAt) setUnreadCount((c) => Math.max(0, c - 1));
      return prev.filter((n) => n.id !== id);
    });
  }, []);

  return (
    <Ctx.Provider value={{ items, unreadCount, criticalUnreadCount, loading, refresh, markRead, markAllRead, dismiss }}>
      {children}
    </Ctx.Provider>
  );
};

export function useNotifications(): NotificationsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return v;
}
