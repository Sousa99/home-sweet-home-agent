import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../../src/logging/logger.js'
import { namespaceTool, ToolRegistry } from '../../src/mcp/registry.js'
import { McpSource, McpSourceManager } from '../../src/mcp/source.js'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { startFakeMcpServer, type FakeMcpServer } from '../fakes/fake-mcp-server.js'
import { buildHarness, postJson } from '../fakes/harness.js'

let server: FakeMcpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('tool trace (integration)', () => {
  it('records executed tools in order and logs them at info level', async () => {
    server = await startFakeMcpServer({
      tools: [
        {
          name: 'list_lines',
          inputSchema: { type: 'object', properties: {} },
          handler: () => ['l1', 'l2'],
        },
        {
          name: 'get_status',
          inputSchema: { type: 'object', properties: {} },
          handler: () => ({ feed: 'v1' }),
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

    const lines: string[] = []
    const logger = createLogger({ level: 'info', redact: true, sink: (line) => lines.push(line) })

    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: namespaceTool('bus', 'list_lines'), args: { SECRET: 'x' } }]),
      toolCallTurn([{ name: namespaceTool('bus', 'get_status'), args: {} }]),
      messageTurn('done'),
    ])

    const harness = buildHarness({
      provider,
      registry,
      sources: new McpSourceManager([source]),
      logger,
    })

    const response = await postJson(
      harness.app,
      '/conversation',
      { message: 'bus info' },
      harness.auth,
    )
    const body = await response.json()

    expect(body.trace.map((entry: { tool: string }) => entry.tool)).toEqual([
      namespaceTool('bus', 'list_lines'),
      namespaceTool('bus', 'get_status'),
    ])
    expect(body.trace.every((entry: { outcome: string }) => entry.outcome === 'executed')).toBe(
      true,
    )

    const output = lines.join('\n')
    expect(output).toContain('"event":"tool.call"')
    expect(output).toContain(namespaceTool('bus', 'list_lines'))
    expect(output).not.toContain('SECRET')
  })
})
