import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { LoadingProvider } from './context/LoadingContext'
import Dashboard from './pages/Dashboard'
import ShippingInstruction from './pages/ShippingInstruction'
import SIApproval from './pages/SIApproval'
import SIView from './pages/SIView'
import Allocation from './pages/Allocation'
import Loading from './pages/Loading'
import Unloading from './pages/Unloading'
import Quality from './pages/Quality'
import Verification from './pages/Verification'

function App() {
  return (
    <LoadingProvider>
      <Layout>
        <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/shipping-instruction" element={<ShippingInstruction />} />
        <Route path="/shipping-instruction/approval/:siId" element={<SIApproval />} />
        <Route path="/shipping-instruction/view/:siId" element={<SIView />} />
        <Route path="/allocation" element={<Allocation />} />
        <Route path="/berthing" element={<Allocation />} />
        <Route path="/loading" element={<Loading />} />
        <Route path="/loading/:vesselId" element={<Loading />} />
        <Route path="/loading/:vesselId/:section" element={<Loading />} />
        <Route path="/unloading" element={<ErrorBoundary><Unloading /></ErrorBoundary>} />
        <Route path="/quality" element={<Quality />} />
        <Route path="/verification" element={<Verification />} />
      </Routes>
      </Layout>
    </LoadingProvider>
  )
}

export default App
