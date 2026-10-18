# Home Sweet Home — Agent

The centralized conversation and MCP gateway for Home Sweet Home. It gives Home Assistant and
optional text clients one controlled interface to the household module MCP servers without making
those clients responsible for MCP sessions, LLM orchestration, or write safety.

```text
┌──────────────────────────────────────────────────────────────┐
│ Home Sweet Home · Agent                                      │
├──────────────────────┬───────────────────────────────────────┤
│ Input surfaces       │ Core                                  │
│ Home Assistant       │ Conversation + configurable LLM        │
│ Telegram (optional)  │ Authorization + confirmations          │
├──────────────────────┴───────────────────────────────────────┤
│ Persistent MCP sessions · audit · notifications               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
             Home Sweet Home module MCP servers
```

## Responsibilities

| Area | Owned here |
| ---- | ---------- |
| MCP | Connect to and manage module MCP sessions |
| Agent | Convert user requests into authorized tool calls |
| LLM | Provider-agnostic model integration and prompts |
| Safety | Identity, permissions, confirmations, and audit events |
| Adapters | Home Assistant conversation API and optional text clients |
| Notifications | Dispatch requests to Home Assistant or other adapters |
| Devices | Not owned here; configured in `home-sweet-home-home-assistant` |
| Dashboard | Not owned here; configured in `home-sweet-home-dashboard` |

## Architecture

```text
Home Assistant ─┐
Optional text ───┼── Agent API ── Conversation/LLM ── MCP client pool
                 │                                      │
                 └── Notifications ◄────────────────────┘
                                                        │
                         bus · flights · tasks · weather MCP servers
```

The agent is the recommended single MCP client for production. Module MCP endpoints should remain
private to the deployment network. Home Assistant and text adapters should call the agent rather
than independently connecting to every module.

## Quick start

```bash
cp .env.example .env
pnpm install

# Generate a token into a readable, git-ignored file (secrets/tokens.json)
pnpm token:generate -- --caller-id you --permissions read,write,destructive --out secrets/tokens.json

pnpm test        # unit, contract, and integration tests (no credentials needed)
pnpm dev         # start the agent on http://127.0.0.1:3400
pnpm chat -- --token "<the token>"          # interactive local chat
pnpm chat -- --token "<the token>" --once "When is the next bus at my stop?"
```

The agent exposes a private HTTP interface for conversation, confirmation, health, and notification
requests. MCP server URLs and LLM credentials are configured through environment variables, never
committed. See `docs/http-contract.md` for the full contract and `docs/agent.http` for runnable
requests.

## Intended capabilities

- Query weather, bus departures, flights, and active tasks
- Show which module tools were used for each request (a response `trace` plus `info`-level logs)
- Create and update tasks through explicit user requests
- Require confirmation for deletion, completion, and other destructive actions
- Maintain separate sessions and permissions per household user
- Send proactive bus, task, flight, and service-health notifications
- Support configurable local or cloud LLM providers
- Expose one adapter-neutral conversation contract to multiple clients

## Configuration

```text
.env.example       # safe variable names and local defaults
src/mcp/           # MCP transport and session management
src/llm/           # provider abstraction and model adapters
src/conversation/  # request lifecycle and tool-call policy
src/auth/          # users, permissions, and confirmation state
src/notifications/ # outbound event contract and dispatch
src/adapters/      # Home Assistant and optional text adapters
tests/             # unit, contract, and integration tests
```

The gateway must not log message contents, model prompts, tool arguments, tokens, or household
locations by default. Sensitive audit fields require explicit redaction policy and configuration.

## Related repositories

| Repository | Purpose |
| ---------- | ------- |
| `home-sweet-home-dashboard` | TV / large-screen dashboard and local module deployment |
| `home-sweet-home-modules` | Module implementations and published MCP backends |
| `home-sweet-home-home-assistant` | Devices, voice, speakers, automations, and notifications |

## Quality gates

The agent must pass formatting, linting, typechecking, unit tests, MCP contract tests, and an
integration smoke test against representative module MCP servers before deployment.

## Project status

The agent core is implemented: bearer-token authorization, one managed MCP session per module with
namespaced tool discovery, a provider-agnostic OpenAI-compatible LLM loop, read/write/destructive
tool policy with single-use confirmations, redacted logging, a health endpoint, a token generator,
a local chat CLI, and a deterministic fake-based test suite. Home Assistant as a fifth MCP source
and the Home Assistant conversation adapter are later features.
