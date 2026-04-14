import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Outlet, useLocation } from 'react-router-dom';

export const Layout: React.FC = () => {
  const location = useLocation();
  
  // Simple title mapper
  const getTitle = (path: string) => {
    switch (path) {
      case '/': return 'Dashboard Principal';
      case '/vessels': return 'Gestión de Flota';
      case '/assets': return 'Inventario de Activos';
      case '/maintenance-plans': return 'Planes de Mantenimiento';
      case '/work-orders': return 'Órdenes de Trabajo';
      case '/ai-insights': return 'Inteligencia Predictiva';
      default: return 'Mercurio GPMS';
    }
  };

  return (
    <div className="flex bg-primary-bg text-text-industrial">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header title={getTitle(location.pathname)} />
        <main className="flex-1 overflow-y-auto p-8 bg-[#080D1D]">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
