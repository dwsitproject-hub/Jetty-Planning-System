import { useMemo, useCallback, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import DropdownMultiSelect from './DropdownMultiSelect'
import {
  rankFlowCommodities,
  buildFlowChartEntries,
  flowRateForEntry,
  flowColorIndexForEntry,
  pruneFlowCommoditySelection,
} from '../utils/weeklyFlowChartSeries'
import WeeklyLineChart, { ChartBlockTitle, formatWeekRangeLabel } from './WeeklyLineChart'

function getTodayUtcYmd() {
  return new Date().toISOString().slice(0, 10)
}

function buildWeekUpcomingFlags(weeks) {
  const today = getTodayUtcYmd()
  return (weeks || []).map((w) => w.startDate > today)
}

function lastActiveWeekIndex(upcomingFlags) {
  let idx = -1
  upcomingFlags.forEach((up, i) => { if (!up) idx = i })
  return idx
}

function projectUpcomingSeries(values, upcomingFlags, lastActiveIdx) {
  if (lastActiveIdx < 0 || !Array.isArray(values)) return values
  const raw = values[lastActiveIdx]
  const base = raw == null || !Number.isFinite(Number(raw)) ? 0 : Number(raw)
  return values.map((v, i) => (upcomingFlags[i] ? base : v))
}

function numericValue(v) {
  return v == null || !Number.isFinite(Number(v)) ? 0 : Number(v)
}

const FLOW_LINE_COLORS = [
  'var(--v2-chart-atberth)',
  'var(--v2-chart-submitted)',
  'var(--v2-chart-planned)',
  'var(--v2-chart-sailed)',
  'var(--v2-chart-rejected)',
  'var(--v2-chart-draft)',
]

export default function DashboardV2WeeklyTrends({
  data,
  totalSlots,
  loading,
  refreshing = false,
  filtered = false,
  dateRangeLabel,
}) {
  const { t, i18n } = useTranslation('dashboard')
  const [selectedFlowCommodityIds, setSelectedFlowCommodityIds] = useState([])

  const flowRanked = useMemo(() => rankFlowCommodities(data), [data])

  useEffect(() => {
    setSelectedFlowCommodityIds((prev) => {
      const pruned = pruneFlowCommoditySelection(prev, flowRanked)
      return pruned.length === prev.length && pruned.every((id, i) => id === prev[i]) ? prev : pruned
    })
  }, [flowRanked])

  const flowOptions = useMemo(
    () => flowRanked.map((c) => ({ value: String(c.commodityId), label: c.code })),
    [flowRanked],
  )

  const weekLabels = useMemo(
    () => (data || []).map((w) => formatWeekRangeLabel(w.startDate, w.endDate)),
    [data, i18n.language],
  )

  const weekIsUpcoming = useMemo(() => buildWeekUpcomingFlags(data), [data])
  const lastActiveIdx = useMemo(() => lastActiveWeekIndex(weekIsUpcoming), [weekIsUpcoming])
  const hasUpcomingWeeks = weekIsUpcoming.some(Boolean)

  const withProjectedNote = useCallback((items, weekIndex) => {
    if (!weekIsUpcoming[weekIndex]) return items
    return [...items, { primary: t('v2WeeklyProjectedNote') }]
  }, [weekIsUpcoming, t])

  const rangeSub = dateRangeLabel || ''
  const flowEntries = useMemo(
    () => buildFlowChartEntries(data, {
      selectedCommodityIds: selectedFlowCommodityIds,
      othersLabel: t('v2WeeklyFlowOthers'),
    }),
    [data, selectedFlowCommodityIds, t],
  )

  if (loading && !data) {
    return (
      <section className="card v2-weekly">
        <h2 className="card__title">{t('v2WeeklyTitle')}</h2>
        <p className="text-steel">{t('loadingEllipsis')}</p>
      </section>
    )
  }

  if (!data || data.length === 0) {
    return null
  }

  return (
    <section className={`card v2-weekly${refreshing ? ' v2-weekly--refreshing' : ''}`}>
      <div className="v2-weekly__head">
        <h2 className="card__title">{t('v2WeeklyTitle')}</h2>
        <div className="v2-weekly__head-right">
          {refreshing && (
            <span className="v2-weekly__refreshing" role="status">{t('v2WeeklyRefreshing')}</span>
          )}
          {hasUpcomingWeeks && (
            <span className="v2-weekly__legend-item v2-weekly__legend-item--head">
              <i className="v2-weekly__legend-marker v2-weekly__legend-marker--projected" aria-hidden />
              {t('v2WeeklyLegendProjected')}
            </span>
          )}
          <span className="v2-weekly__period">{dateRangeLabel}</span>
        </div>
      </div>
      <p className="v2-weekly__hint">
        {filtered ? t('v2WeeklyFilteredHint') : t('v2WeeklyHint')}
        {hasUpcomingWeeks ? ` ${t('v2WeeklyProjectedHint')}` : ''}
      </p>
      <div className="v2-weekly__body">
      <div className="v2-weekly__block">
        <ChartBlockTitle info={t('v2WeeklyOccInfo')}>{t('v2WeeklyOccupancy')}</ChartBlockTitle>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyOccupancy')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle={false}
          ariaLabel={`${t('v2WeeklyOccupancy')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyOccupancy')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const w = data[i]
              const pct = weekIsUpcoming[i]
                ? projectUpcomingSeries(
                  data.map((x) => x.slotOccupancyPct ?? 0),
                  weekIsUpcoming,
                  lastActiveIdx,
                )[i]
                : (w.slotOccupancyPct ?? '—')
              return withProjectedNote([
                {
                  primary: t('v2WeeklyOccupancy'),
                  secondary: typeof pct === 'number' ? `${pct}%` : String(pct),
                },
                {
                  primary: t('v2WeeklyTipOccSecondary', {
                    used: w.berthOccupiedPlans ?? 0,
                    total: totalSlots ?? 0,
                  }),
                },
              ], i)
            },
          }}
          series={[
            {
              key: 'occ',
              color: 'var(--v2-chart-atberth)',
              values: projectUpcomingSeries(
                data.map((w) => (w.slotOccupancyPct != null ? Number(w.slotOccupancyPct) : 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) =>
                weekIsUpcoming[i]
                  ? t('v2WeeklyOccProjectedTooltip', { range: weekLabels[i], pct: val })
                  : t('v2WeeklyOccTooltip', {
                    range: weekLabels[i],
                    pct: data[i].slotOccupancyPct ?? '—',
                    used: data[i].berthOccupiedPlans ?? 0,
                    total: totalSlots ?? 0,
                  }),
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <div className="v2-weekly__block-title-row">
          <ChartBlockTitle info={t('v2WeeklyPlansInfo')}>{t('v2WeeklyPlansTitle')}</ChartBlockTitle>
          <div className="v2-weekly__legend v2-weekly__legend--inline">
            <span className="v2-weekly__legend-item">
              <i className="v2-weekly__legend-marker v2-weekly__legend-marker--approved" />
              {t('v2WeeklyLegendApproved')}
            </span>
            <span className="v2-weekly__legend-item">
              <i className="v2-weekly__legend-marker v2-weekly__legend-marker--sailed" />
              {t('v2WeeklyLegendSailed')}
            </span>
          </div>
        </div>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyAxisCount')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle={false}
          ariaLabel={`${t('v2WeeklyPlansTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyPlansTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const approvedVals = projectUpcomingSeries(
                data.map((w) => Number(w.approvedPlans ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              const sailedVals = projectUpcomingSeries(
                data.map((w) => Number(w.sailedCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              return withProjectedNote([
                {
                  primary: t('v2WeeklyLegendApproved'),
                  secondary: String(approvedVals[i] ?? 0),
                },
                {
                  primary: t('v2WeeklyLegendSailed'),
                  secondary: String(sailedVals[i] ?? 0),
                },
              ], i)
            },
          }}
          series={[
            {
              key: 'approved',
              color: 'var(--v2-chart-approved)',
              values: projectUpcomingSeries(
                data.map((w) => Number(w.approvedPlans ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) =>
                `${weekLabels[i]}: ${t('v2WeeklyLegendApproved')} ${val}`,
            },
            {
              key: 'sailed',
              color: 'var(--v2-chart-sailed)',
              values: projectUpcomingSeries(
                data.map((w) => Number(w.sailedCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) =>
                `${weekLabels[i]}: ${t('v2WeeklyLegendSailed')} ${val}`,
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <ChartBlockTitle info={t('v2WeeklyQtyInfo')}>{t('v2WeeklyQtyTitle')}</ChartBlockTitle>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyAxisMt')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle={false}
          ariaLabel={`${t('v2WeeklyQtyTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyQtyTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const qtyVals = projectUpcomingSeries(
                data.map((w) => Number(w.sailedQtyMt ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              const sailedVals = projectUpcomingSeries(
                data.map((w) => Number(w.sailedCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              return withProjectedNote([
                {
                  primary: t('v2WeeklyQtyLegend'),
                  secondary: `${Number(qtyVals[i] ?? 0).toLocaleString()} MT`,
                },
                {
                  primary: t('v2WeeklyLegendSailed'),
                  secondary: String(sailedVals[i] ?? 0),
                },
              ], i)
            },
          }}
          series={[
            {
              key: 'qty',
              color: 'var(--v2-chart-approved)',
              values: projectUpcomingSeries(
                data.map((w) => Number(w.sailedQtyMt ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) =>
                `${weekLabels[i]}: ${Number(val).toLocaleString()} MT`,
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <ChartBlockTitle info={t('v2WeeklySlaInfo')}>{t('v2WeeklySlaTitle')}</ChartBlockTitle>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyAxisCount')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle
          ariaLabel={`${t('v2WeeklySlaTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklySlaTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const slaVals = projectUpcomingSeries(
                data.map((w) => Number(w.slaAtRiskCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              const n = slaVals[i] ?? 0
              const h = weekIsUpcoming[i]
                ? data[lastActiveIdx]?.slaOverHoursSum
                : data[i].slaOverHoursSum
              const rows = [
                {
                  primary: t('v2WeeklyAxisCount'),
                  secondary: String(n),
                },
              ]
              if (h != null && Number.isFinite(Number(h))) {
                rows.push({ primary: t('v2WeeklyTipSlaOver', { h }) })
              }
              return withProjectedNote(rows, i)
            },
          }}
          series={[
            {
              key: 'sla',
              color: 'var(--v2-risk-color)',
              values: projectUpcomingSeries(
                data.map((w) => Number(w.slaAtRiskCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) =>
                weekIsUpcoming[i]
                  ? t('v2WeeklySlaProjectedTooltip', { range: weekLabels[i], n: val })
                  : t('v2WeeklySlaTooltip', {
                    range: weekLabels[i],
                    n: data[i].slaAtRiskCount,
                    h: data[i].slaOverHoursSum,
                  }),
            },
          ]}
        />
        <div className="v2-weekly__subnote">{t('v2WeeklySlaSub')}</div>
      </div>

      <div className="v2-weekly__block">
        <ChartBlockTitle info={t('v2WeeklyWaitInfo')}>{t('v2WeeklyWaitTitle')}</ChartBlockTitle>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyAxisHours')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle={false}
          ariaLabel={`${t('v2WeeklyWaitTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyWaitTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const vals = projectUpcomingSeries(
                data.map((w) => (w.waitingHoursMa != null ? Number(w.waitingHoursMa) : 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              const v = weekIsUpcoming[i] ? vals[i] : data[i].waitingHoursMa
              return withProjectedNote([
                {
                  primary: t('v2WeeklyWaitTitle'),
                  secondary: v == null || v === '' ? '—' : t('v2WeeklyWaitValue', { h: v }),
                },
              ], i)
            },
          }}
          series={[
            {
              key: 'wait',
              color: 'var(--v2-chart-atberth)',
              values: projectUpcomingSeries(
                data.map((w) => (w.waitingHoursMa != null ? Number(w.waitingHoursMa) : 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) =>
                `${weekLabels[i]}: ${t('v2WeeklyWaitValue', { h: val })}`,
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <ChartBlockTitle info={t('v2WeeklyAnchorageInfo')}>{t('v2WeeklyAnchorageTitle')}</ChartBlockTitle>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyAxisCount')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle={false}
          ariaLabel={`${t('v2WeeklyAnchorageTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyAnchorageTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const vals = projectUpcomingSeries(
                data.map((w) => Number(w.anchorageCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              return withProjectedNote([
                {
                  primary: t('v2WeeklyAnchorageTitle'),
                  secondary: String(vals[i] ?? 0),
                },
              ], i)
            },
          }}
          series={[
            {
              key: 'anchorage',
              color: 'var(--v2-chart-atberth)',
              values: projectUpcomingSeries(
                data.map((w) => Number(w.anchorageCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) => `${weekLabels[i]}: ${val}`,
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <ChartBlockTitle info={t('v2WeeklyAtBerthInfo')}>{t('v2WeeklyAtBerthTitle')}</ChartBlockTitle>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyAxisCount')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle={false}
          ariaLabel={`${t('v2WeeklyAtBerthTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyAtBerthTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const vals = projectUpcomingSeries(
                data.map((w) => Number(w.atBerthCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              )
              return withProjectedNote([
                {
                  primary: t('v2WeeklyAtBerthTitle'),
                  secondary: String(vals[i] ?? 0),
                },
              ], i)
            },
          }}
          series={[
            {
              key: 'atberth',
              color: 'var(--v2-chart-atberth)',
              values: projectUpcomingSeries(
                data.map((w) => Number(w.atBerthCount ?? 0)),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) => `${weekLabels[i]}: ${val}`,
            },
          ]}
        />
      </div>

      <div className="v2-weekly__block">
        <div className="v2-weekly__block-title-row v2-weekly__block-title-row--flow">
          <ChartBlockTitle info={t('v2WeeklyFlowInfo')}>{t('v2WeeklyFlowTitle')}</ChartBlockTitle>
          {flowOptions.length > 0 ? (
            <DropdownMultiSelect
              id="v2-weekly-flow-products"
              className="v2-filters__dropdown v2-weekly__flow-filter"
              panelClassName="v2-filters__panel"
              titleLabel={t('v2WeeklyFlowProductFilter')}
              placeholder={t('v2WeeklyFlowProductPlaceholder')}
              emptyText={t('v2WeeklyFlowProductEmpty')}
              options={flowOptions}
              selectedValues={selectedFlowCommodityIds}
              onChange={setSelectedFlowCommodityIds}
              searchable
              searchPlaceholder={t('v2WeeklyFlowProductSearch')}
            />
          ) : null}
          {flowEntries.length > 0 ? (
            <div className="v2-weekly__legend v2-weekly__legend--inline">
              {flowEntries.map((entry) => {
                const colorIdx = flowColorIndexForEntry(flowRanked, entry)
                return (
                  <span key={entry.commodityId} className="v2-weekly__legend-item">
                    <i
                      className="v2-weekly__legend-marker"
                      style={{ background: FLOW_LINE_COLORS[colorIdx % FLOW_LINE_COLORS.length] }}
                    />
                    {entry.code}
                  </span>
                )
              })}
            </div>
          ) : null}
        </div>
        <WeeklyLineChart
          weekLabels={weekLabels}
          weekIsUpcoming={weekIsUpcoming}
          yTitle={t('v2WeeklyAxisMtH')}
          xAxisTitle={t('v2WeeklyAxisWeek')}
          showXAxisTitle
          ariaLabel={`${t('v2WeeklyFlowTitle')}. ${rangeSub}`}
          weekTooltip={{
            subtitle: `${t('v2WeeklyFlowTitle')} · ${rangeSub}`,
            placement: 'left',
            itemsForWeek: (i) => {
              const items = flowEntries.map((entry) => {
                const vals = projectUpcomingSeries(
                  data.map((w) => flowRateForEntry(w, entry) ?? 0),
                  weekIsUpcoming,
                  lastActiveIdx,
                )
                const v = weekIsUpcoming[i] ? vals[i] : flowRateForEntry(data[i], entry)
                return {
                  primary: entry.code,
                  secondary: v == null ? '—' : t('v2WeeklyFlowValue', { rate: Number(v).toFixed(1) }),
                }
              })
              return withProjectedNote(items.length ? items : [{ primary: t('v2WeeklyFlowEmpty') }], i)
            },
          }}
          series={flowEntries.map((entry) => {
            const colorIdx = flowColorIndexForEntry(flowRanked, entry)
            return {
              key: `flow-${entry.commodityId}`,
              color: FLOW_LINE_COLORS[colorIdx % FLOW_LINE_COLORS.length],
              values: projectUpcomingSeries(
                data.map((w) => flowRateForEntry(w, entry) ?? 0),
                weekIsUpcoming,
                lastActiveIdx,
              ),
              pointTitle: (i, val) =>
                `${weekLabels[i]}: ${entry.code} ${t('v2WeeklyFlowValue', { rate: Number(val).toFixed(1) })}`,
            }
          })}
        />
      </div>
      </div>
    </section>
  )
}
