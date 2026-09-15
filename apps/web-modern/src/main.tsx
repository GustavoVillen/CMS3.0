import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './lib/theme'
import { installUndoManager } from './lib/undo-manager'

// Ctrl+Z / Ctrl+Y en toda la app: tiene que instalarse antes de montar React.
installUndoManager()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
