import type { ErrorCode } from '../http/errors.js'
import type { ChatMessage } from '../llm/provider.js'
import type { ToolPolicy } from '../config/policy.js'

export type ConversationStatus = 'active' | 'completed' | 'confirmation_required' | 'failed'

export type ConversationOutcomeStatus = 'completed' | 'confirmation_required' | 'failed'

export interface ConfirmationRequest {
  token: string
  tool: string
  argumentsPreview: Record<string, unknown>
  expiresAt: string
}

export interface ConversationError {
  code: ErrorCode
  message: string
}

export type ToolTraceOutcome = 'executed' | 'confirmation_required' | 'failed' | 'rejected'

/**
 * A per-request record of a tool the model selected. Names only: prompts,
 * tool arguments, tokens, and household locations are never included.
 */
export interface ToolTraceEntry {
  tool: string
  sourceId: string
  policy?: ToolPolicy
  outcome: ToolTraceOutcome
  durationMs: number
}

export interface ConversationResult {
  conversationId: string
  status: ConversationOutcomeStatus
  reply?: string
  confirmation?: ConfirmationRequest
  error?: ConversationError
  trace?: ToolTraceEntry[]
}

export interface Conversation {
  conversationId: string
  callerId: string
  messages: ChatMessage[]
  status: ConversationStatus
  createdAt: string
  updatedAt: string
}
