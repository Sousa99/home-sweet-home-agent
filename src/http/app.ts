import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AgentConfig } from '../config/config.js'
import type { ConfirmationStore } from '../confirmation/store.js'
import type { ToolExecutor } from '../conversation/tool-executor.js'
import type { LLMProvider } from '../llm/provider.js'
import type { Logger } from '../logging/logger.js'
import type { ToolRegistry } from '../mcp/registry.js'
import type { McpSourceManager } from '../mcp/source.js'
import type { NotificationRecorder } from '../notifications/contract.js'
import type { AppEnv, RouteDeps } from './context.js'
import { errorBody, toErrorResponse } from './errors.js'
import { createAuthMiddleware } from './middleware/auth.js'
import { confirmRoutes } from './routes/confirm.js'
import { conversationRoutes } from './routes/conversation.js'
import { healthRoutes } from './routes/health.js'
import { notificationRoutes } from './routes/notifications.js'

export interface AppDeps {
  config: AgentConfig
  provider: LLMProvider
  registry: ToolRegistry
  executor: ToolExecutor
  confirmations: ConfirmationStore
  sources: McpSourceManager
  notifications: NotificationRecorder
  logger: Logger
  now?: () => number
  generateId?: () => string
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const routeDeps: RouteDeps = {
    config: deps.config,
    provider: deps.provider,
    registry: deps.registry,
    executor: deps.executor,
    confirmations: deps.confirmations,
    sources: deps.sources,
    notifications: deps.notifications,
    logger: deps.logger,
    now: deps.now ?? (() => Date.now()),
    generateId: deps.generateId ?? (() => randomUUID()),
  }

  const app = new Hono<AppEnv>()

  app.use('*', createAuthMiddleware(deps.config.authTokens))
  app.route('/conversation', conversationRoutes(routeDeps))
  app.route('/confirm', confirmRoutes(routeDeps))
  app.route('/notifications', notificationRoutes(routeDeps))
  app.route('/health', healthRoutes(routeDeps))

  app.notFound((c) => c.json(errorBody('malformed_request', 'Route not found.'), 404))

  app.onError((error, c) => {
    const { status, body } = toErrorResponse(error)
    if (status >= 500) {
      deps.logger.error('http.error', { code: body.error.code })
    } else {
      deps.logger.warn('http.rejected', { code: body.error.code, status })
    }
    return c.json(body, status as ContentfulStatusCode)
  })

  return app
}
