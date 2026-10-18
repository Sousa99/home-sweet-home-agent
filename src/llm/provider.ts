export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface LLMToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  role: ChatRole
  content: string | null
  toolCallId?: string
  toolCalls?: LLMToolCall[]
}

export type ChatResult =
  | { type: 'message'; content: string }
  | { type: 'tool_calls'; content: string | null; toolCalls: LLMToolCall[] }

export interface ChatInput {
  messages: ChatMessage[]
  tools: ChatToolDefinition[]
  /** Stable per-conversation identifier; sent to providers that require session routing. */
  sessionId?: string
  signal?: AbortSignal
}

export interface ProviderReadiness {
  ready: boolean
  provider: string
  model: string
  error?: { code: string; message: string }
}

export interface LLMProvider {
  readonly id: string
  readonly model: string
  chat(input: ChatInput): Promise<ChatResult>
  checkReady(): Promise<ProviderReadiness>
}

export interface LLMProviderConfig {
  kind: 'openai-compatible'
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
}
