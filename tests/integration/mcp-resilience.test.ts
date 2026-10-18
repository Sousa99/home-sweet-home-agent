import { afterEach, describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../src/mcp/registry.js'
import { McpSource, McpSourceManager } from '../../src/mcp/source.js'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { startFakeMcpServer, type FakeMcpServer } from '../fakes/fake-mcp-server.js'
import { buildHarness, getJson, postJson } from '../fakes/harness.js'

const servers: FakeMcpServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('MCP host resilience (integration)', () => {
  it('keeps healthy sources usable when another source is unavailable', async () => {
    const healthy = await startFakeMcpServer({
      tools: [
        {
          name: 'planes_over',
          inputSchema: {
            type: 'object',
            properties: {
              lat: { type: 'number' },
              lng: { type: 'number' },
              radiusKm: { type: 'number' },
            },
            required: ['lat', 'lng', 'radiusKm'],
          },
          handler: () => 'no planes overhead',
        },
      ],
    })
    servers.push(healthy)

    const registry = new ToolRegistry()
    const good = new McpSource({
      sourceId: 'flights',
      url: healthy.url,
      timeoutMs: 1500,
      registry,
      classify: () => 'read',
      maxRetries: 0,
    })
    const bad = new McpSource({
      sourceId: 'weather',
      url: 'http://127.0.0.1:1/mcp',
      timeoutMs: 400,
      registry,
      classify: () => 'read',
      maxRetries: 0,
    })

    const manager = new McpSourceManager([good, bad])
    await manager.connectAll()
    expect(good.state).toBe('ready')
    expect(bad.state).toBe('unavailable')

    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'flights__planes_over', args: { lat: 1, lng: 2, radiusKm: 10 } }]),
      (input) => messageTurn(`${input.messages.find((m) => m.role === 'tool')?.content ?? ''}`),
    ])
    const harness = buildHarness({ provider, registry, sources: manager })

    const conversation = await postJson(
      harness.app,
      '/conversation',
      { message: 'any planes?' },
      harness.auth,
    )
    const body = await conversation.json()
    expect(body.status).toBe('completed')
    expect(body.reply).toContain('no planes overhead')

    const health = await (await getJson(harness.app, '/health', harness.auth)).json()
    expect(health.mcp.flights.status).toBe('ready')
    expect(health.mcp.weather.status).toBe('unavailable')
  })

  it('returns a bounded failure when a module call hangs', async () => {
    const hanging = await startFakeMcpServer({
      tools: [
        {
          name: 'planes_over',
          inputSchema: { type: 'object', properties: {}, additionalProperties: true },
          handler: () => new Promise<never>(() => undefined),
        },
      ],
    })
    servers.push(hanging)

    const registry = new ToolRegistry()
    const source = new McpSource({
      sourceId: 'flights',
      url: hanging.url,
      timeoutMs: 300,
      registry,
      classify: () => 'read',
      maxRetries: 0,
    })
    await source.connect()

    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'flights__planes_over', args: {} }]),
    ])
    const harness = buildHarness({ provider, registry, sources: new McpSourceManager([source]) })

    const started = Date.now()
    const response = await postJson(
      harness.app,
      '/conversation',
      { message: 'planes?' },
      harness.auth,
    )
    const body = await response.json()
    const elapsed = Date.now() - started

    expect(body.status).toBe('failed')
    expect(body.error.code).toBe('timeout')
    expect(elapsed).toBeLessThan(5000)
  })
})
