import { Hono } from 'hono'
import type { AppEnv, RouteDeps } from '../context.js'

export function healthRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const statuses = deps.sources.statuses()
    const llm = await deps.provider.checkReady()

    const anySourceReady = statuses.some((status) => status.state === 'ready')
    const allSourcesReady =
      statuses.length > 0 && statuses.every((status) => status.state === 'ready')

    let overall: 'ok' | 'degraded' | 'down'
    if (allSourcesReady && llm.ready) {
      overall = 'ok'
    } else if (anySourceReady || llm.ready) {
      overall = 'degraded'
    } else {
      overall = 'down'
    }

    const mcp: Record<string, unknown> = {}
    for (const status of statuses) {
      mcp[status.sourceId] = {
        status: status.state,
        tools: status.toolCount,
        ...(status.error ? { error: status.error } : {}),
      }
    }

    return c.json({
      status: overall,
      service: 'home-sweet-home-agent',
      mcp,
      llm: { ready: llm.ready, provider: deps.provider.id, model: deps.provider.model },
    })
  })

  return app
}
