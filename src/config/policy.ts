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

export const HOME_ASSISTANT_SOURCE_ID = 'home_assistant'

/**
 * Home Assistant tools are discovered dynamically and prefixed by domain, so they cannot live in the
 * static table above. Generic entity control is destructive because its effect depends on the target
 * entity (Home Assistant exposes `cover` to Assist by default), while domain-specific benign controls
 * stay `write` and query tools stay `read`. Anything else falls back to the configured policy.
 */
const HOME_ASSISTANT_TOOL_POLICY: Record<string, ToolPolicy> = {
  homeassistant__GetLiveContext: 'read',
  homeassistant__GetState: 'read',
  llm__GetDateTime: 'read',
  todo__get_items: 'read',

  light__HassLightSet: 'write',
  climate__HassClimateSetTemperature: 'write',
  todo__HassListAddItem: 'write',
}

const HOME_ASSISTANT_WRITE_DOMAINS = ['media_player__']

const HOME_ASSISTANT_DESTRUCTIVE_PREFIXES = ['intent__']

export function classifyHomeAssistantTool(originalName: string, fallback: ToolPolicy): ToolPolicy {
  const known = HOME_ASSISTANT_TOOL_POLICY[originalName]
  if (known) return known
  if (HOME_ASSISTANT_WRITE_DOMAINS.some((prefix) => originalName.startsWith(prefix))) return 'write'
  if (HOME_ASSISTANT_DESTRUCTIVE_PREFIXES.some((prefix) => originalName.startsWith(prefix))) {
    return 'destructive'
  }
  return fallback
}

/** Policy keys are the readable `sourceId.originalName`, independent of the wire-safe tool name. */
export function policyKey(sourceId: string, originalName: string): string {
  return `${sourceId}.${originalName}`
}

export function classifyTool(
  sourceId: string,
  originalName: string,
  fallback: ToolPolicy,
): ToolPolicy {
  if (sourceId === HOME_ASSISTANT_SOURCE_ID) {
    return classifyHomeAssistantTool(originalName, fallback)
  }
  return TOOL_POLICY[policyKey(sourceId, originalName)] ?? fallback
}

export function permissionForPolicy(policy: ToolPolicy): Permission {
  return policy
}
