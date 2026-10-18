import { describe, expect, it } from 'vitest'
import { ToolExecutor } from '../../src/conversation/tool-executor.js'
import { AgentError } from '../../src/http/errors.js'
import { ToolRegistry } from '../../src/mcp/registry.js'
import type { McpSourceManager } from '../../src/mcp/source.js'

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.registerSource(
    'bus',
    [
      {
        name: 'get_stop_times',
        description: 'next buses',
        inputSchema: {
          type: 'object',
          properties: { stopId: { type: 'string' }, limit: { type: 'integer' } },
          required: ['stopId'],
          additionalProperties: false,
        },
      },
    ],
    () => 'read',
  )
  return registry
}

function makeSources(impl: () => Promise<unknown>): McpSourceManager {
  return { callTool: impl } as unknown as McpSourceManager
}

describe('ToolExecutor.validate', () => {
  it('rejects an unknown tool', () => {
    const executor = new ToolExecutor({
      registry: makeRegistry(),
      sources: makeSources(async () => ({})),
    })
    expect(executor.validate('bus__missing', '{}')).toEqual({
      code: 'tool_not_found',
      message: expect.stringContaining('bus__missing'),
    })
  })

  it('rejects malformed JSON arguments', () => {
    const executor = new ToolExecutor({
      registry: makeRegistry(),
      sources: makeSources(async () => ({})),
    })
    expect(executor.validate('bus__get_stop_times', '{not json')).toMatchObject({
      code: 'tool_validation_failed',
    })
  })

  it('rejects arguments that fail the schema', () => {
    const executor = new ToolExecutor({
      registry: makeRegistry(),
      sources: makeSources(async () => ({})),
    })
    expect(executor.validate('bus__get_stop_times', { limit: 5 })).toMatchObject({
      code: 'tool_validation_failed',
    })
  })

  it('accepts valid arguments', () => {
    const executor = new ToolExecutor({
      registry: makeRegistry(),
      sources: makeSources(async () => ({})),
    })
    const result = executor.validate('bus__get_stop_times', '{"stopId":"123"}')
    expect('descriptor' in result && result.descriptor.originalName).toBe('get_stop_times')
  })
})

describe('ToolExecutor.execute', () => {
  it('returns the tool result as text', async () => {
    const executor = new ToolExecutor({
      registry: makeRegistry(),
      sources: makeSources(async () => ({ content: [{ type: 'text', text: 'next bus 14:32' }] })),
    })
    const validation = executor.validate('bus__get_stop_times', { stopId: '123' })
    if (!('descriptor' in validation)) throw new Error('expected valid')
    await expect(executor.execute(validation.descriptor, validation.args)).resolves.toEqual({
      ok: true,
      text: 'next bus 14:32',
      isError: false,
    })
  })

  it('reports a bounded failure when the module is unavailable', async () => {
    const executor = new ToolExecutor({
      registry: makeRegistry(),
      sources: makeSources(async () => {
        throw new AgentError('mcp_unavailable', 'down')
      }),
    })
    const validation = executor.validate('bus__get_stop_times', { stopId: '123' })
    if (!('descriptor' in validation)) throw new Error('expected valid')
    await expect(executor.execute(validation.descriptor, validation.args)).resolves.toEqual({
      ok: false,
      code: 'mcp_unavailable',
      message: 'down',
    })
  })
})
