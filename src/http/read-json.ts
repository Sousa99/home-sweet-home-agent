import { AgentError } from './errors.js'
import type { Context } from 'hono'

export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw new AgentError('malformed_request', 'The request body is not valid JSON.')
  }
}
