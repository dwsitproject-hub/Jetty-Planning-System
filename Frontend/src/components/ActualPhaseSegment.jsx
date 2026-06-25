/**
 * Background color strip for one actual Gantt phase (berthing / ops / clearance).
 */
export default function ActualPhaseSegment({ phase, phaseModel, style }) {
  const isSailed = phaseModel.isSailed
  const isOverdue =
    phaseModel.etcOverdue && phaseModel.etcOverduePhase === phase.kind

  const className = [
    'jetty-schedule-gantt__phase-strip',
    `jetty-schedule-gantt__phase-strip--${phase.kind}`,
    phase.openEnd ? 'jetty-schedule-gantt__phase-strip--open-end' : '',
    phase.isFirst ? 'jetty-schedule-gantt__phase-strip--first' : '',
    phase.isLast ? 'jetty-schedule-gantt__phase-strip--last' : '',
    isOverdue ? 'jetty-schedule-gantt__phase-strip--overdue' : '',
    isSailed ? 'jetty-schedule-gantt__phase-strip--sailed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return <div className={className} style={style} />
}
