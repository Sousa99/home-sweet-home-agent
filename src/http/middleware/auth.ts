import type { MiddlewareHandler } from 'hono'
import type { TokenMap } from '../../auth/tokens.js'
import { findTokenEntry, parseBearer } from '../../auth/tokens.js'
import type { AppEnv } from '../context.js'
import { AgentError } from '../errors.js'

export interface AuthMiddlewareOptions {
  /** Exact request paths that bypass bearer authentication (for example, probes). */
  publicPaths?: string[]
}

export function createAuthMiddleware(
  tokens: TokenMap,
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  const publicPaths = new Set(options.publicPaths ?? [])

  return async (c, next) => {
    if (publicPaths.has(c.req.path)) {
      await next()
      return
    }

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
