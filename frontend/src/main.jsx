import { StrictMode, React } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Upload from './pages/Upload.jsx'
import Scans from './pages/Scans.jsx'
import ScanDetail from './pages/ScanDetail.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
    <Routes>
      <Route path="/upload" element={<Upload />}/>
      <Route path="/scans" element={<Scans />}/>
      <Route path="/scans/:scanId" element={<ScanDetail />}/>
    </Routes>
    </BrowserRouter>
  </StrictMode>
)

