import { describe, expect, it } from 'vitest'
import { namespaceTool } from '../../src/mcp/registry.js'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { buildHarness, postJson } from '../fakes/harness.js'

function registerRead(
  registry: Parameters<NonNullable<Parameters<typeof buildHarness>[0]['registerTools']>>[0],
) {
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
  )
}

function registerDestructive(
  registry: Parameters<NonNullable<Parameters<typeof buildHarness>[0]['registerTools']>>[0],
) {
  registry.registerSource(
    'tasks',
    [
      {
        name: 'task.delete',
        inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      },
    ],
    () => 'destructive',
  )
}

describe('tool trace (HTTP contract)', () => {
  it('returns a trace on /conversation with tool names only', async () => {
    const harness = buildHarness({
      provider: new FakeLLMProvider([
        toolCallTurn([
          { name: namespaceTool('bus', 'get_stop_times'), args: { stopId: 'SECRET' } },
        ]),
        messageTurn('done'),
      ]),
      registerTools: registerRead,
    })

    const response = await postJson(harness.app, '/conversation', { message: 'bus?' }, harness.auth)
    const body = await response.json()

    expect(body.status).toBe('completed')
    expect(body.trace).toEqual([
      {
        tool: namespaceTool('bus', 'get_stop_times'),
        sourceId: 'bus',
        policy: 'read',
        outcome: 'executed',
        durationMs: expect.any(Number),
      },
    ])
    expect(JSON.stringify(body.trace)).not.toContain('SECRET')
  })

  it('returns a trace on /confirm after approval', async () => {
    const harness = buildHarness({
      provider: new FakeLLMProvider([
        toolCallTurn([{ name: namespaceTool('tasks', 'task.delete'), args: { id: 42 } }]),
      ]),
      registerTools: registerDestructive,
      callTool: async () => ({ content: [{ type: 'text', text: 'deleted' }] }),
    })

    const conversation = await postJson(
      harness.app,
      '/conversation',
      { message: 'delete' },
      harness.auth,
    )
    const conversationBody = await conversation.json()
    expect(conversationBody.trace?.[0]).toMatchObject({ outcome: 'confirmation_required' })

    const confirm = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: conversationBody.conversationId,
        confirmationToken: conversationBody.confirmation.token,
        decision: 'approve',
      },
      harness.auth,
    )
    const confirmBody = await confirm.json()

    expect(confirmBody.status).toBe('completed')
    expect(confirmBody.trace).toEqual([
      {
        tool: namespaceTool('tasks', 'task.delete'),
        sourceId: 'tasks',
        policy: 'destructive',
        outcome: 'executed',
        durationMs: expect.any(Number),
      },
    ])
  })

  it('records a rejected confirmation in the trace', async () => {
    const harness = buildHarness({
      provider: new FakeLLMProvider([
        toolCallTurn([{ name: namespaceTool('tasks', 'task.delete'), args: { id: 42 } }]),
      ]),
      registerTools: registerDestructive,
    })

    const conversation = await postJson(
      harness.app,
      '/conversation',
      { message: 'delete' },
      harness.auth,
    )
    const conversationBody = await conversation.json()
    const reject = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: conversationBody.conversationId,
        confirmationToken: conversationBody.confirmation.token,
        decision: 'reject',
      },
      harness.auth,
    )
    expect((await reject.json()).trace?.[0]).toMatchObject({ outcome: 'rejected' })
  })
})
