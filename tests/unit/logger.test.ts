import { describe, expect, it } from 'vitest'
import { createLogger } from '../../src/logging/logger.js'

describe('logger redaction', () => {
  it('redacts sensitive fields by default', () => {
    const lines: string[] = []
    const logger = createLogger({ level: 'debug', redact: true, sink: (line) => lines.push(line) })

    logger.info('conversation.received', {
      conversationId: 'c-1',
      prompt: 'my secret prompt',
      token: 'secret-token',
      arguments: { stopId: 'private-stop' },
      location: 'home',
      nested: { message: 'hello there' },
    })

    const output = lines.join('\n')
    expect(output).not.toContain('my secret prompt')
    expect(output).not.toContain('secret-token')
    expect(output).not.toContain('private-stop')
    expect(output).not.toContain('hello there')
    expect(output).toContain('c-1')
    expect(output).toContain('[redacted]')
  })

  it('filters below the configured level', () => {
    const lines: string[] = []
    const logger = createLogger({ level: 'warn', redact: false, sink: (line) => lines.push(line) })
    logger.debug('a')
    logger.info('b')
    expect(lines).toHaveLength(0)
    logger.warn('c')
    expect(lines).toHaveLength(1)
  })
})
