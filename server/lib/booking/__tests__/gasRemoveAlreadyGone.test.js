import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isGasCalendarEventMissingError,
  isGasReservedRemoveCalendarAlreadyGone,
} from '../../bookingCalendarSync.js'

describe('isGasReservedRemoveCalendarAlreadyGone', () => {
  it('treats occurrence not found as gone for reserved Remove', () => {
    const msg =
      'Calendar event occurrence not found [gas:2026-07-25-instance-remove-not-found-block]'
    assert.equal(isGasReservedRemoveCalendarAlreadyGone(msg), true)
    // Confirm-reserved path must keep treating this as NOT idempotent missing.
    assert.equal(isGasCalendarEventMissingError(msg), false)
  })

  it('treats instance-remove-not-found tag as gone', () => {
    assert.equal(
      isGasReservedRemoveCalendarAlreadyGone('blocked [gas:instance-remove-not-found]'),
      true
    )
  })

  it('still treats generic calendar not found as gone', () => {
    assert.equal(isGasReservedRemoveCalendarAlreadyGone('Calendar event not found'), true)
    assert.equal(isGasCalendarEventMissingError('Calendar event not found'), true)
  })

  it('does not treat series-master refuse as gone', () => {
    assert.equal(
      isGasReservedRemoveCalendarAlreadyGone('Refusing to delete series master'),
      false
    )
  })
})
