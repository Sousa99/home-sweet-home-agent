import { afterEach, describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../src/mcp/registry.js'
import { McpSource, McpSourceManager } from '../../src/mcp/source.js'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { startFakeMcpServer, type FakeMcpServer } from '../fakes/fake-mcp-server.js'
import { buildHarness, postJson } from '../fakes/harness.js'

let server: FakeMcpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

const taskInputSchema = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
}
const deleteInputSchema = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

async function connectedTasks(): Promise<McpSourceManager> {
  server = await startFakeMcpServer({
    tools: [
      {
        name: 'task.create',
        inputSchema: taskInputSchema,
        handler: (args) => `created ${args.title}`,
      },
      {
        name: 'task.delete',
        inputSchema: deleteInputSchema,
        handler: (args) => `deleted ${args.id}`,
      },
    ],
  })
  const registry = new ToolRegistry()
  const source = new McpSource({
    sourceId: 'tasks',
    url: server.url,
    timeoutMs: 2000,
    registry,
    classify: (_sourceId, name) => (name.includes('delete') ? 'destructive' : 'write'),
    maxRetries: 0,
  })
  await source.connect()
  return new McpSourceManager([source])
}

describe('confirmed household change (integration)', () => {
  it('auto-executes a write and requires confirmation for a destructive action', async () => {
    const sources = await connectedTasks()
    const registry = new ToolRegistry()
    registry.registerSource(
      'tasks',
      [
        { name: 'task.create', inputSchema: taskInputSchema },
        { name: 'task.delete', inputSchema: deleteInputSchema },
      ],
      (_sourceId, name) => (name.includes('delete') ? 'destructive' : 'write'),
    )

    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'tasks__task_create', args: { title: 'buy milk' } }]),
      messageTurn('Created the task.'),
      toolCallTurn([{ name: 'tasks__task_delete', args: { id: 9 } }]),
    ])

    const harness = buildHarness({ provider, registry, sources })

    const write = await postJson(
      harness.app,
      '/conversation',
      { message: 'add a task' },
      harness.auth,
    )
    const writeBody = await write.json()
    expect(writeBody.status).toBe('completed')
    expect(writeBody.reply).toContain('Created the task')
    expect(server?.calls).toContainEqual({ name: 'task.create', args: { title: 'buy milk' } })

    const destructive = await postJson(
      harness.app,
      '/conversation',
      { message: 'delete task 9' },
      harness.auth,
    )
    const destructiveBody = await destructive.json()
    expect(destructiveBody.status).toBe('confirmation_required')
    expect(destructiveBody.confirmation.tool).toBe('tasks__task_delete')
    expect(server?.calls.filter((call) => call.name === 'task.delete')).toHaveLength(0)

    const approve = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: destructiveBody.conversationId,
        confirmationToken: destructiveBody.confirmation.token,
        decision: 'approve',
      },
      harness.auth,
    )
    expect((await approve.json()).status).toBe('completed')
    expect(server?.calls.filter((call) => call.name === 'task.delete')).toHaveLength(1)
  })
})
