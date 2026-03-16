import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { LoadingProvider } from './context/LoadingContext'
import { ClearanceProvider } from './context/ClearanceContext'
import { ActivityLogProvider } from './context/ActivityLogContext'
import Dashboard from './pages/Dashboard'
import ShippingInstruction from './pages/ShippingInstruction'
import SIApproval from './pages/SIApproval'
import SIView from './pages/SIView'
import Allocation from './pages/Allocation'
import Loading from './pages/Loading'
import AtBerthExecutions from './pages/AtBerthExecutions'
import Quality from './pages/Quality'
import Verification from './pages/Verification'
import Reporting from './pages/Reporting'
import DailyActivitiesReport from './pages/DailyActivitiesReport'
import VesselReport from './pages/VesselReport'
import Master from './pages/Master'
import MasterPort from './pages/MasterPort'
import MasterJetty from './pages/MasterJetty'
import MasterJettyLayout from './pages/MasterJettyLayout'
import Admin from './pages/Admin'
import AdminUsers from './pages/AdminUsers'
import AdminRoles from './pages/AdminRoles'
import AdminDepartments from './pages/AdminDepartments'

function App() {
  return (
    <LoadingProvider>
      <ClearanceProvider>
        <ActivityLogProvider>
        <Layout>
          <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/shipping-instruction" element={<ShippingInstruction />} />
        <Route path="/shipping-instruction/approval/:siId" element={<SIApproval />} />
        <Route path="/shipping-instruction/view/:siId" element={<SIView />} />
        <Route path="/allocation" element={<Allocation />} />
        <Route path="/berthing" element={<Allocation />} />
        <Route path="/at-berth" element={<AtBerthExecutions />} />
        <Route path="/loading" element={<Loading />} />
        <Route path="/loading/:vesselId" element={<Loading />} />
        <Route path="/loading/:vesselId/:section" element={<Loading />} />
        <Route path="/unloading" element={<Loading />} />
        <Route path="/unloading/:vesselId" element={<Loading />} />
        <Route path="/unloading/:vesselId/:section" element={<Loading />} />
        <Route path="/quality" element={<Quality />} />
        <Route path="/verification" element={<Verification />} />
        <Route path="/reporting" element={<Reporting />} />
        <Route path="/reporting/daily-activities" element={<DailyActivitiesReport />} />
        <Route path="/reporting/vessel" element={<VesselReport />} />
        <Route path="/master" element={<Master />} />
        <Route path="/master/port" element={<MasterPort />} />
        <Route path="/master/jetty" element={<MasterJetty />} />
        <Route path="/master/jetty-layout" element={<MasterJettyLayout />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/roles" element={<AdminRoles />} />
        <Route path="/admin/departments" element={<AdminDepartments />} />
      </Routes>
        </Layout>
        </ActivityLogProvider>
      </ClearanceProvider>
    </LoadingProvider>
  )
}

export default App
