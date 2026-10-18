import { describe, expect, it } from 'vitest'
import { hasPermission } from '../../src/auth/caller.js'
import { generateTokenEntry } from '../../src/auth/token-tool.js'
import { authenticate, findTokenEntry, parseBearer } from '../../src/auth/tokens.js'

describe('auth tokens', () => {
  const { token, tokenHash, entry } = generateTokenEntry({
    callerId: 'sousa',
    permissions: ['read', 'write'],
  })
  const map = { [tokenHash]: entry }

  it('finds a token by its raw value', () => {
    expect(findTokenEntry(token, map)).toEqual(entry)
  })

  it('rejects an unknown token', () => {
    expect(findTokenEntry('nope', map)).toBeNull()
  })

  it('authenticates to a caller identity', () => {
    expect(authenticate(token, map)).toEqual({ callerId: 'sousa', permissions: ['read', 'write'] })
  })

  it('parses bearer headers', () => {
    expect(parseBearer('Bearer abc')).toBe('abc')
    expect(parseBearer('bearer  abc ')).toBe('abc')
    expect(parseBearer('Token abc')).toBeNull()
    expect(parseBearer(undefined)).toBeNull()
  })

  it('checks permissions', () => {
    expect(hasPermission({ callerId: 'x', permissions: ['read'] }, 'read')).toBe(true)
    expect(hasPermission({ callerId: 'x', permissions: ['read'] }, 'write')).toBe(false)
  })
})
