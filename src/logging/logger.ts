export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const REDACTED = '[redacted]'

const REDACT_KEYS = new Set([
  'token',
  'tokens',
  'authorization',
  'auth',
  'apikey',
  'api_key',
  'key',
  'secret',
  'prompt',
  'prompts',
  'message',
  'messages',
  'content',
  'reply',
  'arguments',
  'args',
  'payload',
  'body',
  'location',
  'locations',
  'phone',
  'phonenumber',
  'phone_number',
  'coordinates',
])

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
}

export interface CreateLoggerOptions {
  level: LogLevel
  redact: boolean
  sink?: (line: string) => void
  bindings?: Record<string, unknown>
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) {
    if (depth > 6) return '[truncated]'
    return value.map((item) => redactValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth > 6) return '[truncated]'
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        output[key] = REDACTED
      } else {
        output[key] = redactValue(nested, depth + 1)
      }
    }
    return output
  }
  return String(value)
}

function normalizeFields(
  fields: Record<string, unknown> | undefined,
  redact: boolean,
): Record<string, unknown> {
  if (!fields) return {}
  if (!redact) return fields
  return redactValue(fields, 0) as Record<string, unknown>
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`))
  const threshold = LEVEL_WEIGHT[options.level]
  const bindings = options.bindings ?? {}

  const log = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_WEIGHT[level] < threshold) return
    const record = {
      level,
      time: new Date().toISOString(),
      event,
      ...normalizeFields(bindings, options.redact),
      ...normalizeFields(fields, options.redact),
    }
    sink(JSON.stringify(record))
  }

  return {
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
    child: (childBindings) =>
      createLogger({ ...options, bindings: { ...bindings, ...childBindings } }),
  }
}
