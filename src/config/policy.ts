import type { Permission } from '../auth/caller.js'

export type ToolPolicy = 'read' | 'write' | 'destructive'

/**
 * Explicit, agent-owned safety classification for every known namespaced tool.
 * Unknown tools fall back to the configured `AGENT_UNKNOWN_TOOL_POLICY`.
 */
const TOOL_POLICY: Record<string, ToolPolicy> = {
  'bus.list_lines': 'read',
  'bus.search_stops': 'read',
  'bus.get_stop': 'read',
  'bus.get_stop_times': 'read',
  'bus.get_status': 'read',
  'bus.get_config': 'read',
  'bus.refresh_schedule': 'write',
  'bus.add_stop': 'write',
  'bus.update_stop': 'write',
  'bus.remove_stop': 'destructive',

  'flights.planes_over': 'read',

  'tasks.task.list': 'read',
  'tasks.task.get': 'read',
  'tasks.tag.list': 'read',
  'tasks.user.list': 'read',
  'tasks.task.create': 'write',
  'tasks.task.update': 'write',
  'tasks.task.comment': 'write',
  'tasks.task.set_status': 'destructive',
  'tasks.task.delete': 'destructive',

  'weather.weather.get_forecast': 'read',
  'weather.weather.search': 'read',
}

export const KNOWN_TOOL_POLICIES: Readonly<Record<string, ToolPolicy>> = TOOL_POLICY

/** Policy keys are the readable `sourceId.originalName`, independent of the wire-safe tool name. */
export function policyKey(sourceId: string, originalName: string): string {
  return `${sourceId}.${originalName}`
}

export function classifyTool(
  sourceId: string,
  originalName: string,
  fallback: ToolPolicy,
): ToolPolicy {
  return TOOL_POLICY[policyKey(sourceId, originalName)] ?? fallback
}

export function permissionForPolicy(policy: ToolPolicy): Permission {
  return policy
}
