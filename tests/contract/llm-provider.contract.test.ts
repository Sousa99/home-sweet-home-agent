import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createOpenAICompatibleProvider } from '../../src/llm/openai-compatible.js'
import type { ChatInput, LLMProviderConfig } from '../../src/llm/provider.js'

interface Capture {
  auth?: string
  body?: Record<string, unknown>
}

function fakeProviderApp(capture: Capture): Hono {
  const app = new Hono()
  app.post('/v1/chat/completions', async (c) => {
    capture.auth = c.req.header('authorization')
    capture.body = (await c.req.json()) as Record<string, unknown>
    return c.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'bus.get_stop_times', arguments: '{"stopId":"1"}' },
              },
            ],
          },
        },
      ],
    })
  })
  return app
}

const config: LLMProviderConfig = {
  kind: 'openai-compatible',
  baseUrl: 'http://fake.local/v1',
  model: 'deepseek-v4.1-flash',
  apiKey: 'key',
  timeoutMs: 2000,
}

describe('LLM provider contract', () => {
  it('sends discovered tools and parses tool calls', async () => {
    const capture: Capture = {}
    const app = fakeProviderApp(capture)
    const provider = createOpenAICompatibleProvider(config, {
      fetchImpl: async (url, init) => app.request(String(url), init),
    })

    const input: ChatInput = {
      messages: [{ role: 'user', content: 'next bus?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'bus.get_stop_times',
            description: 'next buses',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    }

    const result = await provider.chat(input)

    expect(capture.auth).toBe('Bearer key')
    expect(capture.body?.model).toBe('deepseek-v4.1-flash')
    expect(capture.body?.tool_choice).toBe('auto')
    const tools = capture.body?.tools as Array<{ function: { name: string } }>
    expect(tools[0].function.name).toBe('bus.get_stop_times')
    expect(result).toEqual({
      type: 'tool_calls',
      content: null,
      toolCalls: [{ id: 'call_1', name: 'bus.get_stop_times', arguments: '{"stopId":"1"}' }],
    })
  })
})
