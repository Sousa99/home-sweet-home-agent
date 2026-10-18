import { Hono } from 'hono'
import { z } from 'zod'
import { runConversation } from '../../conversation/loop.js'
import type { AppEnv, RouteDeps } from '../context.js'
import { AgentError } from '../errors.js'
import { readJsonBody } from '../read-json.js'

const bodySchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().min(1).optional(),
})

export function conversationRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/', async (c) => {
    const raw = await readJsonBody(c)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      throw new AgentError('malformed_request', 'A non-empty "message" is required.')
    }

    const caller = c.get('caller')
    const conversationId = parsed.data.conversationId ?? deps.generateId()

    const result = await runConversation({
      caller,
      conversationId,
      message: parsed.data.message,
      provider: deps.provider,
      registry: deps.registry,
      executor: deps.executor,
      confirmations: deps.confirmations,
      maxIterations: deps.config.maxToolIterations,
      maxToolResultChars: deps.config.maxToolResultChars,
      logger: deps.logger,
    })

    return c.json(result, 200)
  })

  return app
}
