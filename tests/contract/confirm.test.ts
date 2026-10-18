import { describe, expect, it } from 'vitest'
import { ConfirmationStore } from '../../src/confirmation/store.js'
import type { ToolRegistry } from '../../src/mcp/registry.js'
import { FakeLLMProvider, toolCallTurn } from '../fakes/fake-llm.js'
import { buildHarness, postJson } from '../fakes/harness.js'

function registerDestructive(registry: ToolRegistry): void {
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
  )
}

describe('POST /confirm', () => {
  it('executes an approved action exactly once, then rejects replay', async () => {
    const executed: Array<Record<string, unknown>> = []
    const harness = buildHarness({
      provider: new FakeLLMProvider([
        toolCallTurn([{ name: 'tasks__task_delete', args: { id: 42 } }]),
      ]),
      registerTools: registerDestructive,
      callTool: async (_sourceId, name, args) => {
        executed.push({ name, args })
        return { content: [{ type: 'text', text: 'deleted task 42' }] }
      },
    })

    const first = await postJson(
      harness.app,
      '/conversation',
      { message: 'delete 42' },
      harness.auth,
    )
    const firstBody = await first.json()
    expect(firstBody.status).toBe('confirmation_required')
    expect(executed).toHaveLength(0)

    const approve = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: firstBody.conversationId,
        confirmationToken: firstBody.confirmation.token,
        decision: 'approve',
      },
      harness.auth,
    )
    expect(approve.status).toBe(200)
    expect((await approve.json()).status).toBe('completed')
    expect(executed).toHaveLength(1)

    const replay = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: firstBody.conversationId,
        confirmationToken: firstBody.confirmation.token,
        decision: 'approve',
      },
      harness.auth,
    )
    expect(replay.status).toBe(409)
    expect(executed).toHaveLength(1)
  })

  it('does not execute a rejected action', async () => {
    const executed: unknown[] = []
    const harness = buildHarness({
      provider: new FakeLLMProvider([
        toolCallTurn([{ name: 'tasks__task_delete', args: { id: 7 } }]),
      ]),
      registerTools: registerDestructive,
      callTool: async () => {
        executed.push(true)
        return { content: [] }
      },
    })
    const first = await postJson(
      harness.app,
      '/conversation',
      { message: 'delete 7' },
      harness.auth,
    )
    const firstBody = await first.json()
    const reject = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: firstBody.conversationId,
        confirmationToken: firstBody.confirmation.token,
        decision: 'reject',
      },
      harness.auth,
    )
    expect((await reject.json()).status).toBe('completed')
    expect(executed).toHaveLength(0)
  })

  it('expires a stale token', async () => {
    let now = 0
    const confirmations = new ConfirmationStore({ ttlMs: 1000, now: () => now })
    const harness = buildHarness({
      provider: new FakeLLMProvider([
        toolCallTurn([{ name: 'tasks__task_delete', args: { id: 1 } }]),
      ]),
      registerTools: registerDestructive,
      callTool: async () => ({ content: [] }),
      confirmations,
    })
    const first = await postJson(
      harness.app,
      '/conversation',
      { message: 'delete 1' },
      harness.auth,
    )
    const firstBody = await first.json()
    now = 5000
    const expired = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: firstBody.conversationId,
        confirmationToken: firstBody.confirmation.token,
        decision: 'approve',
      },
      harness.auth,
    )
    expect(expired.status).toBe(410)
  })

  it('rejects an unknown token', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]) })
    const response = await postJson(
      harness.app,
      '/confirm',
      { conversationId: 'c-1', confirmationToken: 'missing', decision: 'approve' },
      harness.auth,
    )
    expect(response.status).toBe(409)
  })
})
