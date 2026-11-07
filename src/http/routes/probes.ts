import { Hono } from 'hono'
import { AGENT_NAME, AGENT_VERSION } from '../../version.js'
import type { AppEnv, RouteDeps } from '../context.js'

function mcpSummary(deps: RouteDeps): Record<string, { status: string; tools: number }> {
  const summary: Record<string, { status: string; tools: number }> = {}
  for (const status of deps.sources.statuses()) {
    summary[status.sourceId] = { status: status.state, tools: status.toolCount }
  }
  return summary
}

export function probeRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/healthz', (c) =>
    c.json({ status: 'ok', service: AGENT_NAME, version: AGENT_VERSION }, 200),
  )

  app.get('/readyz', async (c) => {
    const readiness = await deps.provider.checkReady()
    const llm = {
      ready: readiness.ready,
      provider: readiness.provider,
      model: readiness.model,
    }
    const mcp = mcpSummary(deps)

    if (deps.isDraining()) {
      return c.json({ status: 'draining', service: AGENT_NAME, llm, mcp }, 503)
    }
    if (!readiness.ready) {
      return c.json({ status: 'not_ready', service: AGENT_NAME, llm, mcp }, 503)
    }
    return c.json({ status: 'ok', service: AGENT_NAME, llm, mcp }, 200)
  })

  return app
}
