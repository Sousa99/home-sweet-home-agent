import { describe, expect, it } from 'vitest'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { buildHarness, getJson, postJson } from '../fakes/harness.js'

describe('authorization (integration)', () => {
  it('rejects unknown or missing tokens on every endpoint before any side effect', async () => {
    const provider = new FakeLLMProvider([messageTurn('x')])
    const toolCalls: unknown[] = []
    const harness = buildHarness({
      provider,
      callTool: async (...args) => {
        toolCalls.push(args)
        return { content: [] }
      },
    })

    const bad = { authorization: 'Bearer nope' }
    const conversation = await postJson(harness.app, '/conversation', { message: 'hi' }, bad)
    const confirm = await postJson(
      harness.app,
      '/confirm',
      { conversationId: 'c', confirmationToken: 't', decision: 'approve' },
      bad,
    )
    const notifications = await postJson(
      harness.app,
      '/notifications',
      { type: 'task.due', payload: {} },
      bad,
    )
    const health = await getJson(harness.app, '/health', bad)
    const missing = await postJson(harness.app, '/conversation', { message: 'hi' })

    expect([
      conversation.status,
      confirm.status,
      notifications.status,
      health.status,
      missing.status,
    ]).toEqual([401, 401, 401, 401, 401])
    expect(provider.calls).toHaveLength(0)
    expect(toolCalls).toHaveLength(0)
  })

  it('denies a write tool to a read-only caller without executing it', async () => {
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'tasks__task_create', args: { title: 'x' } }]),
    ])
    const executed: unknown[] = []
    const harness = buildHarness({
      provider,
      permissions: ['read'],
      registerTools: (registry) =>
        registry.registerSource(
          'tasks',
          [
            {
              name: 'task.create',
              inputSchema: {
                type: 'object',
                properties: { title: { type: 'string' } },
                required: ['title'],
              },
            },
          ],
          () => 'write',
        ),
      callTool: async (...args) => {
        executed.push(args)
        return { content: [] }
      },
    })

    const response = await postJson(
      harness.app,
      '/conversation',
      { message: 'create a task' },
      harness.auth,
    )
    const body = await response.json()

    expect(body.status).toBe('failed')
    expect(body.error.code).toBe('unauthorized')
    expect(executed).toHaveLength(0)
  })
})
