import type { AgentConfig } from '../../src/config/config.js'
import type { Permission } from '../../src/auth/caller.js'
import { ConfirmationStore } from '../../src/confirmation/store.js'
import { ToolExecutor } from '../../src/conversation/tool-executor.js'
import { createApp } from '../../src/http/app.js'
import type { LLMProvider } from '../../src/llm/provider.js'
import type { Logger } from '../../src/logging/logger.js'
import { ToolRegistry, type ToolClassifier } from '../../src/mcp/registry.js'
import type { McpSourceManager, SourceStatus } from '../../src/mcp/source.js'
import { NotificationRecorder } from '../../src/notifications/contract.js'
import { makeToken, silentLogger, testConfig } from './sample-config.js'

export interface HarnessOptions {
  provider: LLMProvider
  registry?: ToolRegistry
  registerTools?: (registry: ToolRegistry, classify: ToolClassifier) => void
  sources?: McpSourceManager
  callTool?: (sourceId: string, name: string, args: Record<string, unknown>) => Promise<unknown>
  statuses?: SourceStatus[]
  config?: Partial<AgentConfig>
  confirmations?: ConfirmationStore
  logger?: Logger
  now?: () => number
  generateId?: () => string
  permissions?: Permission[]
}

export interface Harness {
  app: ReturnType<typeof createApp>
  auth: { authorization: string }
  token: ReturnType<typeof makeToken>
  config: AgentConfig
  provider: LLMProvider
  registry: ToolRegistry
  sources: McpSourceManager
  confirmations: ConfirmationStore
  logger: Logger
  notifications: NotificationRecorder
}

export function buildHarness(options: HarnessOptions): Harness {
  const token = makeToken('alice', options.permissions ?? ['read', 'write', 'destructive'])
  const config = testConfig({
    ...options.config,
    authTokens: { [token.tokenHash]: token.entry },
  })

  const registry = options.registry ?? new ToolRegistry()
  options.registerTools?.(registry, (_sourceId, originalName) =>
    originalName.includes('delete') ? 'destructive' : 'read',
  )

  const sources =
    options.sources ??
    ({
      callTool: options.callTool ?? (async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      statuses: () => options.statuses ?? [],
      list: () => [],
      get: () => undefined,
      connectAll: async () => undefined,
      closeAll: async () => undefined,
    } as unknown as McpSourceManager)

  const executor = new ToolExecutor({ registry, sources })
  const confirmations = options.confirmations ?? new ConfirmationStore({ ttlMs: 120000 })
  const logger = options.logger ?? silentLogger()
  const notifications = new NotificationRecorder()

  const app = createApp({
    config,
    provider: options.provider,
    registry,
    executor,
    confirmations,
    sources,
    notifications,
    logger,
    now: options.now,
    generateId: options.generateId,
  })

  return {
    app,
    auth: { authorization: `Bearer ${token.token}` },
    token,
    config,
    provider: options.provider,
    registry,
    sources,
    confirmations,
    logger,
    notifications,
  }
}

export function postJson(
  app: Harness['app'],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

export function getJson(
  app: Harness['app'],
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(app.request(path, { headers }))
}
