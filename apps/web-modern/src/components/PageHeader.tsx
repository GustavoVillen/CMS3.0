import React from "react";
import { RefreshCw, type LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  total?: number;
  onReload?: () => void;
  children?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ icon: Icon, title, total, onReload, children }) => (
  <div className="flex items-center justify-between gap-4 flex-wrap">
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
        <Icon className="w-5 h-5 text-accent" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-fg">{title}</h2>
        {total !== undefined && (
          <p className="text-xs text-fg/40">{total} registro{total !== 1 ? "s" : ""}</p>
        )}
      </div>
    </div>
    <div className="flex items-center gap-2">
      {children}
      {onReload && (
        <button
          onClick={onReload}
          className="p-1.5 rounded-lg hover:bg-fg/5 text-fg/40 hover:text-fg transition-all"
          title="Actualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}
    </div>
  </div>
);
