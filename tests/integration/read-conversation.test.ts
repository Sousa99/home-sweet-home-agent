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

describe('read conversation (integration)', () => {
  it('grounds the answer in a module tool result', async () => {
    server = await startFakeMcpServer({
      tools: [
        {
          name: 'get_stop_times',
          inputSchema: {
            type: 'object',
            properties: { stopId: { type: 'string' } },
            required: ['stopId'],
          },
          handler: () => 'Next bus in 4 minutes',
        },
      ],
    })

    const registry = new ToolRegistry()
    const source = new McpSource({
      sourceId: 'bus',
      url: server.url,
      timeoutMs: 2000,
      registry,
      classify: () => 'read',
      maxRetries: 0,
    })
    await source.connect()
    expect(source.state).toBe('ready')

    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'bus__get_stop_times', args: { stopId: '123' } }]),
      (input) => {
        const toolMessage = input.messages.find((message) => message.role === 'tool')
        return messageTurn(`Answer: ${toolMessage?.content ?? ''}`)
      },
    ])

    const harness = buildHarness({ provider, registry, sources: new McpSourceManager([source]) })
    const response = await postJson(
      harness.app,
      '/conversation',
      { message: 'when is the next bus?' },
      harness.auth,
    )
    const body = await response.json()

    expect(body.status).toBe('completed')
    expect(body.reply).toContain('Next bus in 4 minutes')
    expect(server.calls).toEqual([{ name: 'get_stop_times', args: { stopId: '123' } }])
  })
})
