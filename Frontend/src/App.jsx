import { Routes, Route, Outlet, useLocation, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { LoadingProvider } from './context/LoadingContext'
import { ClearanceProvider } from './context/ClearanceContext'
import { ActivityLogProvider } from './context/ActivityLogContext'
import { RbacProvider } from './context/RbacContext'
import { AuthProvider } from './context/AuthContext'
import { PortScopeProvider } from './context/PortScopeContext'
import { FilePreviewProvider } from './context/FilePreviewContext'
import Login from './pages/Login'
import SelectPort from './pages/SelectPort'
import DashboardV2 from './pages/DashboardV2'
import ShipmentPlansList from './pages/ShipmentPlansList'
import ShipmentPlanHub from './pages/ShipmentPlanHub'
import ShipmentPlanApproval from './pages/ShipmentPlanApproval'
import SIApproval from './pages/SIApproval'
import SIView from './pages/SIView'
import Allocation from './pages/Allocation'
import AllocationPlanBerthing from './pages/AllocationPlanBerthing'
import RetiredPage from './pages/RetiredPage'
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
import DemurrageRiskCalculator from './pages/DemurrageRiskCalculator'
import JettyLive from './pages/JettyLive'
import DevOcrTest from './pages/DevOcrTest'

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
            <PortScopeProvider>
              <FilePreviewProvider>
              <RbacProvider>
                <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/select-port" element={<SelectPort />} />
                <Route element={<AppShell />}>
                  <Route path="/" element={<DashboardV2 />} />
                  <Route path="/dashboard-v2" element={<Navigate to="/" replace />} />
                  <Route path="/jetty-live" element={<JettyLive />} />
                  <Route
                    path="/shipping-instruction"
                    element={
                      <RetiredPage
                        title="Shipping Instruction list (retired)"
                        body="The standalone Shipping Instruction list has been retired. Manage vessel calls and draft SIs from Shipment plans; use Allocation & Berthing (plans) for the incoming queue."
                        primaryHref="/shipment-plans"
                        primaryLabel="Open Shipment plans"
                        secondaryHref="/allocation-plans"
                        secondaryLabel="Open Allocation & Berthing (plans)"
                      />
                    }
                  />
                  <Route path="/shipping-instruction/approval/:siId" element={<SIApproval />} />
                  <Route path="/shipping-instruction/view/:siId" element={<SIView />} />
                  <Route path="/shipment-plans/approval/:planId" element={<ShipmentPlanApproval />} />
                  <Route path="/shipment-plans/:planId" element={<ShipmentPlanHub />} />
                  <Route path="/shipment-plans" element={<ShipmentPlansList />} />
                  <Route
                    path="/allocation"
                    element={
                      <RetiredPage
                        title="Allocation & Berthing (retired list)"
                        body="This page has been retired. Use Allocation & Berthing (shipment plans) for the incoming vessel queue, schematic, and arrival updates."
                        primaryHref="/allocation-plans"
                        primaryLabel="Open Allocation & Berthing (plans)"
                        secondaryHref="/shipment-plans"
                        secondaryLabel="Open Shipment plans"
                      />
                    }
                  />
                  <Route path="/allocation-plans" element={<AllocationPlanBerthing />} />
                  <Route path="/berthing" element={<Navigate to="/allocation-plans" replace />} />
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
                  <Route path="/demurrage-risk-calculator" element={<DemurrageRiskCalculator />} />
                  <Route path="/master" element={<Master />} />
                  <Route path="/master/port" element={<MasterPort />} />
                  <Route path="/master/jetty" element={<MasterJetty />} />
                  <Route path="/master/jetty-layout" element={<MasterJettyLayout />} />
                  <Route
                    path="/master/si-term"
                    element={
                      <MasterSiLookup
                        apiType="trade-terms"
                        title="Master – Term"
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
                        title="Master – Shipper"
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
                        title="Master – Loading Port"
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
                        title="Master – Surveyor"
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
                        title="Master – Agent"
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
                        title="Master – Commodity"
                        valueLabel="Commodity"
                        placeholder="e.g. LNG"
                        pageKey="master-si-commodity"
                        enableStandardRateFields
                      />
                    }
                  />
                  <Route path="/master/freight-terms" element={<MasterFreightTerms />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route path="/admin/roles" element={<AdminRoles />} />
                  <Route path="/dev/ocr-test" element={<DevOcrTest />} />
                </Route>
                </Routes>
                </RbacProvider>
              </FilePreviewProvider>
            </PortScopeProvider>
          </AuthProvider>
        </ActivityLogProvider>
      </ClearanceProvider>
    </LoadingProvider>
  )
}

export default App
