import { describe, expect, it } from 'vitest'
import type { McpClientHandle } from '../../src/mcp/client.js'
import { ToolRegistry } from '../../src/mcp/registry.js'
import { McpSource } from '../../src/mcp/source.js'

interface HandleStubs {
  connect?: () => Promise<void>
  listTools?: () => Promise<{ tools: Array<Record<string, unknown>> }>
  callTool?: () => Promise<unknown>
  close?: () => Promise<void>
}

function handleWith(stubs: HandleStubs): McpClientHandle {
  const client = {
    connect: stubs.connect ?? (async () => undefined),
    listTools: stubs.listTools ?? (async () => ({ tools: [] })),
    callTool: stubs.callTool ?? (async () => ({ content: [] })),
  }
  return {
    client,
    transport: {},
    close: stubs.close ?? (async () => undefined),
  } as unknown as McpClientHandle
}

function source(
  registry: ToolRegistry,
  stubs: HandleStubs,
  overrides: Record<string, unknown> = {},
) {
  return new McpSource({
    sourceId: 'bus',
    url: 'http://module.test/mcp',
    timeoutMs: 300,
    registry,
    classify: () => 'read',
    maxRetries: 0,
    retryDelayMs: 1,
    createClient: () => handleWith(stubs),
    ...overrides,
  })
}

describe('McpSource', () => {
  it('connects, discovers tools, and becomes ready', async () => {
    const registry = new ToolRegistry()
    const s = source(registry, {
      listTools: async () => ({ tools: [{ name: 'get_stop', inputSchema: { type: 'object' } }] }),
    })
    await s.connect()
    expect(s.state).toBe('ready')
    expect(s.status().toolCount).toBe(1)
    expect(registry.get('bus__get_stop')).toBeDefined()
  })

  it('becomes unavailable after bounded retries on connect failure', async () => {
    const registry = new ToolRegistry()
    let attempts = 0
    const s = source(
      registry,
      {
        connect: async () => {
          throw new Error('boom')
        },
      },
      {
        maxRetries: 1,
        createClient: () => {
          attempts += 1
          return handleWith({
            connect: async () => {
              throw new Error('boom')
            },
          })
        },
      },
    )
    await s.connect()
    expect(s.state).toBe('unavailable')
    expect(attempts).toBe(2)
  })

  it('times out a hanging connect', async () => {
    const registry = new ToolRegistry()
    const s = source(registry, { connect: () => new Promise(() => undefined) }, { timeoutMs: 50 })
    await s.connect()
    expect(s.state).toBe('unavailable')
    expect(s.status().error?.code).toBe('timeout')
  })

  it('marks degraded on a failed call and recovers', async () => {
    const registry = new ToolRegistry()
    let shouldFail = true
    const s = source(registry, {
      listTools: async () => ({ tools: [{ name: 'get_stop' }] }),
      callTool: async () => {
        if (shouldFail) throw new Error('down')
        return { content: [] }
      },
    })
    await s.connect()
    await expect(s.callTool('get_stop', {})).rejects.toMatchObject({ code: 'mcp_unavailable' })
    expect(s.state).toBe('degraded')
    shouldFail = false
    await s.callTool('get_stop', {})
    expect(s.state).toBe('ready')
  })
})
