import { Hono } from 'hono'
import { z } from 'zod'
import { hasPermission } from '../../auth/caller.js'
import { permissionForPolicy } from '../../config/policy.js'
import { isValidationFailure } from '../../conversation/tool-executor.js'
import type { ToolTraceEntry } from '../../conversation/types.js'
import type { ToolPolicy } from '../../config/policy.js'
import type { AppEnv, RouteDeps } from '../context.js'
import { AgentError } from '../errors.js'
import { readJsonBody } from '../read-json.js'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  confirmationToken: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
})

function policyOf(deps: RouteDeps, toolName: string): ToolPolicy | undefined {
  return deps.registry.get(toolName)?.policy
}

export function confirmRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/', async (c) => {
    const raw = await readJsonBody(c)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      throw new AgentError(
        'malformed_request',
        '"conversationId", "confirmationToken", and "decision" are required.',
      )
    }

    const caller = c.get('caller')
    const { conversationId, confirmationToken, decision } = parsed.data

    if (decision === 'reject') {
      const rejected = deps.confirmations.reject(confirmationToken, caller.callerId)
      if (!rejected.ok) throw new AgentError(rejected.code)
      const entry = rejected.entry
      const trace: ToolTraceEntry[] = [
        {
          tool: entry.toolName,
          sourceId: entry.sourceId,
          policy: policyOf(deps, entry.toolName),
          outcome: 'rejected',
          durationMs: 0,
        },
      ]
      deps.logger.info('tool.call', {
        conversationId,
        tool: entry.toolName,
        sourceId: entry.sourceId,
        policy: policyOf(deps, entry.toolName),
        outcome: 'rejected',
        durationMs: 0,
      })
      deps.logger.info('confirmation.rejected', { conversationId })
      return c.json(
        {
          conversationId,
          status: 'completed',
          reply: 'Okay, I did not perform that action.',
          trace,
        },
        200,
      )
    }

    const claimed = deps.confirmations.claim(confirmationToken, caller.callerId)
    if (!claimed.ok) throw new AgentError(claimed.code)
    const entry = claimed.entry

    const validation = deps.executor.validate(entry.toolName, entry.args)
    if (isValidationFailure(validation)) {
      throw new AgentError(validation.code, validation.message)
    }

    const permission = permissionForPolicy(validation.descriptor.policy)
    if (!hasPermission(caller, permission)) {
      throw new AgentError('unauthorized')
    }

    const startedAt = Date.now()
    const execution = await deps.executor.execute(validation.descriptor, validation.args)
    const durationMs = Date.now() - startedAt

    const traceEntry: ToolTraceEntry = {
      tool: entry.toolName,
      sourceId: entry.sourceId,
      policy: validation.descriptor.policy,
      outcome: execution.ok && !execution.isError ? 'executed' : 'failed',
      durationMs,
    }
    deps.logger.info('tool.call', {
      conversationId,
      tool: traceEntry.tool,
      sourceId: traceEntry.sourceId,
      policy: traceEntry.policy,
      outcome: traceEntry.outcome,
      durationMs,
    })

    if (!execution.ok) {
      return c.json(
        {
          conversationId,
          status: 'failed',
          error: { code: execution.code, message: execution.message },
          trace: [traceEntry],
        },
        200,
      )
    }
    if (execution.isError) {
      return c.json(
        {
          conversationId,
          status: 'failed',
          error: { code: 'internal_error', message: 'The tool reported an error.' },
          trace: [traceEntry],
        },
        200,
      )
    }

    deps.logger.info('confirmation.executed', { conversationId, tool: entry.toolName })
    return c.json(
      {
        conversationId,
        status: 'completed',
        reply: execution.text || 'Done.',
        trace: [traceEntry],
      },
      200,
    )
  })

  return app
}
