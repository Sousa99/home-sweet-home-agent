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

The implementation is being built incrementally. Copy the environment template before starting:

```bash
cp .env.example .env
pnpm install
pnpm test
pnpm dev
```

The initial service contract is expected to provide a private HTTP interface for conversation,
confirmation, health, and notification requests. MCP server URLs and LLM credentials are configured
through environment variables, never committed to the repository. The initial Compose file assumes
the dashboard exposes MCP ports on the host; a shared private network or authenticated internal
endpoint can replace that arrangement when deployment is finalized.

## Intended capabilities

- Query weather, bus departures, flights, and active tasks
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

This repository is the initial boundary and service scaffold. MCP session management, provider
adapters, Home Assistant integration, and optional text transports should be added as independently
testable features.
