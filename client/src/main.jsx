import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { CalendarPollingProvider } from './context/CalendarPollingContext'
import { ToastProvider } from './context/ToastContext'

// Admin.jsx currently references RefreshCw without importing it directly.
// Expose the icon before React renders so the Admin page does not crash.
globalThis.RefreshCw = RefreshCw

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <CalendarPollingProvider>
            <App />
          </CalendarPollingProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
