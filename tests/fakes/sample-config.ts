import type { Permission } from '../../src/auth/caller.js'
import { generateTokenEntry, type TokenEntry } from '../../src/auth/token-tool.js'
import type { AgentConfig } from '../../src/config/config.js'
import { createLogger, type Logger } from '../../src/logging/logger.js'

export interface FakeToken {
  token: string
  tokenHash: string
  entry: TokenEntry
}

export function makeToken(callerId: string, permissions: Permission[], token?: string): FakeToken {
  return generateTokenEntry({ callerId, permissions, token })
}

export function testConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const base: AgentConfig = {
    host: '127.0.0.1',
    port: 3400,
    mcpTimeoutMs: 2000,
    mcpSources: [],
    authTokens: {},
    confirmationTtlMs: 120000,
    maxToolIterations: 4,
    maxToolResultChars: 8000,
    unknownToolPolicy: 'destructive',
    logLevel: 'error',
    redact: true,
    llm: {
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'fake-model',
      apiKey: '',
      timeoutMs: 1000,
    },
  }
  return { ...base, ...overrides }
}

export function silentLogger(bindings: Record<string, unknown> = {}): Logger {
  return createLogger({ level: 'error', redact: true, sink: () => undefined, bindings })
}

export function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const logger = createLogger({
    level: 'debug',
    redact: true,
    sink: (line) => lines.push(line),
  })
  return { logger, lines }
}
