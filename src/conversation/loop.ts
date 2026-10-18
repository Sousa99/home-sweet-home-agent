import type { CallerIdentity } from '../auth/caller.js'
import { hasPermission } from '../auth/caller.js'
import { permissionForPolicy } from '../config/policy.js'
import type { ConfirmationStore } from '../confirmation/store.js'
import { AgentError } from '../http/errors.js'
import type { ChatMessage, ChatToolDefinition, LLMProvider } from '../llm/provider.js'
import type { Logger } from '../logging/logger.js'
import type { ToolRegistry } from '../mcp/registry.js'
import { splitNamespacedTool } from '../mcp/registry.js'
import { isValidationFailure, type ToolExecutor } from './tool-executor.js'
import type { ConversationResult, ToolTraceEntry } from './types.js'

export interface RunConversationOptions {
  caller: CallerIdentity
  conversationId: string
  message: string
  provider: LLMProvider
  registry: ToolRegistry
  executor: ToolExecutor
  confirmations: ConfirmationStore
  maxIterations: number
  maxToolResultChars: number
  logger?: Logger
}

/** Bounds a tool result before it is fed back to the model. */
export function boundToolResult(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[truncated at ${maxChars} characters by the home-sweet-home agent]`
}

function failureFor(
  conversationId: string,
  error: unknown,
  trace: ToolTraceEntry[],
): ConversationResult {
  if (error instanceof AgentError) {
    return {
      conversationId,
      status: 'failed',
      error: { code: error.code, message: error.message },
      trace,
    }
  }
  return {
    conversationId,
    status: 'failed',
    error: { code: 'internal_error', message: 'The agent failed to complete the request.' },
    trace,
  }
}

export async function runConversation(
  options: RunConversationOptions,
): Promise<ConversationResult> {
  const { caller, conversationId, provider, registry, executor, confirmations, maxIterations } =
    options
  const logger = options.logger
  const trace: ToolTraceEntry[] = []

  const recordToolCall = (entry: ToolTraceEntry): void => {
    trace.push(entry)
    logger?.info('tool.call', {
      conversationId,
      tool: entry.tool,
      sourceId: entry.sourceId,
      policy: entry.policy,
      outcome: entry.outcome,
      durationMs: entry.durationMs,
    })
  }

  const messages: ChatMessage[] = [{ role: 'user', content: options.message }]
  const tools: ChatToolDefinition[] = registry
    .list()
    .filter((descriptor) => hasPermission(caller, permissionForPolicy(descriptor.policy)))
    .map((descriptor) => ({
      type: 'function',
      function: {
        name: descriptor.name,
        description: descriptor.description,
        parameters: descriptor.inputSchema,
      },
    }))

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let result
    try {
      result = await provider.chat({ messages, tools, sessionId: conversationId })
    } catch (error) {
      return failureFor(conversationId, error, trace)
    }

    if (result.type === 'message') {
      logger?.info('conversation.completed', { conversationId })
      return { conversationId, status: 'completed', reply: result.content, trace }
    }

    logger?.debug('llm.tool_calls', {
      conversationId,
      iteration,
      count: result.toolCalls.length,
    })

    messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })

    for (const call of result.toolCalls) {
      const descriptor = registry.get(call.name)
      const sourceId = descriptor?.sourceId ?? splitNamespacedTool(call.name)?.sourceId ?? 'unknown'

      const validation = executor.validate(call.name, call.arguments)
      if (isValidationFailure(validation)) {
        recordToolCall({
          tool: call.name,
          sourceId,
          ...(descriptor ? { policy: descriptor.policy } : {}),
          outcome: 'failed',
          durationMs: 0,
        })
        logger?.warn('tool.invalid', {
          conversationId,
          tool: call.name,
          code: validation.code,
          reason: validation.message,
        })
        return {
          conversationId,
          status: 'failed',
          error: { code: validation.code, message: validation.message },
          trace,
        }
      }

      const { descriptor: tool, args } = validation
      const permission = permissionForPolicy(tool.policy)
      if (!hasPermission(caller, permission)) {
        recordToolCall({
          tool: tool.name,
          sourceId: tool.sourceId,
          policy: tool.policy,
          outcome: 'failed',
          durationMs: 0,
        })
        return {
          conversationId,
          status: 'failed',
          error: {
            code: 'unauthorized',
            message: `The caller lacks the ${permission} permission.`,
          },
          trace,
        }
      }

      if (tool.policy === 'destructive') {
        const entry = confirmations.create({
          callerId: caller.callerId,
          conversationId,
          sourceId: tool.sourceId,
          toolName: tool.name,
          args,
        })
        recordToolCall({
          tool: tool.name,
          sourceId: tool.sourceId,
          policy: tool.policy,
          outcome: 'confirmation_required',
          durationMs: 0,
        })
        logger?.info('conversation.confirmation_required', {
          conversationId,
          tool: tool.name,
        })
        return {
          conversationId,
          status: 'confirmation_required',
          reply: `I can run ${tool.name}, but I need your confirmation before doing that.`,
          confirmation: {
            token: entry.token,
            tool: tool.name,
            argumentsPreview: args,
            expiresAt: new Date(entry.expiresAt).toISOString(),
          },
          trace,
        }
      }

      const startedAt = Date.now()
      const execution = await executor.execute(tool, args)
      const durationMs = Date.now() - startedAt

      if (!execution.ok) {
        recordToolCall({
          tool: tool.name,
          sourceId: tool.sourceId,
          policy: tool.policy,
          outcome: 'failed',
          durationMs,
        })
        logger?.warn('tool.failed', {
          conversationId,
          tool: tool.name,
          code: execution.code,
        })
        return {
          conversationId,
          status: 'failed',
          error: { code: execution.code, message: execution.message },
          trace,
        }
      }

      recordToolCall({
        tool: tool.name,
        sourceId: tool.sourceId,
        policy: tool.policy,
        outcome: 'executed',
        durationMs,
      })

      messages.push({
        role: 'tool',
        content: boundToolResult(execution.text, options.maxToolResultChars),
        toolCallId: call.id,
      })
    }
  }

  return {
    conversationId,
    status: 'failed',
    error: { code: 'internal_error', message: 'The agent exceeded the tool iteration limit.' },
    trace,
  }
}
