export type ErrorCode =
  | 'unauthorized'
  | 'malformed_request'
  | 'tool_not_found'
  | 'tool_validation_failed'
  | 'confirmation_invalid'
  | 'confirmation_expired'
  | 'llm_unavailable'
  | 'mcp_unavailable'
  | 'timeout'
  | 'internal_error'

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  malformed_request: 400,
  tool_not_found: 422,
  tool_validation_failed: 422,
  confirmation_invalid: 409,
  confirmation_expired: 410,
  llm_unavailable: 502,
  mcp_unavailable: 502,
  timeout: 504,
  internal_error: 500,
}

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: 'Missing or invalid bearer token, or insufficient permissions.',
  malformed_request: 'The request body is malformed.',
  tool_not_found: 'The requested tool is not currently available.',
  tool_validation_failed: 'The tool arguments did not satisfy the tool schema.',
  confirmation_invalid: 'The confirmation token is unknown, already used, or not yours.',
  confirmation_expired: 'The confirmation token has expired.',
  llm_unavailable: 'The language model provider is unavailable.',
  mcp_unavailable: 'The requested module is unavailable.',
  timeout: 'The operation exceeded its configured timeout.',
  internal_error: 'An unexpected error occurred.',
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string }
}

export class AgentError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.name = 'AgentError'
    this.code = code
  }
}

export function errorBody(code: ErrorCode, message?: string): ErrorBody {
  return { error: { code, message: message ?? DEFAULT_MESSAGES[code] } }
}

export function toErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof AgentError) {
    return { status: ERROR_STATUS[error.code], body: errorBody(error.code, error.message) }
  }
  return { status: ERROR_STATUS.internal_error, body: errorBody('internal_error') }
}
