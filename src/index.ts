import { serve } from '@hono/node-server'
import { loadConfig } from './config/config.js'
import { classifyTool } from './config/policy.js'
import { ConfirmationStore } from './confirmation/store.js'
import { ToolExecutor } from './conversation/tool-executor.js'
import { createApp } from './http/app.js'
import { createProvider } from './llm/index.js'
import { createLogger } from './logging/logger.js'
import { ToolRegistry } from './mcp/registry.js'
import { McpSource, McpSourceManager } from './mcp/source.js'
import { NotificationRecorder } from './notifications/contract.js'

// Load a local .env when present so `pnpm dev` and `node dist/index.js` pick up
// deployment configuration without extra CLI flags. Missing file is fine.
try {
  process.loadEnvFile()
} catch {
  // no .env file present; rely on the ambient environment
}

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger({ level: config.logLevel, redact: config.redact })

  const registry = new ToolRegistry()
  const classify = (sourceId: string, originalName: string): ReturnType<typeof classifyTool> =>
    classifyTool(sourceId, originalName, config.unknownToolPolicy)

  const sources = new McpSourceManager(
    config.mcpSources.map(
      (source) =>
        new McpSource({
          sourceId: source.sourceId,
          url: source.url,
          timeoutMs: config.mcpTimeoutMs,
          registry,
          classify,
          logger,
        }),
    ),
  )

  await sources.connectAll()

  const provider = createProvider(config.llm)
  const executor = new ToolExecutor({ registry, sources })
  const confirmations = new ConfirmationStore({ ttlMs: config.confirmationTtlMs })
  const notifications = new NotificationRecorder()

  const app = createApp({
    config,
    provider,
    registry,
    executor,
    confirmations,
    sources,
    notifications,
    logger,
  })

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    logger.info('agent.listening', { host: config.host, port: info.port })
  })

  const shutdown = (): void => {
    logger.info('agent.stopping', {})
    server.close()
    void sources.closeAll().finally(() => process.exit(0))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error'
  process.stderr.write(`home-sweet-home-agent failed to start: ${message}\n`)
  process.exit(1)
})
