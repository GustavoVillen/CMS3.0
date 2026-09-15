import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './lib/theme'
import { installUndoManager } from './lib/undo-manager'
import { startProgressOutbox } from './lib/progress-outbox'

// Ctrl+Z / Ctrl+Y en toda la app: tiene que instalarse antes de montar React.
installUndoManager()
// Avances guardados en el teléfono sin señal: se reenvían solos.
startProgressOutbox()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
