import { createOpenAICompatibleProvider } from './openai-compatible.js'
import type { LLMProvider, LLMProviderConfig } from './provider.js'

export { createOpenAICompatibleProvider } from './openai-compatible.js'
export type { LLMProvider, LLMProviderConfig } from './provider.js'

export function createProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAICompatibleProvider(config)
    default: {
      const exhaustive: never = config.kind
      throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`)
    }
  }
}
