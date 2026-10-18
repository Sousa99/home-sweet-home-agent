import { describe, expect, it } from 'vitest'
import type { ToolRegistry } from '../../src/mcp/registry.js'
import { FakeLLMProvider, toolCallTurn } from '../fakes/fake-llm.js'
import { buildHarness, postJson } from '../fakes/harness.js'

function registerDestructive(registry: ToolRegistry): void {
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

describe('restart behavior (integration)', () => {
  it('does not restore pending confirmations after a simulated restart', async () => {
    const makeHarness = () =>
      buildHarness({
        provider: new FakeLLMProvider([
          toolCallTurn([{ name: 'tasks__task_delete', args: { id: 1 } }]),
        ]),
        registerTools: registerDestructive,
        callTool: async () => ({ content: [{ type: 'text', text: 'deleted' }] }),
      })

    const before = makeHarness()
    const conversation = await postJson(
      before.app,
      '/conversation',
      { message: 'delete task 1' },
      before.auth,
    )
    const confirmationToken = (await conversation.json()).confirmation.token

    // A brand-new process has a fresh in-memory store.
    const after = makeHarness()
    const response = await postJson(
      after.app,
      '/confirm',
      { conversationId: 'c-1', confirmationToken, decision: 'approve' },
      after.auth,
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('confirmation_invalid')
  })
})
