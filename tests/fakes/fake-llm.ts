import type {
  ChatInput,
  ChatResult,
  LLMProvider,
  ProviderReadiness,
} from '../../src/llm/provider.js'

export function messageTurn(content: string): ChatResult {
  return { type: 'message', content }
}

export function toolCallTurn(
  calls: Array<{ id?: string; name: string; args: Record<string, unknown> | string }>,
  content: string | null = null,
): ChatResult {
  return {
    type: 'tool_calls',
    content,
    toolCalls: calls.map((call, index) => ({
      id: call.id ?? `call_${index + 1}`,
      name: call.name,
      arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args),
    })),
  }
}

export type FakeTurn = ChatResult | ((input: ChatInput) => ChatResult | Promise<ChatResult>)

export class FakeLLMProvider implements LLMProvider {
  readonly id = 'fake'
  readonly model = 'fake-model'
  readonly calls: ChatInput[] = []
  ready = true
  private index = 0

  constructor(private readonly script: FakeTurn[]) {}

  async chat(input: ChatInput): Promise<ChatResult> {
    this.calls.push(input)
    const turn = this.script[this.index]
    if (turn === undefined) {
      return { type: 'message', content: '' }
    }
    this.index += 1
    return typeof turn === 'function' ? await turn(input) : turn
  }

  async checkReady(): Promise<ProviderReadiness> {
    return { ready: this.ready, provider: this.id, model: this.model }
  }
}
