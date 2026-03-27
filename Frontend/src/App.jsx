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
import MasterSiLookup from './pages/MasterSiLookup'
import MasterFreightTerms from './pages/MasterFreightTerms'
import Admin from './pages/Admin'
import AdminUsers from './pages/AdminUsers'
import AdminRoles from './pages/AdminRoles'
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
                  <Route
                    path="/master/si-term"
                    element={
                      <MasterSiLookup
                        apiType="trade-terms"
                        title="Master – SI Term"
                        valueLabel="Term"
                        placeholder="e.g. PREPAID"
                        pageKey="master-si-term"
                      />
                    }
                  />
                  <Route
                    path="/master/si-shipper"
                    element={
                      <MasterSiLookup
                        apiType="shippers"
                        title="Master – SI Shipper"
                        valueLabel="Shipper"
                        placeholder="e.g. PT ABC"
                        pageKey="master-si-shipper"
                      />
                    }
                  />
                  <Route
                    path="/master/si-loading-port"
                    element={
                      <MasterSiLookup
                        apiType="loading-ports"
                        title="Master – SI Loading Port"
                        valueLabel="Loading Port"
                        placeholder="e.g. Bontang"
                        pageKey="master-si-loading-port"
                      />
                    }
                  />
                  <Route
                    path="/master/si-surveyor"
                    element={
                      <MasterSiLookup
                        apiType="surveyors"
                        title="Master – SI Surveyor"
                        valueLabel="Surveyor"
                        placeholder="e.g. Intertek"
                        pageKey="master-si-surveyor"
                      />
                    }
                  />
                  <Route
                    path="/master/si-agent"
                    element={
                      <MasterSiLookup
                        apiType="agents"
                        title="Master – SI Agent"
                        valueLabel="Agent"
                        placeholder="e.g. PT DEF"
                        pageKey="master-si-agent"
                      />
                    }
                  />
                  <Route
                    path="/master/si-commodity"
                    element={
                      <MasterSiLookup
                        apiType="commodities"
                        title="Master – SI Commodity"
                        valueLabel="Commodity"
                        placeholder="e.g. LNG"
                        pageKey="master-si-commodity"
                      />
                    }
                  />
                  <Route path="/master/freight-terms" element={<MasterFreightTerms />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route path="/admin/roles" element={<AdminRoles />} />
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
