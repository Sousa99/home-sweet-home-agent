import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateTokenEntry } from '../../src/auth/token-tool.js'
import { loadConfig, parseTokenMap, readTokenFile } from '../../src/config/config.js'

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hsh-config-'))
  scratch.push(dir)
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

describe('loadConfig', () => {
  it('returns documented defaults', () => {
    const config = loadConfig({})
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(3400)
    expect(config.mcpSources.map((source) => source.sourceId)).toEqual([
      'bus',
      'flights',
      'tasks',
      'weather',
      'home_assistant',
    ])
    expect(config.llm.baseUrl).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(config.llm.model).toBe('deepseek-v4.1-flash')
    expect(config.unknownToolPolicy).toBe('destructive')
    expect(config.redact).toBe(true)
    expect(config.maxToolIterations).toBe(4)
  })

  it('parses a hashed token map', () => {
    const { tokenHash, entry } = generateTokenEntry({
      callerId: 'sousa',
      permissions: ['read', 'write'],
    })
    const config = loadConfig({ AGENT_AUTH_TOKENS: JSON.stringify({ [tokenHash]: entry }) })
    expect(config.authTokens[tokenHash]).toEqual(entry)
  })

  it('loads tokens from a pretty-printed AGENT_TOKENS_FILE', () => {
    const { tokenHash, entry } = generateTokenEntry({
      callerId: 'router',
      permissions: ['read'],
    })
    const path = tempFile('tokens.json', `${JSON.stringify({ [tokenHash]: entry }, null, 2)}\n`)
    const config = loadConfig({ AGENT_TOKENS_FILE: path })
    expect(config.authTokens[tokenHash]).toEqual(entry)
  })

  it('merges inline tokens over the token file', () => {
    const fileToken = generateTokenEntry({ callerId: 'file', permissions: ['read'] })
    const inlineToken = generateTokenEntry({ callerId: 'inline', permissions: ['read'] })
    const path = tempFile('tokens.json', JSON.stringify({ [fileToken.tokenHash]: fileToken.entry }))
    const config = loadConfig({
      AGENT_TOKENS_FILE: path,
      AGENT_AUTH_TOKENS: JSON.stringify({ [inlineToken.tokenHash]: inlineToken.entry }),
    })
    expect(config.authTokens[fileToken.tokenHash].callerId).toBe('file')
    expect(config.authTokens[inlineToken.tokenHash].callerId).toBe('inline')
  })

  it('reports a missing token file clearly', () => {
    expect(() => readTokenFile('/nonexistent/tokens.json')).toThrow(/could not be read/)
  })

  it('honors overrides', () => {
    const config = loadConfig({ AGENT_PORT: '9999', LOG_REDACT: 'false' })
    expect(config.port).toBe(9999)
    expect(config.redact).toBe(false)
  })

  it('rejects invalid token JSON', () => {
    expect(() => parseTokenMap('not-json')).toThrow(/valid JSON/)
  })

  it('rejects non-hashed token keys', () => {
    expect(() =>
      parseTokenMap(JSON.stringify({ short: { callerId: 'a', permissions: ['read'] } })),
    ).toThrow(/sha-256/)
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ AGENT_PORT: 'not-a-number' })).toThrow()
  })

  it('rejects an invalid MCP URL', () => {
    expect(() => loadConfig({ BUS_MCP_URL: 'not a url' })).toThrow(/valid URL/)
  })

  it('includes the Home Assistant MCP source with the documented default URL', () => {
    const source = loadConfig({}).mcpSources.find((s) => s.sourceId === 'home_assistant')
    expect(source?.url).toBe('http://localhost:8123/api/mcp')
    expect(source?.headers).toBeUndefined()
  })

  it('wires HOME_ASSISTANT_MCP_TOKEN into an Authorization header', () => {
    const source = loadConfig({ HOME_ASSISTANT_MCP_TOKEN: 'secret-token' }).mcpSources.find(
      (s) => s.sourceId === 'home_assistant',
    )
    expect(source?.headers).toEqual({ Authorization: 'Bearer secret-token' })
  })

  it('honors a custom HOME_ASSISTANT_MCP_URL', () => {
    const source = loadConfig({
      HOME_ASSISTANT_MCP_URL: 'http://ha.local:8123/api/mcp',
    }).mcpSources.find((s) => s.sourceId === 'home_assistant')
    expect(source?.url).toBe('http://ha.local:8123/api/mcp')
  })

  it('rejects an invalid Home Assistant MCP URL', () => {
    expect(() => loadConfig({ HOME_ASSISTANT_MCP_URL: 'not a url' })).toThrow(/valid URL/)
  })

  it('exposes the Home Assistant token only inside the source Authorization header', () => {
    const config = loadConfig({ HOME_ASSISTANT_MCP_TOKEN: 'secret-token' })
    const serialized = JSON.stringify(config)
    expect(serialized).toContain('Bearer secret-token')
    expect(serialized.match(/secret-token/g)?.length).toBe(1)
    expect(config).not.toHaveProperty('homeAssistantToken')
  })
})
