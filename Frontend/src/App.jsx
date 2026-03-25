import { Routes, Route, Outlet, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { LoadingProvider } from './context/LoadingContext'
import { ClearanceProvider } from './context/ClearanceContext'
import { ActivityLogProvider } from './context/ActivityLogContext'
import { RbacProvider } from './context/RbacContext'
import { AuthProvider } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ShippingInstruction from './pages/ShippingInstruction'
import SIApproval from './pages/SIApproval'
import SIView from './pages/SIView'
import Allocation from './pages/Allocation'
import Loading from './pages/Loading'
import LoadingOperation from './pages/LoadingOperation'
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
import E2EConsole from './pages/E2EConsole'

function AppShell() {
  const location = useLocation()
  const isSiView = /^\/shipping-instruction\/view\/[^/]+$/.test(location.pathname)
  const isEmbed = new URLSearchParams(location.search).get('embed') === '1'
  if (isSiView && isEmbed) {
    return <Outlet />
  }
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

function App() {
  return (
    <LoadingProvider>
      <ClearanceProvider>
        <ActivityLogProvider>
          <AuthProvider>
            <RbacProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<AppShell />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/shipping-instruction" element={<ShippingInstruction />} />
                  <Route path="/shipping-instruction/approval/:siId" element={<SIApproval />} />
                  <Route path="/shipping-instruction/view/:siId" element={<SIView />} />
                  <Route path="/allocation" element={<Allocation />} />
                  <Route path="/berthing" element={<Allocation />} />
                  <Route path="/at-berth" element={<AtBerthExecutions />} />
                  <Route path="/loading/operation/:operationId" element={<LoadingOperation />} />
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
                  <Route path="/e2e-console" element={<E2EConsole />} />
                </Route>
              </Routes>
            </RbacProvider>
          </AuthProvider>
        </ActivityLogProvider>
      </ClearanceProvider>
    </LoadingProvider>
  )
}

export default App
