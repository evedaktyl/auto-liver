import { StrictMode, React } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Upload from './pages/Upload.jsx'
import Scans from './pages/Scans.jsx'
import ScanDetail from './pages/ScanDetail.jsx'
import Drafts from './pages/Drafts.jsx'
import DraftDetail from './pages/DraftDetail.jsx'
import NavBar from './components/NavBar.jsx'
import './index.css'
import Home from './pages/Home.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
    <NavBar/>
    <Routes>
      <Route path='/' element={<Home />}/>
      <Route path="/upload" element={<Upload />}/>
      <Route path="/scans" element={<Scans />}/>
      <Route path="/scans/:scanId" element={<ScanDetail />}/>
      <Route path="/drafts" element={<Drafts />}/>
      <Route path="/drafts/:draftId" element={<DraftDetail />} />
    </Routes>
    </BrowserRouter>
  </StrictMode>
)

