import type { CallerIdentity } from '../auth/caller.js'
import type { AgentConfig } from '../config/config.js'
import type { ConfirmationStore } from '../confirmation/store.js'
import type { LLMProvider } from '../llm/provider.js'
import type { Logger } from '../logging/logger.js'
import type { ToolRegistry } from '../mcp/registry.js'
import type { McpSourceManager } from '../mcp/source.js'
import type { NotificationRecorder } from '../notifications/contract.js'
import type { ToolExecutor } from '../conversation/tool-executor.js'

export type AppEnv = { Variables: { caller: CallerIdentity } }

export interface RouteDeps {
  config: AgentConfig
  provider: LLMProvider
  registry: ToolRegistry
  executor: ToolExecutor
  confirmations: ConfirmationStore
  sources: McpSourceManager
  notifications: NotificationRecorder
  logger: Logger
  now: () => number
  generateId: () => string
}
