import { describe, expect, it } from 'vitest'
import { FakeLLMProvider } from '../fakes/fake-llm.js'
import { buildHarness, getJson } from '../fakes/harness.js'

const statuses = [
  { sourceId: 'bus', state: 'ready' as const, toolCount: 3 },
  { sourceId: 'tasks', state: 'unavailable' as const, toolCount: 0 },
]

describe('GET /healthz', () => {
  it('answers without authentication', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]) })
    const response = await getJson(harness.app, '/healthz')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'ok',
      service: 'home-sweet-home-agent',
    })
  })

  it('stays live while draining', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]), isDraining: () => true })
    expect((await getJson(harness.app, '/healthz')).status).toBe(200)
  })
})

describe('GET /readyz', () => {
  it('is ready without authentication when the provider is ready', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]), statuses })
    const response = await getJson(harness.app, '/readyz')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.mcp.bus).toEqual({ status: 'ready', tools: 3 })
    expect(JSON.stringify(body)).not.toMatch(/bearer|secret|api[_-]?key|https?:\/\//i)
  })

  it('reports not ready when the provider is not ready', async () => {
    const provider = new FakeLLMProvider([])
    provider.ready = false
    const harness = buildHarness({ provider, statuses })
    const response = await getJson(harness.app, '/readyz')

    expect(response.status).toBe(503)
    expect((await response.json()).status).toBe('not_ready')
  })

  it('reports draining while shutting down', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]), isDraining: () => true })
    const response = await getJson(harness.app, '/readyz')

    expect(response.status).toBe(503)
    expect((await response.json()).status).toBe('draining')
  })

  it('keeps the detailed health endpoint authenticated', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]) })
    expect((await getJson(harness.app, '/health')).status).toBe(401)
  })
})
