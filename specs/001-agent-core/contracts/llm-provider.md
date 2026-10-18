# Contract: LLM Provider

The agent depends on a provider-agnostic `LLMProvider` interface (constitution IV, FR-017). The only
adapter in this feature is OpenAI-compatible chat completions, which covers OpenCode Go, the OpenCode
free model, and local Ollama. The interface is the seam replaced by `FakeLLMProvider` in tests
(FR-021).

## TypeScript interface

```ts
type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

interface ChatToolDefinition {
  type: 'function'
  function: { name: string; description?: string; parameters: object } // JSON Schema
}

interface ChatMessage {
  role: ChatRole
  content: string | null
  toolCallId?: string          // for role 'tool'
  toolCalls?: LLMToolCall[]    // for role 'assistant'
}

interface LLMToolCall {
  id: string
  name: string                  // namespaced tool name
  arguments: string             // raw JSON string as emitted by the model
}

type ChatResult =
  | { type: 'message'; content: string }
  | { type: 'tool_calls'; content: string | null; toolCalls: LLMToolCall[] }

interface ProviderReadiness { ready: boolean; provider: string; model: string; error?: { code: string; message: string } }

interface LLMProvider {
  readonly id: string
  readonly model: string
  chat(input: { messages: ChatMessage[]; tools: ChatToolDefinition[]; signal?: AbortSignal }): Promise<ChatResult>
  checkReady(): Promise<ProviderReadiness>
}
```

## OpenAI-compatible wire contract

**Request** — `POST {baseUrl}/chat/completions`
```json
{
  "model": "deepseek-v4.1-flash",
  "messages": [ { "role": "user", "content": "..." }, { "role": "tool", "tool_call_id": "call_1", "content": "..." } ],
  "tools": [ { "type": "function", "function": { "name": "bus__get_stop_times", "description": "...", "parameters": { "type": "object", "properties": {} } } } ],
  "tool_choice": "auto"
}
```
Headers: `Authorization: Bearer <LLM_API_KEY>`, `Content-Type: application/json`,
`User-Agent: home-sweet-home-agent/<version>`, and (when a session id is available)
`x-opencode-session: <conversationId>` — OpenCode Go requires the session header for routing.

**Response**
```json
{
  "choices": [
    { "message": { "role": "assistant", "content": null, "tool_calls": [ { "id": "call_1", "type": "function", "function": { "name": "bus__get_stop_times", "arguments": "{\"stopId\":\"123\"}" } } ] } }
  ]
}
```

**Mapping rules**
- `message.tool_calls` present → `{ type: 'tool_calls', content, toolCalls }`, with `arguments` passed
  through as the raw JSON string for schema validation by the agent.
- Otherwise → `{ type: 'message', content: message.content ?? '' }`.

## Deployments

| Deployment | `LLM_BASE_URL` | `LLM_MODEL` |
| ---------- | -------------- | ----------- |
| OpenCode Go (default example) | `https://opencode.ai/inference/go/openai/v1` | `deepseek-v4.1-flash` |
| OpenCode free model | configured Go endpoint | configured model id |
| Ollama (local) | `http://localhost:11434/v1` | local model id |

## Requirements

- Base URL, model, API key, and timeout come only from configuration; no provider is hardcoded
  (FR-017, FR-018).
- Provider failures (unreachable, non-2xx, timeout) surface as a structured `llm_unavailable`
  failure; no tool executes as a side effect of a provider failure (US4 scenario 3, FR-015).
- The API key is never logged or returned in any response (FR-020).
- `checkReady()` backs the `llm` block of `GET /health`.
- Cloud providers (OpenCode Go, other cloud endpoints) are documented opt-in data egress paths
  (FR-022); Ollama is the local alternative.
