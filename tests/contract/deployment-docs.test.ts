import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const docUrl = new URL('../../docs/deployment.md', import.meta.url)

function deploymentDoc(): string {
  return readFileSync(docUrl, 'utf8')
}

describe('deployment contract document', () => {
  it('documents every startup variable the agent reads', () => {
    const doc = deploymentDoc()
    for (const name of [
      'AGENT_HOST',
      'AGENT_PORT',
      'AGENT_AUTH_TOKENS',
      'AGENT_TOKENS_FILE',
      'LLM_BASE_URL',
      'LLM_API_KEY',
      'LLM_MODEL',
      'HOME_ASSISTANT_MCP_URL',
      'HOME_ASSISTANT_MCP_TOKEN',
      'BUS_MCP_URL',
      'FLIGHTS_MCP_URL',
      'TASKS_MCP_URL',
      'WEATHER_MCP_URL',
    ]) {
      expect(doc).toContain(name)
    }
  })

  it('documents the image, probes, and required secrets', () => {
    const doc = deploymentDoc()
    expect(doc).toContain('ghcr.io/sousa99/home-sweet-home-agent')
    expect(doc).toContain('/healthz')
    expect(doc).toContain('/readyz')
    expect(doc).toMatch(/secret/i)
  })

  it('contains no credential values', () => {
    expect(deploymentDoc()).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/)
  })
})
