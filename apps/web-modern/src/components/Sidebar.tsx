import React from 'react';
import { 
  LayoutDashboard, 
  Ship, 
  Settings, 
  ClipboardList, 
  Wrench, 
  FileText, 
  AlertTriangle, 
  Clock, 
  ShieldCheck, 
  Microscope, 
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Ship, label: 'Vessels', path: '/vessels' },
  { icon: Settings, label: 'Assets', path: '/assets' },
  { icon: ClipboardList, label: 'Maintenance Plans', path: '/maintenance-plans' },
  { icon: Wrench, label: 'Work Orders', path: '/work-orders' },
  { icon: FileText, label: 'Daily Reports', path: '/daily-reports' },
  { icon: AlertTriangle, label: 'Defects', path: '/defects' },
  { icon: Clock, label: 'Deferrals', path: '/deferrals' },
  { icon: Microscope, label: 'RCA & CAPA', path: '/rca' },
  { icon: ShieldCheck, label: 'Inspections', path: '/inspections' },
  { icon: FileText, label: 'Certificates', path: '/certificates' },
  { icon: Sparkles, label: 'AI Insights', path: '/ai-insights', special: true },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-64 h-screen border-r border-white/10 flex flex-col bg-primary-bg/50 backdrop-blur-xl">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <Ship className="text-primary-bg w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight text-white">GPMS Naval</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => cn(
              "flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group",
              isActive 
                ? "bg-accent/10 text-accent border border-accent/20" 
                : "text-text-industrial/60 hover:text-white hover:bg-white/5",
              item.special && !isActive && "text-accent/80"
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className={cn(
                "w-5 h-5",
                item.special ? "text-accent" : "group-hover:text-white"
              )} />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
            <ChevronRight className={cn(
              "w-4 h-4 opacity-0 transition-opacity",
              "group-hover:opacity-40"
            )} />
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-white/10">
        <div className="p-3 rounded-xl bg-gradient-to-br from-accent/20 to-transparent border border-accent/20">
          <p className="text-[10px] uppercase tracking-widest text-accent font-bold mb-1">Status de Flota</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success-sea animate-pulse" />
            <span className="text-xs text-text-industrial font-medium">Todos los sistemas OK</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
