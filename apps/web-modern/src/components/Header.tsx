import { Search, Bell, User } from 'lucide-react';

export const Header: React.FC<{ title: string }> = ({ title }) => {
  return (
    <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-primary-bg/30 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-white">{title}</h1>
      </div>

      <div className="flex items-center gap-6">
        <div className="relative group">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-industrial/40 group-focus-within:text-accent transition-colors" />
          <input 
            type="text" 
            placeholder="Buscar en la flota..." 
            className="bg-white/5 border border-white/10 rounded-full py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 w-64 transition-all"
          />
        </div>

        <div className="flex items-center gap-3 border-l border-white/10 pl-6">
          <button className="relative p-2 rounded-full hover:bg-white/5 transition-colors">
            <Bell className="w-5 h-5 text-text-industrial/60" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-accent rounded-full border-2 border-primary-bg" />
          </button>
          
          <div className="flex items-center gap-3 ml-2 cursor-pointer hover:bg-white/5 p-1 pr-3 rounded-full transition-all">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/10 flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white leading-tight">Super Admin</span>
              <span className="text-[10px] text-text-industrial/50 leading-tight">Master Admin</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
