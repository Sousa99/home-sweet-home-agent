import { afterEach, describe, expect, it } from 'vitest'
import { classifyTool } from '../../src/config/policy.js'
import { ToolRegistry } from '../../src/mcp/registry.js'
import { McpSource, McpSourceManager } from '../../src/mcp/source.js'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { startFakeMcpServer, type FakeMcpServer } from '../fakes/fake-mcp-server.js'
import { buildHarness, getJson, postJson } from '../fakes/harness.js'

const servers: FakeMcpServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

function busTools() {
  return [
    {
      name: 'get_stop_times',
      inputSchema: {
        type: 'object',
        properties: { stopId: { type: 'string' } },
        required: ['stopId'],
      },
      handler: () => 'Next bus in 4 minutes',
    },
  ]
}

function homeAssistantTools() {
  return [
    {
      name: 'homeassistant__GetLiveContext',
      inputSchema: { type: 'object', properties: {} },
      handler: () => 'Living room light is on',
    },
  ]
}

function haSource(url: string, registry: ToolRegistry): McpSource {
  return new McpSource({
    sourceId: 'home_assistant',
    url,
    headers: { Authorization: 'Bearer ha-token' },
    timeoutMs: 800,
    registry,
    classify: (sourceId, name) => classifyTool(sourceId, name, 'destructive'),
    maxRetries: 0,
    retryDelayMs: 1,
  })
}

describe('Home Assistant resilience (integration)', () => {
  it('keeps module sources usable when Home Assistant is unavailable', async () => {
    const bus = await startFakeMcpServer({ tools: busTools() })
    servers.push(bus)

    const registry = new ToolRegistry()
    const busSource = new McpSource({
      sourceId: 'bus',
      url: bus.url,
      timeoutMs: 1500,
      registry,
      classify: () => 'read',
      maxRetries: 0,
    })
    const unavailableHa = haSource('http://127.0.0.1:1/mcp', registry)
    const manager = new McpSourceManager([busSource, unavailableHa])

    await manager.connectAll()
    expect(busSource.state).toBe('ready')
    expect(unavailableHa.state).toBe('unavailable')

    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'bus__get_stop_times', args: { stopId: '42' } }]),
      (input) => messageTurn(input.messages.find((m) => m.role === 'tool')?.content ?? ''),
    ])
    const harness = buildHarness({ provider, registry, sources: manager })

    const body = await (
      await postJson(harness.app, '/conversation', { message: 'next bus?' }, harness.auth)
    ).json()
    expect(body.status).toBe('completed')
    expect(body.reply).toContain('Next bus in 4 minutes')

    const health = await (await getJson(harness.app, '/health', harness.auth)).json()
    expect(health.mcp.home_assistant.status).toBe('unavailable')
    expect(health.mcp.bus.status).toBe('ready')
  })

  it('reconnects Home Assistant after a mid-session outage', async () => {
    const first = await startFakeMcpServer({ port: 0, tools: homeAssistantTools() })
    const port = first.port
    const registry = new ToolRegistry()
    const source = haSource(`http://127.0.0.1:${port}/mcp`, registry)

    await source.connect()
    expect(source.state).toBe('ready')

    await first.close()
    await source.connect()
    expect(source.state).toBe('unavailable')

    const second = await startFakeMcpServer({ port, tools: homeAssistantTools() })
    servers.push(second)
    await source.connect()
    expect(source.state).toBe('ready')
    expect(registry.list().map((tool) => tool.name)).toContain(
      'home_assistant__homeassistant__GetLiveContext',
    )
  })
})
