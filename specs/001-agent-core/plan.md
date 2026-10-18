# Implementation Plan: Centralized MCP Agent Core

**Branch**: `001-agent-core` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-agent-core/spec.md`

## Summary

Build the Home Sweet Home agent core: a private Node.js/TypeScript HTTP service that exposes
`POST /conversation`, `POST /confirm`, `POST /notifications`, and `GET /health`. It authenticates
callers with bearer tokens, owns one managed MCP client session per module source (bus, flights,
tasks, weather), namespaces and validates discovered tools, runs a provider-agnostic LLM tool-calling
loop, and enforces read/write/destructive policy with explicit single-use confirmations for
destructive actions. Hanging off that: a redacting logger, in-memory conversation and confirmation
state, and deterministic fake LLM/MCP test doubles.

The technical approach is a single TypeScript service built on the official MCP TypeScript SDK client
(streamable HTTP), a Hono-based HTTP layer, zod-validated configuration, and an OpenAI-compatible
chat-completions adapter (default: OpenCode Go `deepseek-v4.1-flash`). Test-first with Vitest.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js >= 24 (ESM, `type: module`)

**Primary Dependencies**: `@modelcontextprotocol/sdk` ^1.32 (MCP client + streamable HTTP transport),
`hono` + `@hono/node-server` (HTTP layer), `zod` 4 (config + request validation), `ajv` (model tool
argument validation against discovered JSON Schema). Dev: `vitest`, `tsx`, `typescript`, `eslint`,
`prettier`.

**Storage**: N/A — conversations and pending confirmations are in-memory only (FR-019). No database.

**Testing**: Vitest, three tiers — unit (`tests/unit`), HTTP contract (`tests/contract`), and
integration with fake MCP servers + fake LLM (`tests/integration`). Shared fakes in `tests/fakes`.

**Target Platform**: Linux container (Docker) on a private home/deployment network; `node:24-slim`.

**Project Type**: Single project — one backend HTTP service.

**Performance Goals**: Modest household load. `GET /health` resolves source state within 10s
(SC-004); module timeout/outage yields a bounded structured failure within 30s while healthy sources
stay usable (SC-005); no request hangs indefinitely (FR-015).

**Constraints**: All MCP/LLM calls bounded by configurable timeouts; secret-free responses and
redacted logs by default (FR-020, SC-007); destructive tools never execute without an unexpired,
caller-approved, single-use confirmation (SC-002); unauthorized callers rejected before any LLM or
MCP call (SC-003); one MCP session per source, respecting the procrastinator single-session
constraint (FR-004, SC-008).

**Scale/Scope**: A handful of household callers; 4 MCP sources; ~20 namespaced tools; 4 HTTP
endpoints; single process; in-memory state loss on restart is acceptable and documented (SC-010).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Check | Status |
| --------- | ----- | ------ |
| I. One Controlled MCP Host | `McpSourceManager` owns exactly one `Client`/transport per source at process scope; clients reach modules only through the agent; the MCP port is not re-exposed. | PASS |
| II. Explicit Authorization | Bearer token → `CallerIdentity` with explicit `read`/`write`/`destructive` permissions; unknown tokens rejected in middleware before the LLM/MCP path. | PASS |
| III. Safe Tool Execution | Config-driven `ToolPolicy` classifies every tool; destructive calls return a confirmation request; approved calls re-validate and execute once; responses reflect the real tool result. | PASS |
| IV. Provider-Agnostic Intelligence | `LLMProvider` interface with an OpenAI-compatible adapter; provider/model/base URL/key chosen by configuration; cloud egress documented. | PASS |
| V. Private by Default | HTTP/auth/MCP endpoints bound to the private network; redacting structured logger on by default; secrets never serialized in responses or logs. | PASS |
| VI. Contract-First Integration | `contracts/` documents the HTTP API, LLM provider interface, and MCP client contract; contract tests cover each. | PASS |
| VII. Test-First Development | Every behavior in `tasks.md` begins with a failing unit/contract/integration test using fakes. | PASS |

**Post-Phase 1 re-check**: No new violations introduced by the design. No gate failures;
Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md
│   ├── llm-provider.md
│   └── mcp-client.md
└── tasks.md             # created by /speckit.tasks (not this command)
```

### Source Code (repository root)

```text
src/
├── index.ts                     # composition root: config → sources → server.listen
├── config/
│   ├── config.ts                # zod env schema + loadConfig()
│   └── policy.ts                # tool safety policy table (read/write/destructive)
├── http/
│   ├── app.ts                   # Hono app factory (dependency-injected, testable)
│   ├── errors.ts                # structured error codes + safe messages
│   └── middleware/
│       └── auth.ts              # bearer-token authentication
├── auth/
│   ├── caller.ts                # CallerIdentity + Permission types
│   └── tokens.ts                # token → identity lookup
├── mcp/
│   ├── client.ts                # Client + StreamableHTTPClientTransport factory
│   ├── source.ts                # McpSourceManager: connect, retry, health, callTool
│   └── registry.ts              # namespaced ToolDescriptor registry + lookup
├── llm/
│   ├── provider.ts              # LLMProvider interface + chat types
│   ├── openai-compatible.ts     # OpenAI-compatible adapter (OpenCode Go/Ollama)
│   └── errors.ts                # provider error classification
├── conversation/
│   ├── loop.ts                  # request lifecycle: LLM ↔ tool loop, iteration bound
│   ├── tool-executor.ts         # validate tool name/args → policy → execute/confirm
│   └── types.ts                 # Conversation, ConversationResult, ToolCall types
├── confirmation/
│   └── store.ts                 # in-memory, single-use, TTL-bounded confirmations
├── notifications/
│   └── contract.ts              # NotificationEvent validation, acknowledgement, recorder
├── cli/
│   └── chat.ts                  # local chat client (injectable fetch)
└── logging/
    └── logger.ts                # structured logger with default redaction

scripts/
├── generate-token.ts            # `pnpm token:generate`: token + hashed AGENT_AUTH_TOKENS entry
└── chat.ts                      # `pnpm chat`: readline REPL / one-shot client

docs/
├── http-contract.md             # HTTP contract, error codes, tool policy, provider setup
└── agent.http                   # runnable REST-client requests

tests/
├── unit/                        # config, policy, registry, store, redaction, adapter, CLI
├── contract/                    # HTTP endpoints, LLM provider wire format, health
├── integration/                 # fake-MCP + fake-LLM end-to-end flows
└── fakes/                       # fake LLM provider, in-process fake MCP server, harness
```

**Structure Decision**: Single-project service layout. `src/` is split by responsibility (http, auth,
mcp, llm, conversation, confirmation, notifications, logging) matching the scaffold directories and
the constitution's concerns. `http/app.ts` is a factory so contract tests can exercise routes via
Hono's `app.request()` without binding a port. All external effects (MCP sources, LLM provider,
clock, confirmation store, logger) are injected through function parameters so fakes replace them in
tests.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| —         | —          | —                                    |
