import { Ajv, type ValidateFunction } from 'ajv'
import type { ErrorCode } from '../http/errors.js'
import { AgentError } from '../http/errors.js'
import type { ToolDescriptor, ToolRegistry } from '../mcp/registry.js'
import { toolResultIsError, toolResultToText, type McpSourceManager } from '../mcp/source.js'

export interface ValidationSuccess {
  descriptor: ToolDescriptor
  args: Record<string, unknown>
}

export interface ValidationFailure {
  code: ErrorCode
  message: string
}

export type ValidationResult = ValidationSuccess | ValidationFailure

export interface ExecutionSuccess {
  ok: true
  text: string
  isError: boolean
}

export interface ExecutionFailure {
  ok: false
  code: ErrorCode
  message: string
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure

export class ToolExecutor {
  private readonly ajv = new Ajv({ allErrors: true, strict: false })
  private readonly validators = new Map<string, ValidateFunction>()
  private readonly registry: ToolRegistry
  private readonly sources: McpSourceManager

  constructor(deps: { registry: ToolRegistry; sources: McpSourceManager }) {
    this.registry = deps.registry
    this.sources = deps.sources
  }

  validate(toolName: string, rawArguments: unknown): ValidationResult {
    const descriptor = this.registry.get(toolName)
    if (!descriptor) {
      return { code: 'tool_not_found', message: `Tool ${toolName} is not available.` }
    }

    let args: unknown = rawArguments
    if (typeof rawArguments === 'string') {
      try {
        args = JSON.parse(rawArguments)
      } catch {
        return { code: 'tool_validation_failed', message: 'Tool arguments are not valid JSON.' }
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { code: 'tool_validation_failed', message: 'Tool arguments must be an object.' }
    }

    const validate = this.validatorFor(descriptor)
    if (!validate || !validate(args)) {
      const reason = (validate?.errors ?? [])
        .slice(0, 3)
        .map((issue) => `${issue.instancePath || '/'} ${issue.message ?? ''}`.trim())
        .join('; ')
      return {
        code: 'tool_validation_failed',
        message: `Tool arguments did not satisfy the tool schema${reason ? ` (${reason})` : ''}.`,
      }
    }

    return { descriptor, args: args as Record<string, unknown> }
  }

  private validatorFor(descriptor: ToolDescriptor): ValidateFunction | null {
    const cached = this.validators.get(descriptor.name)
    if (cached) return cached

    const schema: Record<string, unknown> = { ...descriptor.inputSchema }
    // Modules publish schemas with varied `$schema` drafts (draft-07 and
    // 2020-12). Ajv's default instance is draft-07, so drop the meta pointer
    // and validate against the object keywords the modules actually use.
    delete schema.$schema
    if (!schema.type) schema.type = 'object'

    let validate: ValidateFunction
    try {
      validate = this.ajv.compile(schema)
    } catch {
      return null
    }
    this.validators.set(descriptor.name, validate)
    return validate
  }

  async execute(
    descriptor: ToolDescriptor,
    args: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    try {
      const result = await this.sources.callTool(descriptor.sourceId, descriptor.originalName, args)
      return { ok: true, text: toolResultToText(result), isError: toolResultIsError(result) }
    } catch (error) {
      if (error instanceof AgentError) {
        return { ok: false, code: error.code, message: error.message }
      }
      return { ok: false, code: 'mcp_unavailable', message: 'Module request failed.' }
    }
  }
}

export function isValidationFailure(result: ValidationResult): result is ValidationFailure {
  return 'code' in result
}
