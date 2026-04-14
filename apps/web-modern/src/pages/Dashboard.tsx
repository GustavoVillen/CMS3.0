import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area 
} from 'recharts';
import { Ship, Wrench, ShieldAlert, Zap, Sparkles } from 'lucide-react';

const DATA_WO = [
  { name: 'Lun', completed: 4, pending: 2 },
  { name: 'Mar', completed: 3, pending: 5 },
  { name: 'Mie', completed: 7, pending: 3 },
  { name: 'Jue', completed: 5, pending: 4 },
  { name: 'Vie', completed: 8, pending: 1 },
  { name: 'Sab', completed: 2, pending: 2 },
  { name: 'Dom', completed: 1, pending: 0 },
];

const DATA_FUEL = [
  { time: '00:00', fuel: 85 },
  { time: '04:00', fuel: 82 },
  { time: '08:00', fuel: 78 },
  { time: '12:00', fuel: 92 },
  { time: '16:00', fuel: 88 },
  { time: '20:00', fuel: 84 },
  { time: '23:59', fuel: 80 },
];

export const Dashboard: React.FC = () => {
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={Ship} label="Vessels en Operación" value="24" trend="+2" />
        <StatCard icon={Wrench} label="Work Orders Abiertas" value="156" trend="-4" />
        <StatCard icon={ShieldAlert} label="Alertas Críticas" value="02" color="text-accent" />
        <StatCard icon={Zap} label="Eficiencia Flota" value="94.2%" trend="+0.5%" />
      </div>

      {/* Main Grid (Bento) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Chart */}
        <div className="lg:col-span-2 bento-card min-h-[400px] flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-xl font-bold text-white">Estado de Órdenes de Trabajo</h2>
              <p className="text-sm text-text-industrial/50">Reporte semanal de cumplimiento</p>
            </div>
            <div className="flex gap-2">
              <span className="flex items-center gap-1.5 text-xs text-text-industrial/60">
                <span className="w-2 h-2 rounded-full bg-accent" /> Completadas
              </span>
              <span className="flex items-center gap-1.5 text-xs text-text-industrial/60">
                <span className="w-2 h-2 rounded-full bg-accent/20" /> Pendientes
              </span>
            </div>
          </div>
          <div className="flex-1 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={DATA_WO}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1C2541', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#E0E1DD' }}
                />
                <Bar dataKey="completed" fill="#FF9F1C" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar dataKey="pending" fill="rgba(255, 159, 28, 0.2)" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AI Insights Sidebar in Bento */}
        <div className="bento-card flex flex-col glass-glow">
          <div className="flex items-center gap-2 mb-6 text-accent">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-lg font-bold">AI Insights</h2>
          </div>
          <div className="space-y-4 flex-1">
            <InsightItem 
              type="MAINTENANCE" 
              title="Predictivo: Filtros Generador 2" 
              desc="Anomalía técnica detectada. Reemplazo sugerido en 48hs." 
              priority="CRITICAL"
            />
            <InsightItem 
              type="EFFICIENCY" 
              title="Optimización de Ruta" 
              desc="Viento de cola favorable en Ruta 4. Ahorro estimado: 3.2% fuel." 
              priority="MEDIUM"
            />
            <InsightItem 
              type="SAFETY" 
              title="Certificado de Seguridad" 
              desc="Vencimiento próximo: MV Oceanic (15 días)." 
              priority="HIGH"
            />
          </div>
          <button className="mt-6 w-full py-2.5 rounded-xl bg-accent text-primary-bg font-bold text-sm hover:brightness-110 transition-all">
            Ver Todos los Insights
          </button>
        </div>

        {/* Fuel Consumption (Line Chart) */}
        <div className="lg:col-span-3 bento-card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Consumo de Combustible en Tiempo Real</h2>
            <div className="flex items-center gap-4">
              <span className="text-sm font-bold text-success-sea bg-success-sea/10 px-3 py-1 rounded-full">Eficiencia Óptima</span>
            </div>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={DATA_FUEL}>
                <defs>
                  <linearGradient id="colorFuel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF9F1C" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#FF9F1C" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1C2541', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                />
                <Area type="monotone" dataKey="fuel" stroke="#FF9F1C" fillOpacity={1} fill="url(#colorFuel)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, trend, color = 'text-white' }: any) => (
  <div className="bento-card">
    <div className="flex items-start justify-between mb-4">
      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
        <Icon className="w-5 h-5 text-accent" />
      </div>
      {trend && (
        <span className={`text-xs font-bold ${trend.startsWith('+') ? 'text-success-sea' : 'text-red-400'}`}>
          {trend}
        </span>
      )}
    </div>
    <div className="space-y-1">
      <p className="text-sm text-text-industrial/40 font-medium">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
    </div>
  </div>
);

const InsightItem = ({ type, title, desc, priority }: any) => {
  const priorityColors: any = {
    CRITICAL: 'bg-red-500/10 text-red-500 border-red-500/20',
    HIGH: 'bg-accent/10 text-accent border-accent/20',
    MEDIUM: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  };

  return (
    <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold tracking-widest text-text-industrial/30 uppercase">{type}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${priorityColors[priority]}`}>
          {priority}
        </span>
      </div>
      <h3 className="text-sm font-bold text-white group-hover:text-accent transition-colors">{title}</h3>
      <p className="text-xs text-text-industrial/50 mt-1 line-clamp-2">{desc}</p>
    </div>
  );
};
