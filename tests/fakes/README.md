# Test fakes

Deterministic doubles so the whole agent can be tested with no credentials and no live services.

| File | Purpose |
| ---- | ------- |
| `fake-llm.ts` | `FakeLLMProvider` runs a scripted sequence of message / tool-call turns and records every `chat()` input. Helpers `messageTurn()` and `toolCallTurn()`. |
| `fake-mcp-server.ts` | `startFakeMcpServer({ tools })` runs a real in-process streamable HTTP MCP server on a random port. Tools can return results, report errors, or hang. `readTool()` builds a simple read tool. |
| `harness.ts` | `buildHarness()` composes `createApp` with fakes and returns an authenticated app plus `postJson` / `getJson` helpers. Use it for HTTP contract and integration tests. |
| `sample-config.ts` | `testConfig()`, `makeToken()`, `silentLogger()`, and `capturingLogger()` helpers. |

## Notes

- No external network, API keys, or module processes are required.
- The fake MCP server uses the official MCP SDK server + `StreamableHTTPServerTransport`, so tests
  exercise the real transport, sessions, and tool discovery.
- `capturingLogger()` collects emitted log lines so tests can assert that prompts, tool arguments,
  tokens, and locations never appear (see `tests/integration/log-redaction.test.ts`).
- Confirmation expiry is tested with a controllable clock passed to `ConfirmationStore` or the harness.
