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
})
