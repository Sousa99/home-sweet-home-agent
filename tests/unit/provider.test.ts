import { describe, expect, it } from 'vitest'
import { AgentError } from '../../src/http/errors.js'
import { createOpenAICompatibleProvider } from '../../src/llm/openai-compatible.js'
import type { LLMProviderConfig } from '../../src/llm/provider.js'

const config: LLMProviderConfig = {
  kind: 'openai-compatible',
  baseUrl: 'http://provider.test/v1',
  model: 'deepseek-v4.1-flash',
  apiKey: 'secret',
  timeoutMs: 1000,
}

const input = { messages: [{ role: 'user' as const, content: 'hi' }], tools: [] }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('OpenAI-compatible provider', () => {
  it('maps a plain message reply', async () => {
    const provider = createOpenAICompatibleProvider(config, {
      fetchImpl: async () =>
        jsonResponse({ choices: [{ message: { role: 'assistant', content: 'hello' } }] }),
    })
    await expect(provider.chat(input)).resolves.toEqual({ type: 'message', content: 'hello' })
  })

  it('maps tool calls with raw argument strings', async () => {
    const provider = createOpenAICompatibleProvider(config, {
      fetchImpl: async () =>
        jsonResponse({
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
        }),
    })
    await expect(provider.chat(input)).resolves.toEqual({
      type: 'tool_calls',
      content: null,
      toolCalls: [{ id: 'call_1', name: 'bus.get_stop_times', arguments: '{"stopId":"1"}' }],
    })
  })

  it('sends the model, tools, session header, user agent, and bearer key', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    let seenBody: Record<string, unknown> = {}
    const provider = createOpenAICompatibleProvider(config, {
      fetchImpl: async (url, init) => {
        seenUrl = String(url)
        seenHeaders = (init?.headers ?? {}) as Record<string, string>
        seenBody = JSON.parse(String(init?.body))
        return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })
      },
    })
    await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'bus.get_stop', parameters: {} } }],
      sessionId: 'conversation-123',
    })
    expect(seenUrl).toBe('http://provider.test/v1/chat/completions')
    expect(seenHeaders.authorization).toBe('Bearer secret')
    expect(seenHeaders['user-agent']).toMatch(/^home-sweet-home-agent\//)
    expect(seenHeaders['x-opencode-session']).toBe('conversation-123')
    expect(seenBody.model).toBe('deepseek-v4.1-flash')
    expect(seenBody.tool_choice).toBe('auto')
    expect(Array.isArray(seenBody.tools)).toBe(true)
  })

  it('classifies a non-2xx response as llm_unavailable with the status', async () => {
    const provider = createOpenAICompatibleProvider(config, {
      fetchImpl: async () => jsonResponse({ error: { message: 'bad key' } }, 401),
    })
    await expect(provider.chat(input)).rejects.toMatchObject({ code: 'llm_unavailable' })
    await expect(provider.chat(input)).rejects.toThrow(/401/)
    await expect(provider.chat(input)).rejects.toThrow(/LLM_API_KEY/)
  })

  it('classifies a network failure as llm_unavailable', async () => {
    const provider = createOpenAICompatibleProvider(config, {
      fetchImpl: async () => {
        throw new Error('connection refused')
      },
    })
    await expect(provider.chat(input)).rejects.toBeInstanceOf(AgentError)
  })

  it('reports readiness from configuration', async () => {
    const provider = createOpenAICompatibleProvider(config, {
      fetchImpl: async () => jsonResponse({}),
    })
    await expect(provider.checkReady()).resolves.toMatchObject({
      ready: true,
      provider: 'openai-compatible',
      model: 'deepseek-v4.1-flash',
    })
  })
})
