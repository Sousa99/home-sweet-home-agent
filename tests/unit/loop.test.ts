import { describe, expect, it } from 'vitest'
import { boundToolResult } from '../../src/conversation/loop.js'

describe('boundToolResult', () => {
  it('returns short results unchanged', () => {
    expect(boundToolResult('hello', 10)).toBe('hello')
  })

  it('truncates oversized results with a marker', () => {
    const output = boundToolResult('x'.repeat(100), 10)
    expect(output.startsWith('x'.repeat(10))).toBe(true)
    expect(output).toContain('truncated at 10 characters')
    expect(output.length).toBeLessThan(100)
  })

  it('treats a non-positive limit as unlimited', () => {
    expect(boundToolResult('abc', 0)).toBe('abc')
  })
})
