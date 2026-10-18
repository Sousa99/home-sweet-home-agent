import { describe, expect, it } from 'vitest'
import type { CallerIdentity } from '../../src/auth/caller.js'
import { ConfirmationStore } from '../../src/confirmation/store.js'
import { runConversation } from '../../src/conversation/loop.js'
import { ToolExecutor } from '../../src/conversation/tool-executor.js'
import { AgentError } from '../../src/http/errors.js'
import { namespaceTool, ToolRegistry } from '../../src/mcp/registry.js'
import type { McpSourceManager } from '../../src/mcp/source.js'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { silentLogger } from '../fakes/sample-config.js'

const caller: CallerIdentity = {
  callerId: 'alice',
  permissions: ['read', 'write', 'destructive'],
}

function setup(options: {
  register: (registry: ToolRegistry) => void
  callTool?: () => Promise<unknown>
}) {
  const registry = new ToolRegistry()
  options.register(registry)
  const sources = {
    callTool: options.callTool ?? (async () => ({ content: [{ type: 'text', text: 'ok' }] })),
  } as unknown as McpSourceManager
  return {
    registry,
    executor: new ToolExecutor({ registry, sources }),
    confirmations: new ConfirmationStore({ ttlMs: 1000 }),
  }
}

function run(
  deps: ReturnType<typeof setup>,
  provider: FakeLLMProvider,
): ReturnType<typeof runConversation> {
  return runConversation({
    caller,
    conversationId: 'c-1',
    message: 'hi',
    provider,
    registry: deps.registry,
    executor: deps.executor,
    confirmations: deps.confirmations,
    maxIterations: 4,
    maxToolResultChars: 8000,
    logger: silentLogger(),
  })
}

describe('conversation tool trace', () => {
  it('records an executed read tool', async () => {
    const deps = setup({
      register: (registry) =>
        registry.registerSource(
          'bus',
          [
            {
              name: 'get_stop_times',
              inputSchema: {
                type: 'object',
                properties: { stopId: { type: 'string' } },
                required: ['stopId'],
              },
            },
          ],
          () => 'read',
        ),
    })
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: namespaceTool('bus', 'get_stop_times'), args: { stopId: '1' } }]),
      messageTurn('done'),
    ])

    const result = await run(deps, provider)

    expect(result.status).toBe('completed')
    expect(result.trace).toEqual([
      {
        tool: namespaceTool('bus', 'get_stop_times'),
        sourceId: 'bus',
        policy: 'read',
        outcome: 'executed',
        durationMs: expect.any(Number),
      },
    ])
  })

  it('records a destructive tool as confirmation_required without executing', async () => {
    let executed = 0
    const deps = setup({
      register: (registry) =>
        registry.registerSource(
          'tasks',
          [
            {
              name: 'task.delete',
              inputSchema: {
                type: 'object',
                properties: { id: { type: 'integer' } },
                required: ['id'],
              },
            },
          ],
          () => 'destructive',
        ),
      callTool: async () => {
        executed += 1
        return { content: [] }
      },
    })
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: namespaceTool('tasks', 'task.delete'), args: { id: 1 } }]),
    ])

    const result = await run(deps, provider)

    expect(result.status).toBe('confirmation_required')
    expect(executed).toBe(0)
    expect(result.trace?.[0]).toMatchObject({
      tool: namespaceTool('tasks', 'task.delete'),
      sourceId: 'tasks',
      policy: 'destructive',
      outcome: 'confirmation_required',
    })
  })

  it('records an unknown tool as failed without a policy', async () => {
    const deps = setup({ register: () => undefined })
    const provider = new FakeLLMProvider([toolCallTurn([{ name: 'ghost__thing', args: {} }])])

    const result = await run(deps, provider)

    expect(result.status).toBe('failed')
    expect(result.trace).toEqual([
      { tool: 'ghost__thing', sourceId: 'ghost', outcome: 'failed', durationMs: 0 },
    ])
  })

  it('records a failed execution', async () => {
    const deps = setup({
      register: (registry) =>
        registry.registerSource(
          'bus',
          [{ name: 'get_stop_times', inputSchema: { type: 'object', properties: {} } }],
          () => 'read',
        ),
      callTool: async () => {
        throw new AgentError('mcp_unavailable', 'down')
      },
    })
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: namespaceTool('bus', 'get_stop_times'), args: {} }]),
    ])

    const result = await run(deps, provider)

    expect(result.status).toBe('failed')
    expect(result.trace?.[0]).toMatchObject({ outcome: 'failed', sourceId: 'bus' })
  })

  it('never includes tool arguments in the trace', async () => {
    const deps = setup({
      register: (registry) =>
        registry.registerSource(
          'bus',
          [
            {
              name: 'get_stop_times',
              inputSchema: {
                type: 'object',
                properties: { stopId: { type: 'string' } },
                required: ['stopId'],
              },
            },
          ],
          () => 'read',
        ),
    })
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: namespaceTool('bus', 'get_stop_times'), args: { stopId: 'SECRET' } }]),
      messageTurn('done'),
    ])

    const result = await run(deps, provider)
    expect(JSON.stringify(result.trace)).not.toContain('SECRET')
  })
})
