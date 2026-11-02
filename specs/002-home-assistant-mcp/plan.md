# Implementation Plan: Home Assistant MCP Integration

**Branch**: `feature/002-home-assistant-mcp` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-home-assistant-mcp/spec.md`

## Summary

Add Home Assistant's built-in MCP Server as the fifth managed MCP source in the existing agent, and
register the same server in `opencode.json` for development. The agent already owns one managed MCP
client per source, namespaces discovered tools, enforces read/write/destructive policy with single-use
confirmations, bounds timeouts, reports health, and redacts logs. This feature reuses all of that and
adds only: a Home Assistant source configuration (URL plus bearer credential), custom request headers
in the MCP client, a Home Assistant-specific safety classifier for its dynamic, domain-prefixed tools,
the OpenCode MCP entry, and the corresponding tests and documentation. No new runtime dependencies and
no new transport are introduced.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js >= 24 (ESM, `type: module`)

**Primary Dependencies**: Reuses `@modelcontextprotocol/sdk` ^1.12 (`StreamableHTTPClientTransport`
with `requestInit.headers`), `hono`/`@hono/node-server`, `zod` 4, `ajv`. No new dependencies.

**Storage**: N/A — the source is in-memory state, consistent with `001-agent-core`.

**Testing**: Vitest, three tiers — unit (`tests/unit`), contract (`tests/contract`), integration
(`tests/integration`) — using the existing `tests/fakes` (fake streamable HTTP MCP server, fake LLM).
A fake Home Assistant MCP server advertises query, benign-control, and generic-control tools and can
assert the `Authorization` header.

**Target Platform**: Linux container on a private home/deployment network; Home Assistant is reached
over the deployment network at `http://localhost:8123/api/mcp` by default.

**Project Type**: Single project — one existing backend HTTP service.

**Performance Goals**: Home Assistant reads complete within `MCP_TIMEOUT_MS`; large `GetLiveContext`
output (~5 KB) is bounded by `AGENT_MAX_TOOL_RESULT_CHARS`; Home Assistant outage yields a bounded
structured failure while module sources stay usable.

**Constraints**: Credential supplied only through configuration and never committed or logged
(FR-004, FR-012, FR-015); generic entity-control tools require confirmation (FR-006, FR-007); Home
Assistant is one managed session like any other source (FR-002, FR-010).

**Scale/Scope**: 5 MCP sources; roughly 28 additional Home Assistant tools depending on enabled LLM
APIs and entity exposure; a single process with in-memory state.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Check | Status |
| --------- | ----- | ------ |
| I. One Controlled MCP Host | Home Assistant is added to `McpSourceManager` as one managed source; clients still reach Home Assistant only through the agent. | PASS |
| II. Explicit Authorization | The Home Assistant credential is a deployment secret; callers are still authenticated and permissioned before any Home Assistant tool runs; no caller-supplied identity is trusted. | PASS |
| III. Safe Tool Execution | A Home Assistant classifier marks read/write/destructive; generic or unclassifiable control tools are destructive and require a single-use confirmation; responses reflect real tool results. | PASS |
| IV. Provider-Agnostic Intelligence | Only MCP tools are consumed (prompts/resources ignored); the LLM provider is unchanged and remains configurable. | PASS |
| V. Private by Default | Credential held only in configuration; token never committed, returned, or logged; existing redaction covers `authorization`/`token`; source URL stays on the private network. | PASS |
| VI. Contract-First Integration | The new source, its tool policy, and the OpenCode configuration are documented and covered by unit, contract, and integration tests. | PASS |
| VII. Test-First Development | Each behavior in `tasks.md` starts with a failing unit/contract/integration test using fakes. | PASS |

**Post-Phase 1 re-check**: No new violations; the feature extends existing patterns and introduces no
new project, storage, or dependency. Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-home-assistant-mcp/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   ├── home-assistant-source.md   # Phase 1 output
│   └── opencode-config.md         # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
opencode.json                       # add enabled `home-assistant` remote MCP entry (no secret)
.env.example                        # add HOME_ASSISTANT_MCP_URL and HOME_ASSISTANT_MCP_TOKEN

src/
├── config/
│   ├── config.ts                   # add HA source config + credential to AgentConfig
│   └── policy.ts                   # add Home Assistant classification (known table + generic control)
├── mcp/
│   ├── client.ts                   # accept custom request headers (Authorization)
│   ├── source.ts                   # reuse managed source (pass through headers)
│   └── registry.ts                 # unchanged; existing namespacing reused
└── index.ts                        # HA source flows through config.mcpSources unchanged

tests/
├── fakes/
│   ├── fake-mcp-server.ts          # support advertised HA-style tools + header assertion
│   └── sample-config.ts            # include HA source in sample config
├── unit/
│   ├── config.test.ts              # HA env parsing/defaults; token never surfaced
│   ├── policy.test.ts              # HA read/write/destructive classification
│   └── mcp-client-headers.test.ts  # Authorization header reaches the transport
├── contract/
│   └── opencode-config.test.ts     # opencode.json registers HA; no literal secret
└── integration/
    └── home-assistant-source.test.ts # read, benign write, confirmation, resilience

docs/
└── README.md                       # document the Home Assistant MCP source and credential handling
```

**Structure Decision**: Single existing TypeScript service. The feature touches configuration, the MCP
client (headers only), the policy classifier, `opencode.json`, and tests. `McpSource`,
`McpSourceManager`, the registry, the conversation loop, the confirmation store, and the HTTP layer
are reused unchanged, so the change surface stays small and the constitution's separation of
responsibilities is preserved.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Complexity Tracking is empty.
