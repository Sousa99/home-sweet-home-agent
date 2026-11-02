import { describe, expect, it } from 'vitest'
import { FakeLLMProvider, messageTurn, toolCallTurn } from '../fakes/fake-llm.js'
import { buildHarness, postJson } from '../fakes/harness.js'
import { capturingLogger } from '../fakes/sample-config.js'

describe('log redaction (integration)', () => {
  it('never logs prompts, tool arguments, or the bearer token', async () => {
    const { logger, lines } = capturingLogger()
    const harness = buildHarness({
      logger,
      provider: new FakeLLMProvider([
        toolCallTurn([{ name: 'bus__get_stop_times', args: { stopId: 'SECRET-STOP' } }]),
        messageTurn('done'),
      ]),
      registerTools: (registry) =>
        registry.registerSource(
          'bus',
          [
            {
              name: 'get_stop_times',
              inputSchema: {
                type: 'object',
                properties: { stopId: { type: 'string' } },
                required: ['stopId'],
              },
            },
          ],
          () => 'read',
        ),
      callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    })

    await postJson(
      harness.app,
      '/conversation',
      { message: 'MESSAGE-SECRET-PROMPT about my home location' },
      harness.auth,
    )

    const output = lines.join('\n')
    expect(output).not.toContain('MESSAGE-SECRET-PROMPT')
    expect(output).not.toContain('SECRET-STOP')
    expect(output).not.toContain('home location')
    expect(output).not.toContain(harness.token.token)
    expect(output.length).toBeGreaterThan(0)
  })

  it('redacts the Home Assistant token and control arguments from logs', async () => {
    const { logger, lines } = capturingLogger()
    const harness = buildHarness({
      logger,
      provider: new FakeLLMProvider([
        toolCallTurn([
          { name: 'home_assistant__intent__HassTurnOn', args: { name: 'SECRET-GARAGE' } },
        ]),
      ]),
      registerTools: (registry) =>
        registry.registerSource(
          'home_assistant',
          [
            {
              name: 'intent__HassTurnOn',
              inputSchema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
          ],
          () => 'destructive',
        ),
    })

    await postJson(harness.app, '/conversation', { message: 'open SECRET-GARAGE' }, harness.auth)

    const output = lines.join('\n')
    expect(output).toContain('home_assistant__intent__HassTurnOn')
    expect(output).toContain('confirmation_required')
    expect(output).not.toContain('SECRET-GARAGE')

    logger.info('ha.source', {
      sourceId: 'home_assistant',
      authorization: 'Bearer ha-secret-token',
    })
    expect(lines.join('\n')).not.toContain('ha-secret-token')
    expect(lines.join('\n')).toContain('[redacted]')
  })
})
