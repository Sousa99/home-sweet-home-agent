import { AgentError } from '../http/errors.js'
import { AGENT_NAME, AGENT_VERSION } from '../version.js'
import type {
  ChatInput,
  ChatMessage,
  ChatResult,
  ChatToolDefinition,
  LLMProvider,
  LLMProviderConfig,
  ProviderReadiness,
} from './provider.js'

interface OpenAIToolCall {
  id: string
  type: string
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: string
  content: string | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

interface OpenAIResponse {
  choices?: Array<{ message?: OpenAIMessage }>
}

function toWireMessage(message: ChatMessage): OpenAIMessage {
  const wire: OpenAIMessage = { role: message.role, content: message.content }
  if (message.role === 'tool' && message.toolCallId) {
    wire.tool_call_id = message.toolCallId
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }))
  }
  return wire
}

function toWireTool(tool: ChatToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }
}

function parseResult(message: OpenAIMessage): ChatResult {
  const toolCalls = message.tool_calls ?? []
  if (toolCalls.length > 0) {
    return {
      type: 'tool_calls',
      content: message.content ?? null,
      toolCalls: toolCalls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments ?? '{}',
      })),
    }
  }
  return { type: 'message', content: message.content ?? '' }
}

export interface OpenAICompatibleOptions {
  fetchImpl?: typeof fetch
}

export function createOpenAICompatibleProvider(
  config: LLMProviderConfig,
  options: OpenAICompatibleOptions = {},
): LLMProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`

  return {
    id: config.kind,
    model: config.model,

    async chat(input: ChatInput): Promise<ChatResult> {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: input.messages.map(toWireMessage),
        tool_choice: 'auto',
      }
      if (input.tools.length > 0) {
        body.tools = input.tools.map(toWireTool)
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      if (input.signal) {
        input.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': `${AGENT_NAME}/${AGENT_VERSION}`,
            ...(input.sessionId ? { 'x-opencode-session': input.sessionId } : {}),
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new AgentError('timeout', 'The language model request timed out.')
        }
        throw new AgentError('llm_unavailable', 'Could not reach the language model provider.')
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) {
        let detail: string
        try {
          const errorBody = (await response.json()) as {
            error?: { message?: string }
            message?: string
          }
          detail = errorBody.error?.message ?? errorBody.message ?? ''
        } catch {
          detail = ''
        }
        const hint =
          response.status === 401 || response.status === 403
            ? ' Check LLM_API_KEY for the configured provider.'
            : response.status === 404
              ? ' Check LLM_BASE_URL and LLM_MODEL.'
              : ''
        const suffix = detail ? `: ${detail.slice(0, 200)}` : ''
        throw new AgentError(
          'llm_unavailable',
          `The language model provider rejected the request (HTTP ${response.status})${suffix}.${hint}`,
        )
      }

      let payload: OpenAIResponse
      try {
        payload = (await response.json()) as OpenAIResponse
      } catch {
        throw new AgentError(
          'llm_unavailable',
          'The language model provider returned invalid JSON.',
        )
      }

      const message = payload.choices?.[0]?.message
      if (!message) {
        throw new AgentError('llm_unavailable', 'The language model provider returned no message.')
      }

      return parseResult(message)
    },

    async checkReady(): Promise<ProviderReadiness> {
      let host: string
      try {
        host = new URL(config.baseUrl).hostname
      } catch {
        host = ''
      }
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host === 'host.docker.internal'
      const ready = Boolean(config.baseUrl) && (Boolean(config.apiKey) || isLocal)
      const readiness: ProviderReadiness = { ready, provider: config.kind, model: config.model }
      if (!ready) {
        readiness.error = {
          code: 'llm_unavailable',
          message: 'No provider API key is configured for a remote endpoint.',
        }
      }
      return readiness
    },
  }
}
