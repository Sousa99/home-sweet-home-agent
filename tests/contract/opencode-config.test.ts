import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const configUrl = new URL('../../opencode.json', import.meta.url)

describe('opencode.json MCP configuration', () => {
  it('registers the Home Assistant MCP server without a literal secret', () => {
    const raw = readFileSync(configUrl, 'utf8')
    const config = JSON.parse(raw)
    const homeAssistant = config.mcp?.['home-assistant']

    expect(homeAssistant).toMatchObject({ type: 'remote', enabled: true, oauth: false })
    expect(homeAssistant.url).toBe('{env:HOME_ASSISTANT_MCP_URL}')
    expect(homeAssistant.headers.Authorization).toBe('Bearer {env:HOME_ASSISTANT_TOKEN}')
    expect(raw).not.toMatch(/Bearer\s+(?!\{env:)[A-Za-z0-9._-]{8,}/)
    expect(raw).not.toMatch(/ts\.net/)
  })

  it('keeps the existing module MCP servers enabled', () => {
    const config = JSON.parse(readFileSync(configUrl, 'utf8'))
    for (const name of [
      'bus-catcher',
      'fly-over-tracker',
      'procrastinator-tracker',
      'weather-psychic',
    ]) {
      expect(config.mcp[name]?.enabled).toBe(true)
    }
  })
})
