import assert from 'node:assert/strict'
import test from 'node:test'
import {
  operationalActivityEventStatus,
  operationalActivityEventStatusForTimeline,
  START_ONLY_MILESTONE_KEYS,
} from './operationalActivityEventStatus.js'

test('START_ONLY_MILESTONE_KEYS matches opening and pre-conditioning', () => {
  assert.ok(START_ONLY_MILESTONE_KEYS.has('opening_hatch'))
  assert.ok(START_ONLY_MILESTONE_KEYS.has('cargo_pre_conditioning'))
  assert.equal(START_ONLY_MILESTONE_KEYS.size, 2)
})

test('opening_hatch: start + method → Done; start only → In progress', () => {
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'opening_hatch',
      startAt: '2026-07-16T08:40:00.000Z',
      cargoHandlingMethodName: 'Conveyor',
    }),
    'Done'
  )
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'opening_hatch',
      startAt: '2026-07-16T08:40:00.000Z',
    }),
    'In progress'
  )
})

test('cargo_pre_conditioning: start only → Done', () => {
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'cargo_pre_conditioning',
      startAt: '2026-07-16T10:22:00.000Z',
      remark: 'N/a',
    }),
    'Done'
  )
})

test('cargo_operations: open load line → In progress; closed line / endAt → Done', () => {
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'cargo_operations',
      startAt: '2026-07-16T12:00:00.000Z',
      cargoLoadLines: [{ startAt: '2026-07-16T12:00:00.000Z', endAt: null }],
    }),
    'In progress'
  )
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'cargo_operations',
      startAt: '2026-07-16T12:00:00.000Z',
      endAt: '2026-07-18T14:00:00.000Z',
    }),
    'Done'
  )
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'cargo_operations',
      startAt: '2026-07-16T12:00:00.000Z',
      cargoLoadLines: [
        { startedAt: '2026-07-16T12:00:00.000Z', endedAt: '2026-07-16T14:00:00.000Z' },
      ],
    }),
    'Done'
  )
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'cargo_operations',
      startAt: '2026-07-16T12:00:00.000Z',
      cargoLoadLines: [],
    }),
    'In progress'
  )
})

test('other: start only → In progress; endAt → Done', () => {
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'other',
      startAt: '2026-07-18T14:52:00.000Z',
    }),
    'In progress'
  )
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_activity',
      milestoneKey: 'other',
      startAt: '2026-07-18T14:52:00.000Z',
      endAt: '2026-07-18T14:52:00.000Z',
    }),
    'Done'
  )
})

test('sub_process passthrough status; milestone_na → N/A', () => {
  assert.equal(
    operationalActivityEventStatus({
      source: 'sub_process',
      status: 'Done',
      startAt: '2026-07-15T08:00:00.000Z',
    }),
    'Done'
  )
  assert.equal(
    operationalActivityEventStatus({
      source: 'operational_milestone_na',
      milestoneKey: 'cargo_pre_conditioning',
    }),
    'N/A'
  )
})

test('operationalActivityEventStatusForTimeline title-cases In progress', () => {
  assert.equal(
    operationalActivityEventStatusForTimeline({
      source: 'operational_activity',
      milestoneKey: 'other',
      startAt: '2026-07-18T14:52:00.000Z',
    }),
    'In Progress'
  )
  assert.equal(
    operationalActivityEventStatusForTimeline({
      source: 'operational_activity',
      milestoneKey: 'opening_hatch',
      startAt: '2026-07-16T08:40:00.000Z',
      cargoHandlingMethodId: '1',
    }),
    'Done'
  )
})
