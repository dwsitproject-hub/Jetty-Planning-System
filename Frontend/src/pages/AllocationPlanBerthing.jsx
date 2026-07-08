import Allocation from './Allocation'

/** Plan-centric queue (grouped by shipment plan); same schematic/Gantt and child-row actions as Allocation. */
export default function AllocationPlanBerthing() {
  return <Allocation pageProfile="planCentric" />
}
