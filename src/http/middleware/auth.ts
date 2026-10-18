import type { MiddlewareHandler } from 'hono'
import type { TokenMap } from '../../auth/tokens.js'
import { findTokenEntry, parseBearer } from '../../auth/tokens.js'
import type { AppEnv } from '../context.js'
import { AgentError } from '../errors.js'

export function createAuthMiddleware(tokens: TokenMap): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = parseBearer(c.req.header('authorization'))
    if (!token) {
      throw new AgentError('unauthorized')
    }

    const entry = findTokenEntry(token, tokens)
    if (!entry) {
      throw new AgentError('unauthorized')
    }

    c.set('caller', { callerId: entry.callerId, permissions: entry.permissions })
    await next()
  }
}
