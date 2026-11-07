import { describe, expect, it } from 'vitest'
import { classifyTool, KNOWN_TOOL_POLICIES, permissionForPolicy } from '../../src/config/policy.js'

describe('tool policy', () => {
  it('classifies known read tools', () => {
    expect(classifyTool('bus', 'get_stop_times', 'destructive')).toBe('read')
    expect(classifyTool('flights', 'planes_over', 'destructive')).toBe('read')
    expect(classifyTool('weather', 'weather.search', 'destructive')).toBe('read')
    expect(classifyTool('tasks', 'task.list', 'destructive')).toBe('read')
  })

  it('classifies known write tools', () => {
    expect(classifyTool('tasks', 'task.create', 'destructive')).toBe('write')
    expect(classifyTool('bus', 'add_stop', 'destructive')).toBe('write')
  })

  it('classifies destructive tools including task completion', () => {
    expect(classifyTool('tasks', 'task.delete', 'read')).toBe('destructive')
    expect(classifyTool('tasks', 'task.set_status', 'read')).toBe('destructive')
    expect(classifyTool('bus', 'remove_stop', 'read')).toBe('destructive')
  })

  it('falls back for unknown tools', () => {
    expect(classifyTool('mystery', 'tool', 'destructive')).toBe('destructive')
    expect(classifyTool('mystery', 'tool', 'write')).toBe('write')
  })

  it('classifies Home Assistant read tools', () => {
    expect(classifyTool('home_assistant', 'homeassistant__GetLiveContext', 'destructive')).toBe(
      'read',
    )
    expect(classifyTool('home_assistant', 'llm__GetDateTime', 'destructive')).toBe('read')
    expect(classifyTool('home_assistant', 'homeassistant__GetState', 'destructive')).toBe('read')
    expect(classifyTool('home_assistant', 'todo__get_items', 'destructive')).toBe('read')
  })

  it('classifies benign Home Assistant domain controls as write', () => {
    expect(classifyTool('home_assistant', 'light__HassLightSet', 'destructive')).toBe('write')
    expect(
      classifyTool('home_assistant', 'climate__HassClimateSetTemperature', 'destructive'),
    ).toBe('write')
    expect(classifyTool('home_assistant', 'media_player__HassMediaPause', 'destructive')).toBe(
      'write',
    )
    expect(classifyTool('home_assistant', 'todo__HassListAddItem', 'destructive')).toBe('write')
  })

  it('classifies generic Home Assistant entity control as destructive', () => {
    expect(classifyTool('home_assistant', 'intent__HassTurnOn', 'read')).toBe('destructive')
    expect(classifyTool('home_assistant', 'intent__HassTurnOff', 'read')).toBe('destructive')
    expect(classifyTool('home_assistant', 'intent__HassToggle', 'read')).toBe('destructive')
    expect(classifyTool('home_assistant', 'intent__HassSetPosition', 'read')).toBe('destructive')
  })

  it('falls back for unknown Home Assistant tools', () => {
    expect(classifyTool('home_assistant', 'custom__Mystery', 'destructive')).toBe('destructive')
    expect(classifyTool('home_assistant', 'custom__Mystery', 'write')).toBe('write')
  })

  it('maps policy to the required permission', () => {
    expect(permissionForPolicy('read')).toBe('read')
    expect(permissionForPolicy('write')).toBe('write')
    expect(permissionForPolicy('destructive')).toBe('destructive')
  })

  it('covers every discovered module tool', () => {
    for (const name of [
      'bus.list_lines',
      'bus.search_stops',
      'bus.get_stop',
      'bus.get_stop_times',
      'bus.get_status',
      'bus.get_config',
      'bus.refresh_schedule',
      'bus.add_stop',
      'bus.update_stop',
      'bus.remove_stop',
      'flights.planes_over',
      'tasks.task.list',
      'tasks.task.get',
      'tasks.tag.list',
      'tasks.user.list',
      'tasks.task.create',
      'tasks.task.update',
      'tasks.task.comment',
      'tasks.task.set_status',
      'tasks.task.delete',
      'weather.weather.get_forecast',
      'weather.weather.search',
    ]) {
      expect(KNOWN_TOOL_POLICIES[name]).toBeDefined()
    }
  })
})
