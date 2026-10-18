import type { ErrorCode } from '../http/errors.js'
import { AgentError } from '../http/errors.js'
import { ErrorCode as McpErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { Logger } from '../logging/logger.js'
import { createMcpClient, type McpClientHandle } from './client.js'
import type { ToolClassifier, ToolRegistry } from './registry.js'

export type SourceState = 'connecting' | 'ready' | 'degraded' | 'unavailable'

export interface SourceStatus {
  sourceId: string
  state: SourceState
  toolCount: number
  error?: { code: ErrorCode; message: string }
}

export interface McpSourceOptions {
  sourceId: string
  url: string
  timeoutMs: number
  registry: ToolRegistry
  classify: ToolClassifier
  maxRetries?: number
  retryDelayMs?: number
  createClient?: (options: { url: string; signal?: AbortSignal }) => McpClientHandle
  logger?: Logger
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AgentError('timeout', message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function classifySourceError(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof AgentError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof McpError && error.code === McpErrorCode.RequestTimeout) {
    return { code: 'timeout', message: 'Timed out talking to the module.' }
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { code: 'timeout', message: 'Timed out talking to the module.' }
  }
  return { code: 'mcp_unavailable', message: 'Module request failed.' }
}

export function toolResultToText(result: unknown): string {
  if (result === null || result === undefined) return ''
  if (typeof result !== 'object') return String(result)
  const content = (result as { content?: unknown }).content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return JSON.stringify(item)
      })
      .join('\n')
  }
  return JSON.stringify(result)
}

export function toolResultIsError(result: unknown): boolean {
  return Boolean(
    result && typeof result === 'object' && (result as { isError?: unknown }).isError === true,
  )
}

export class McpSource {
  readonly sourceId: string
  private readonly url: string
  private readonly timeoutMs: number
  private readonly registry: ToolRegistry
  private readonly classify: ToolClassifier
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly createClient: (options: { url: string; signal?: AbortSignal }) => McpClientHandle
  private readonly logger?: Logger

  private handle: McpClientHandle | null = null
  private currentState: SourceState = 'connecting'
  private currentError: { code: ErrorCode; message: string } | null = null
  private currentToolCount = 0

  constructor(options: McpSourceOptions) {
    this.sourceId = options.sourceId
    this.url = options.url
    this.timeoutMs = options.timeoutMs
    this.registry = options.registry
    this.classify = options.classify
    this.maxRetries = options.maxRetries ?? 1
    this.retryDelayMs = options.retryDelayMs ?? 250
    this.createClient = options.createClient ?? createMcpClient
    this.logger = options.logger
  }

  get state(): SourceState {
    return this.currentState
  }

  status(): SourceStatus {
    const status: SourceStatus = {
      sourceId: this.sourceId,
      state: this.currentState,
      toolCount: this.currentToolCount,
    }
    if (this.currentError) status.error = this.currentError
    return status
  }

  async connect(): Promise<void> {
    if (this.handle) {
      await this.handle.close().catch(() => undefined)
      this.handle = null
    }
    this.registry.clearSource(this.sourceId)
    this.currentToolCount = 0
    this.currentState = 'connecting'
    this.currentError = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      let handle: McpClientHandle | null = null
      try {
        handle = this.createClient({ url: this.url, signal: controller.signal })
        await withTimeout(
          handle.client.connect(handle.transport),
          this.timeoutMs,
          `connect to ${this.sourceId} timed out`,
        )
        const listed = await withTimeout(
          handle.client.listTools(),
          this.timeoutMs,
          `tool discovery for ${this.sourceId} timed out`,
        )
        const rawTools = (listed.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }))
        const registered = this.registry.registerSource(this.sourceId, rawTools, this.classify)
        this.currentToolCount = registered.length
        this.handle = handle
        this.currentState = 'ready'
        this.currentError = null
        this.logger?.info('mcp.source.ready', {
          sourceId: this.sourceId,
          toolCount: registered.length,
        })
        return
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => undefined)
        }
        this.currentError = classifySourceError(error)
        this.logger?.warn('mcp.source.connect_failed', {
          sourceId: this.sourceId,
          attempt,
          code: this.currentError.code,
        })
        if (attempt < this.maxRetries) {
          await delay(this.retryDelayMs)
        }
      } finally {
        clearTimeout(timer)
      }
    }

    this.currentState = 'unavailable'
  }

  async callTool(originalName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.handle) {
      this.currentState = 'unavailable'
      throw new AgentError('mcp_unavailable', `Module ${this.sourceId} is unavailable.`)
    }

    try {
      const response = await withTimeout(
        this.handle.client.callTool({ name: originalName, arguments: args }, undefined, {
          timeout: this.timeoutMs,
        }),
        this.timeoutMs + 1000,
        `call to ${this.sourceId}.${originalName} timed out`,
      )
      if (this.currentState === 'degraded') {
        this.currentState = 'ready'
      }
      return response
    } catch (error) {
      const classified = classifySourceError(error)
      this.currentError = classified
      this.currentState = 'degraded'
      this.logger?.warn('mcp.source.call_failed', {
        sourceId: this.sourceId,
        tool: originalName,
        code: classified.code,
      })
      throw new AgentError(classified.code, classified.message)
    }
  }

  async close(): Promise<void> {
    if (this.handle) {
      await this.handle.close().catch(() => undefined)
      this.handle = null
    }
  }
}

export class McpSourceManager {
  private readonly byId = new Map<string, McpSource>()

  constructor(sources: McpSource[]) {
    for (const source of sources) {
      this.byId.set(source.sourceId, source)
    }
  }

  list(): McpSource[] {
    return [...this.byId.values()]
  }

  get(sourceId: string): McpSource | undefined {
    return this.byId.get(sourceId)
  }

  async connectAll(): Promise<void> {
    await Promise.all(this.list().map((source) => source.connect()))
  }

  statuses(): SourceStatus[] {
    return this.list().map((source) => source.status())
  }

  async callTool(
    sourceId: string,
    originalName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const source = this.byId.get(sourceId)
    if (!source) {
      throw new AgentError('mcp_unavailable', `Unknown module ${sourceId}.`)
    }
    return source.callTool(originalName, args)
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.list().map((source) => source.close()))
  }
}
