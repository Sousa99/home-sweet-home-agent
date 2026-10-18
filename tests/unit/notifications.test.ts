import { describe, expect, it } from 'vitest'
import {
  NotificationRecorder,
  toNotificationEvent,
  validateNotification,
} from '../../src/notifications/contract.js'

describe('notification contract', () => {
  it('accepts a well-formed event', () => {
    expect(
      validateNotification({
        type: 'bus.departure',
        severity: 'warning',
        payload: { stopId: '1', minutes: 3 },
      }),
    ).toEqual({ ok: true, issues: [] })
  })

  it('rejects an unknown type and missing payload', () => {
    expect(validateNotification({ type: 'nope', payload: {} }).ok).toBe(false)
    expect(validateNotification({ type: 'task.due' }).ok).toBe(false)
  })

  it('builds an event with a timestamp and records it', () => {
    const event = toNotificationEvent(
      { type: 'task.due', severity: 'info', payload: { id: 1 } },
      'n-1',
      () => 0,
    )
    expect(event.id).toBe('n-1')
    expect(event.receivedAt).toBe(new Date(0).toISOString())
    const recorder = new NotificationRecorder()
    recorder.record(event)
    expect(recorder.size).toBe(1)
    expect(recorder.list()[0].type).toBe('task.due')
  })
})
