import { describe, expect, it } from 'vitest'
import { generateTokenEntry, hashToken } from '../../src/auth/token-tool.js'

describe('token tool', () => {
  it('hashes deterministically to 64 hex characters', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('abc')).not.toBe(hashToken('abcd'))
  })

  it('generates a token and its hashed entry', () => {
    const generated = generateTokenEntry({ callerId: 'a', permissions: ['read'] })
    expect(generated.token.length).toBeGreaterThan(20)
    expect(generated.tokenHash).toBe(hashToken(generated.token))
    expect(generated.entry).toEqual({ callerId: 'a', permissions: ['read'] })
  })

  it('deduplicates permissions', () => {
    const generated = generateTokenEntry({
      callerId: 'a',
      permissions: ['read', 'read', 'write'],
    })
    expect(generated.entry.permissions).toEqual(['read', 'write'])
  })

  it('rejects invalid input', () => {
    expect(() => generateTokenEntry({ callerId: '  ', permissions: ['read'] })).toThrow()
    expect(() => generateTokenEntry({ callerId: 'a', permissions: [] })).toThrow()
    expect(() => generateTokenEntry({ callerId: 'a', permissions: ['admin' as never] })).toThrow(
      /unknown permission/,
    )
  })
})
