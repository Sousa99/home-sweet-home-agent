import { describe, expect, it } from 'vitest'
import { ConfirmationStore } from '../../src/confirmation/store.js'

function store(now: () => number): ConfirmationStore {
  return new ConfirmationStore({ ttlMs: 1000, now, generateToken: () => 'token-1' })
}

const draft = {
  callerId: 'alice',
  conversationId: 'c-1',
  sourceId: 'tasks',
  toolName: 'tasks.task.delete',
  args: { id: 42 },
}

describe('ConfirmationStore', () => {
  it('creates a pending entry bound to caller and arguments', () => {
    const s = store(() => 0)
    const entry = s.create(draft)
    expect(entry.token).toBe('token-1')
    expect(entry.state).toBe('pending')
    expect(entry.argumentsHash).toHaveLength(64)
  })

  it('claims once and rejects replay', () => {
    const s = store(() => 0)
    s.create(draft)
    const first = s.claim('token-1', 'alice')
    expect(first.ok).toBe(true)
    expect(s.claim('token-1', 'alice')).toEqual({ ok: false, code: 'confirmation_invalid' })
  })

  it('rejects a different caller', () => {
    const s = store(() => 0)
    s.create(draft)
    expect(s.claim('token-1', 'mallory')).toEqual({ ok: false, code: 'confirmation_invalid' })
  })

  it('expires after the TTL', () => {
    let now = 0
    const s = store(() => now)
    s.create(draft)
    now = 2000
    expect(s.claim('token-1', 'alice')).toEqual({ ok: false, code: 'confirmation_expired' })
  })

  it('rejects rather than claims on reject', () => {
    const s = store(() => 0)
    s.create(draft)
    expect(s.reject('token-1', 'alice').ok).toBe(true)
    expect(s.claim('token-1', 'alice')).toEqual({ ok: false, code: 'confirmation_invalid' })
  })

  it('rejects an unknown token on reject', () => {
    const s = store(() => 0)
    expect(s.reject('missing', 'alice')).toEqual({ ok: false, code: 'confirmation_invalid' })
  })
})
