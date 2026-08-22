import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'

import '@fontsource-variable/inter'
import './index.css'

const container = document.querySelector<HTMLDivElement>('#root')
if (!container) {
  throw new Error('Root container is missing from index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
