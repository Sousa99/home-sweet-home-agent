import { describe, expect, it } from 'vitest'
import { namespaceTool, splitNamespacedTool, ToolRegistry } from '../../src/mcp/registry.js'

const classify = (_sourceId: string, originalName: string): 'read' | 'destructive' =>
  originalName.endsWith('delete') ? 'destructive' : 'read'

describe('ToolRegistry', () => {
  it('namespaces tools by source into wire-safe names', () => {
    const registry = new ToolRegistry()
    registry.registerSource('tasks', [{ name: 'task.list' }, { name: 'task.delete' }], classify)
    expect(registry.list().map((tool) => tool.name)).toEqual([
      namespaceTool('tasks', 'task.list'),
      namespaceTool('tasks', 'task.delete'),
    ])
    expect(registry.get(namespaceTool('tasks', 'task.delete'))?.policy).toBe('destructive')
    expect(registry.get(namespaceTool('tasks', 'task.delete'))?.originalName).toBe('task.delete')
    expect(namespaceTool('tasks', 'task.delete')).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('avoids collisions across sources', () => {
    const registry = new ToolRegistry()
    registry.registerSource('a', [{ name: 'ping' }], () => 'read')
    registry.registerSource('b', [{ name: 'ping' }], () => 'read')
    expect(registry.get(namespaceTool('a', 'ping'))?.sourceId).toBe('a')
    expect(registry.get(namespaceTool('b', 'ping'))?.sourceId).toBe('b')
  })

  it('clears a single source', () => {
    const registry = new ToolRegistry()
    registry.registerSource('a', [{ name: 'ping' }], () => 'read')
    registry.registerSource('b', [{ name: 'pong' }], () => 'read')
    registry.clearSource('a')
    expect(registry.list().map((tool) => tool.name)).toEqual([namespaceTool('b', 'pong')])
  })

  it('splits namespaced names', () => {
    expect(splitNamespacedTool(namespaceTool('tasks', 'task.delete'))).toEqual({
      sourceId: 'tasks',
      toolName: 'task_delete',
    })
    expect(namespaceTool('bus', 'get_stop')).toBe('bus__get_stop')
    expect(splitNamespacedTool('nodot')).toBeNull()
  })

  it('namespaces Home Assistant tools that already contain double underscores', () => {
    const registry = new ToolRegistry()
    registry.registerSource(
      'home_assistant',
      [{ name: 'intent__HassTurnOn' }, { name: 'homeassistant__GetLiveContext' }],
      () => 'read',
    )
    expect(namespaceTool('home_assistant', 'intent__HassTurnOn')).toBe(
      'home_assistant__intent__HassTurnOn',
    )
    expect(splitNamespacedTool('home_assistant__intent__HassTurnOn')).toEqual({
      sourceId: 'home_assistant',
      toolName: 'intent__HassTurnOn',
    })
    expect(registry.get('home_assistant__homeassistant__GetLiveContext')?.sourceId).toBe(
      'home_assistant',
    )
    expect(registry.get('home_assistant__homeassistant__GetLiveContext')?.originalName).toBe(
      'homeassistant__GetLiveContext',
    )
  })
})
