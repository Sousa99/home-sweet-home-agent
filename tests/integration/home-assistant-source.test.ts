import { afterEach, describe, expect, it } from 'vitest'
import { classifyTool } from '../../src/config/policy.js'
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

describe('Home Assistant read conversation (integration)', () => {
  it('grounds a home-state answer in a Home Assistant tool result', async () => {
    server = await startFakeMcpServer({
      tools: [
        {
          name: 'homeassistant__GetLiveContext',
          description: 'Current home context',
          inputSchema: { type: 'object', properties: {} },
          handler: () => 'Living room light is on',
        },
      ],
    })

    const registry = new ToolRegistry()
    const source = new McpSource({
      sourceId: 'home_assistant',
      url: server.url,
      headers: { Authorization: 'Bearer ha-token' },
      timeoutMs: 2000,
      registry,
      classify: (sourceId, name) => classifyTool(sourceId, name, 'destructive'),
      maxRetries: 0,
    })
    await source.connect()
    expect(source.state).toBe('ready')
    expect(registry.list().map((tool) => tool.name)).toEqual([
      'home_assistant__homeassistant__GetLiveContext',
    ])

    const namespaced = 'home_assistant__homeassistant__GetLiveContext'
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: namespaced, args: {} }]),
      (input) =>
        messageTurn(`Because ${input.messages.find((m) => m.role === 'tool')?.content ?? ''}`),
    ])

    const harness = buildHarness({ provider, registry, sources: new McpSourceManager([source]) })
    const response = await postJson(
      harness.app,
      '/conversation',
      { message: 'what lights are on?' },
      harness.auth,
    )
    const body = await response.json()

    expect(body.status).toBe('completed')
    expect(body.reply).toContain('Living room light is on')
    expect(body.trace?.[0]).toMatchObject({
      tool: namespaced,
      sourceId: 'home_assistant',
      policy: 'read',
      outcome: 'executed',
    })
    expect(server.calls).toEqual([{ name: 'homeassistant__GetLiveContext', args: {} }])
    expect(server.headers.some((h) => h.authorization === 'Bearer ha-token')).toBe(true)
  })
})
