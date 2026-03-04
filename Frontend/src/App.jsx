import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'
import ShippingInstruction from './pages/ShippingInstruction'
import Allocation from './pages/Allocation'
import Docking from './pages/Docking'
import Unloading from './pages/Unloading'
import Quality from './pages/Quality'
import Verification from './pages/Verification'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/shipping-instruction" element={<ShippingInstruction />} />
        <Route path="/allocation" element={<Allocation />} />
        <Route path="/docking" element={<Docking />} />
        <Route path="/unloading" element={<ErrorBoundary><Unloading /></ErrorBoundary>} />
        <Route path="/quality" element={<Quality />} />
        <Route path="/verification" element={<Verification />} />
      </Routes>
    </Layout>
  )
}

export default App
