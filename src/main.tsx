import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
import './index.css'
import 'leaflet/dist/leaflet.css'
import { App } from './app/App'

// Vite-friendly Leaflet default icon fix (otherwise marker images 404)
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl })
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: () => string })._getIconUrl

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
