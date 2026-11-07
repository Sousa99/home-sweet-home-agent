import { afterEach, describe, expect, it } from 'vitest'
import { classifyTool } from '../../src/config/policy.js'
import { ToolRegistry } from '../../src/mcp/registry.js'
import { McpSource, McpSourceManager } from '../../src/mcp/source.js'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { startFakeMcpServer, type FakeMcpServer } from '../fakes/fake-mcp-server.js'
import { buildHarness, postJson } from '../fakes/harness.js'

let server: FakeMcpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

const nameSchema = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
}

async function setupHomeAssistant(): Promise<{ registry: ToolRegistry; source: McpSource }> {
  server = await startFakeMcpServer({
    tools: [
      {
        name: 'light__HassLightSet',
        inputSchema: nameSchema,
        handler: () => 'living room light set',
      },
      {
        name: 'intent__HassTurnOn',
        inputSchema: nameSchema,
        handler: () => 'device turned on',
      },
    ],
  })
  const registry = new ToolRegistry()
  const source = new McpSource({
    sourceId: 'home_assistant',
    url: server.url,
    headers: { Authorization: 'Bearer ha-token' },
    timeoutMs: 2000,
    registry,
    classify: (sourceId, name) => classifyTool(sourceId, name, 'destructive'),
    maxRetries: 0,
  })
  await source.connect()
  return { registry, source }
}

describe('Home Assistant control (integration)', () => {
  it('auto-executes a benign domain control for a write caller', async () => {
    const { registry, source } = await setupHomeAssistant()
    const provider = new FakeLLMProvider([
      toolCallTurn([
        { name: 'home_assistant__light__HassLightSet', args: { name: 'Living Room' } },
      ]),
      (input) => messageTurn(input.messages.find((m) => m.role === 'tool')?.content ?? ''),
    ])
    const harness = buildHarness({ provider, registry, sources: new McpSourceManager([source]) })

    const body = await (
      await postJson(harness.app, '/conversation', { message: 'set the light' }, harness.auth)
    ).json()

    expect(body.status).toBe('completed')
    expect(body.trace?.[0]).toMatchObject({
      tool: 'home_assistant__light__HassLightSet',
      policy: 'write',
      outcome: 'executed',
    })
    expect(server?.calls).toEqual([{ name: 'light__HassLightSet', args: { name: 'Living Room' } }])
  })

  it('requires confirmation for generic entity control and executes once on approval', async () => {
    const { registry, source } = await setupHomeAssistant()
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'home_assistant__intent__HassTurnOn', args: { name: 'Garage' } }]),
    ])
    const harness = buildHarness({ provider, registry, sources: new McpSourceManager([source]) })

    const convo = await (
      await postJson(harness.app, '/conversation', { message: 'open the garage' }, harness.auth)
    ).json()

    expect(convo.status).toBe('confirmation_required')
    expect(convo.trace?.[0]).toMatchObject({
      tool: 'home_assistant__intent__HassTurnOn',
      sourceId: 'home_assistant',
      policy: 'destructive',
      outcome: 'confirmation_required',
    })
    expect(server?.calls).toEqual([])

    const approve = await (
      await postJson(
        harness.app,
        '/confirm',
        {
          conversationId: convo.conversationId,
          confirmationToken: convo.confirmation.token,
          decision: 'approve',
        },
        harness.auth,
      )
    ).json()

    expect(approve.status).toBe('completed')
    expect(approve.trace?.[0]).toMatchObject({ policy: 'destructive', outcome: 'executed' })
    expect(server?.calls).toEqual([{ name: 'intent__HassTurnOn', args: { name: 'Garage' } }])

    const replay = await postJson(
      harness.app,
      '/confirm',
      {
        conversationId: convo.conversationId,
        confirmationToken: convo.confirmation.token,
        decision: 'approve',
      },
      harness.auth,
    )
    expect(replay.status).toBe(409)
    expect(server?.calls).toHaveLength(1)
  })

  it('does not execute a rejected generic control', async () => {
    const { registry, source } = await setupHomeAssistant()
    const provider = new FakeLLMProvider([
      toolCallTurn([{ name: 'home_assistant__intent__HassTurnOn', args: { name: 'Garage' } }]),
    ])
    const harness = buildHarness({ provider, registry, sources: new McpSourceManager([source]) })

    const convo = await (
      await postJson(harness.app, '/conversation', { message: 'open the garage' }, harness.auth)
    ).json()
    const reject = await (
      await postJson(
        harness.app,
        '/confirm',
        {
          conversationId: convo.conversationId,
          confirmationToken: convo.confirmation.token,
          decision: 'reject',
        },
        harness.auth,
      )
    ).json()

    expect(reject.trace?.[0]).toMatchObject({ outcome: 'rejected' })
    expect(server?.calls).toEqual([])
  })
})
