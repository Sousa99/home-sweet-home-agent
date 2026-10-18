import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { Permission } from '../auth/caller.js'
import type { TokenEntry } from '../auth/token-tool.js'
import type { LLMProviderConfig } from '../llm/provider.js'
import type { LogLevel } from '../logging/logger.js'
import type { ToolPolicy } from './policy.js'

export interface McpSourceConfig {
  sourceId: string
  url: string
}

export interface AgentConfig {
  host: string
  port: number
  mcpTimeoutMs: number
  mcpSources: McpSourceConfig[]
  authTokens: Record<string, TokenEntry>
  confirmationTtlMs: number
  maxToolIterations: number
  maxToolResultChars: number
  unknownToolPolicy: ToolPolicy
  logLevel: LogLevel
  redact: boolean
  llm: LLMProviderConfig
}

const permissionSchema = z.enum(['read', 'write', 'destructive'])

const tokenEntrySchema = z.object({
  callerId: z.string().min(1),
  permissions: z.array(permissionSchema).min(1),
})

const tokenMapSchema = z.record(z.string(), tokenEntrySchema)

const envSchema = z.object({
  AGENT_HOST: z.string().min(1).default('127.0.0.1'),
  AGENT_PORT: z.coerce.number().int().positive().default(3400),
  BUS_MCP_URL: z.string().min(1).default('http://localhost:3200/mcp'),
  FLIGHTS_MCP_URL: z.string().min(1).default('http://localhost:3201/mcp'),
  TASKS_MCP_URL: z.string().min(1).default('http://localhost:3202/mcp'),
  WEATHER_MCP_URL: z.string().min(1).default('http://localhost:3203/mcp'),
  MCP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  LLM_PROVIDER: z.enum(['openai-compatible']).default('openai-compatible'),
  LLM_BASE_URL: z.string().min(1).default('https://opencode.ai/inference/go/openai/v1'),
  LLM_MODEL: z.string().min(1).default('deepseek-v4.1-flash'),
  LLM_API_KEY: z.string().default(''),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AGENT_AUTH_TOKENS: z.string().default('{}'),
  AGENT_TOKENS_FILE: z.string().default(''),
  CONFIRMATION_TTL_MS: z.coerce.number().int().positive().default(120000),
  AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(4),
  AGENT_MAX_TOOL_RESULT_CHARS: z.coerce.number().int().positive().default(8000),
  AGENT_UNKNOWN_TOOL_POLICY: z.enum(['read', 'write', 'destructive']).default('destructive'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_REDACT: z.enum(['true', 'false']).default('true'),
})

type EnvInput = Record<string, string | undefined>

export function parseTokenMap(raw: string): Record<string, TokenEntry> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('AGENT_AUTH_TOKENS must be valid JSON')
  }

  const result = tokenMapSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ')
    throw new Error(`AGENT_AUTH_TOKENS is invalid: ${issues}`)
  }

  const entries: Record<string, TokenEntry> = {}
  for (const [hash, entry] of Object.entries(result.data)) {
    if (hash.length !== 64) {
      throw new Error('AGENT_AUTH_TOKENS keys must be sha-256 hex digests (64 characters)')
    }
    entries[hash] = { callerId: entry.callerId, permissions: entry.permissions as Permission[] }
  }
  return entries
}

export function readTokenFile(path: string): Record<string, TokenEntry> {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`AGENT_TOKENS_FILE could not be read: ${path}`)
  }
  return parseTokenMap(content)
}

function mergeTokenMaps(
  base: Record<string, TokenEntry>,
  override: Record<string, TokenEntry>,
): Record<string, TokenEntry> {
  return { ...base, ...override }
}

function validateUrl(value: string, name: string): string {
  try {
    new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  return value
}

export function loadConfig(env: EnvInput = process.env as EnvInput): AgentConfig {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid configuration: ${issues}`)
  }

  const e = result.data

  const mcpSources: McpSourceConfig[] = [
    { sourceId: 'bus', url: validateUrl(e.BUS_MCP_URL, 'BUS_MCP_URL') },
    { sourceId: 'flights', url: validateUrl(e.FLIGHTS_MCP_URL, 'FLIGHTS_MCP_URL') },
    { sourceId: 'tasks', url: validateUrl(e.TASKS_MCP_URL, 'TASKS_MCP_URL') },
    { sourceId: 'weather', url: validateUrl(e.WEATHER_MCP_URL, 'WEATHER_MCP_URL') },
  ]

  const fileTokens = e.AGENT_TOKENS_FILE ? readTokenFile(e.AGENT_TOKENS_FILE) : {}
  const inlineTokens = parseTokenMap(e.AGENT_AUTH_TOKENS)

  return {
    host: e.AGENT_HOST,
    port: e.AGENT_PORT,
    mcpTimeoutMs: e.MCP_TIMEOUT_MS,
    mcpSources,
    authTokens: mergeTokenMaps(fileTokens, inlineTokens),
    confirmationTtlMs: e.CONFIRMATION_TTL_MS,
    maxToolIterations: e.AGENT_MAX_TOOL_ITERATIONS,
    maxToolResultChars: e.AGENT_MAX_TOOL_RESULT_CHARS,
    unknownToolPolicy: e.AGENT_UNKNOWN_TOOL_POLICY,
    logLevel: e.LOG_LEVEL,
    redact: e.LOG_REDACT === 'true',
    llm: {
      kind: e.LLM_PROVIDER,
      baseUrl: e.LLM_BASE_URL,
      model: e.LLM_MODEL,
      apiKey: e.LLM_API_KEY,
      timeoutMs: e.LLM_TIMEOUT_MS,
    },
  }
}
