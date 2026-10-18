import type { ToolPolicy } from '../config/policy.js'

export interface RawTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface ToolDescriptor {
  name: string
  sourceId: string
  originalName: string
  description: string
  inputSchema: Record<string, unknown>
  policy: ToolPolicy
}

const NAMESPACE_SEPARATOR = '__'
const ILLEGAL_CHARACTERS = /[^a-zA-Z0-9_-]/g

/**
 * Provider tool-calling APIs (OpenAI, OpenCode Go) require function names to
 * match `^[a-zA-Z0-9_-]+$`, but module tool names contain dots
 * (e.g. `task.create`). Replace illegal characters with underscores.
 */
export function sanitizeToolName(name: string): string {
  return name.replace(ILLEGAL_CHARACTERS, '_')
}

export function namespaceTool(sourceId: string, toolName: string): string {
  return `${sanitizeToolName(sourceId)}${NAMESPACE_SEPARATOR}${sanitizeToolName(toolName)}`
}

export function splitNamespacedTool(name: string): { sourceId: string; toolName: string } | null {
  const index = name.indexOf(NAMESPACE_SEPARATOR)
  if (index <= 0 || index >= name.length - NAMESPACE_SEPARATOR.length) return null
  return {
    sourceId: name.slice(0, index),
    toolName: name.slice(index + NAMESPACE_SEPARATOR.length),
  }
}

export type ToolClassifier = (sourceId: string, originalName: string) => ToolPolicy

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>()

  registerSource(
    sourceId: string,
    rawTools: RawTool[],
    classify: ToolClassifier,
  ): ToolDescriptor[] {
    const registered: ToolDescriptor[] = []
    for (const raw of rawTools) {
      const name = namespaceTool(sourceId, raw.name)
      const descriptor: ToolDescriptor = {
        name,
        sourceId,
        originalName: raw.name,
        description: raw.description ?? '',
        inputSchema: normalizeSchema(raw.inputSchema),
        policy: classify(sourceId, raw.name),
      }
      this.tools.set(name, descriptor)
      registered.push(descriptor)
    }
    return registered
  }

  clearSource(sourceId: string): void {
    for (const [name, descriptor] of this.tools) {
      if (descriptor.sourceId === sourceId) {
        this.tools.delete(name)
      }
    }
  }

  get(name: string): ToolDescriptor | undefined {
    return this.tools.get(name)
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()]
  }

  listBySource(sourceId: string): ToolDescriptor[] {
    return [...this.tools.values()].filter((tool) => tool.sourceId === sourceId)
  }

  get size(): number {
    return this.tools.size
  }
}

function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return schema as Record<string, unknown>
  }
  return { type: 'object', properties: {} }
}
