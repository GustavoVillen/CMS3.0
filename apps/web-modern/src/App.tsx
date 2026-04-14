import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/vessels" element={<PlaceholderPage title="Gestión de Flota" />} />
          <Route path="/assets" element={<PlaceholderPage title="Inventario de Activos" />} />
          <Route path="/maintenance-plans" element={<PlaceholderPage title="Planes de Mantenimiento" />} />
          <Route path="/work-orders" element={<PlaceholderPage title="Órdenes de Trabajo" />} />
          <Route path="/ai-insights" element={<PlaceholderPage title="Inteligencia Predictiva" />} />
          <Route path="*" element={<PlaceholderPage title="Módulo en Desarrollo" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

// Quick placeholder for other routes
const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="flex flex-col items-center justify-center h-full text-text-industrial/20">
    <h2 className="text-3xl font-bold mb-4">{title}</h2>
    <p>Este módulo está siendo modernizado para la edición Naval Industrial.</p>
  </div>
);

export default App;
