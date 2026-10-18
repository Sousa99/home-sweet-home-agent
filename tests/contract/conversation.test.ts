import { describe, expect, it } from 'vitest'
import { FakeLLMProvider, messageTurn } from '../fakes/fake-llm.js'
import { buildHarness, postJson } from '../fakes/harness.js'

describe('POST /conversation', () => {
  it('returns a completed reply', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([messageTurn('Hello!')]) })
    const response = await postJson(harness.app, '/conversation', { message: 'hi' }, harness.auth)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('completed')
    expect(body.reply).toBe('Hello!')
    expect(typeof body.conversationId).toBe('string')
  })

  it('accepts an existing conversation id', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([messageTurn('again')]) })
    const response = await postJson(
      harness.app,
      '/conversation',
      { message: 'hi', conversationId: 'c-fixed' },
      harness.auth,
    )
    expect((await response.json()).conversationId).toBe('c-fixed')
  })

  it('returns 400 for a malformed body', async () => {
    const harness = buildHarness({ provider: new FakeLLMProvider([]) })
    const response = await postJson(
      harness.app,
      '/conversation',
      { notMessage: true },
      harness.auth,
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('malformed_request')
  })

  it('returns 401 without a token and never calls the provider', async () => {
    const provider = new FakeLLMProvider([messageTurn('x')])
    const harness = buildHarness({ provider })
    const response = await postJson(harness.app, '/conversation', { message: 'hi' })
    expect(response.status).toBe(401)
    expect(provider.calls).toHaveLength(0)
  })

  it('returns 401 for an unknown token', async () => {
    const provider = new FakeLLMProvider([messageTurn('x')])
    const harness = buildHarness({ provider })
    const response = await postJson(
      harness.app,
      '/conversation',
      { message: 'hi' },
      { authorization: 'Bearer nope' },
    )
    expect(response.status).toBe(401)
    expect(provider.calls).toHaveLength(0)
  })
})
