import { StrictMode, React } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Upload from './pages/Upload.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
    <Routes>
      <Route path="/upload" element={<Upload />}/>
    </Routes>
    </BrowserRouter>
  </StrictMode>
)

