import { describe, expect, it } from 'vitest'
import type { SourceStatus } from '../../src/mcp/source.js'
import { FakeLLMProvider } from '../fakes/fake-llm.js'
import { buildHarness, getJson } from '../fakes/harness.js'

const statuses: SourceStatus[] = [
  { sourceId: 'bus', state: 'ready', toolCount: 3 },
  {
    sourceId: 'tasks',
    state: 'unavailable',
    toolCount: 0,
    error: { code: 'mcp_unavailable', message: 'Module request failed.' },
  },
]

describe('GET /health', () => {
  it('reports overall, per-source, and LLM readiness', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]), statuses })
    const response = await getJson(harness.app, '/health', harness.auth)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.service).toBe('home-sweet-home-agent')
    expect(body.status).toBe('degraded')
    expect(body.mcp.bus).toEqual({ status: 'ready', tools: 3 })
    expect(body.mcp.tasks.status).toBe('unavailable')
    expect(body.llm).toMatchObject({ ready: true, provider: 'fake', model: 'fake-model' })
  })

  it('reports down when nothing is ready', async () => {
    const provider = new FakeLLMProvider([])
    provider.ready = false
    const harness = buildHarness({
      provider,
      statuses: [{ sourceId: 'bus', state: 'unavailable', toolCount: 0 }],
    })
    const body = await (await getJson(harness.app, '/health', harness.auth)).json()
    expect(body.status).toBe('down')
  })

  it('requires authentication', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]) })
    const response = await getJson(harness.app, '/health')
    expect(response.status).toBe(401)
  })
})
