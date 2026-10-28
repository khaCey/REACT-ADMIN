import test from 'node:test'
import assert from 'node:assert/strict'
import { getCalendarSyncDisplayState } from '../calendarSyncDisplay.js'

test('queued Calendar styling is not labelled as a missing booking sync', () => {
  assert.equal(getCalendarSyncDisplayState('failed', '[calendar-style] Pending Calendar update'), 'calendar_style_pending')
})
test('failed styling is distinguished from a booking sync failure', () => {
  assert.equal(getCalendarSyncDisplayState('failed', '[calendar-style] API unavailable'), 'calendar_style_failed')
})
test('actual booking sync failures remain failures', () => {
  assert.equal(getCalendarSyncDisplayState('failed', 'GAS booking failed (404)'), 'sync_failed')
})
test('new booking and synced statuses remain unchanged', () => {
  assert.equal(getCalendarSyncDisplayState('pending', null), 'calendar_pending')
  assert.equal(getCalendarSyncDisplayState('synced', null), 'synced')
})
