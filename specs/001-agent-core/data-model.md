# Phase 1 Data Model: Centralized MCP Agent Core

In-memory domain model for the agent core. No persistent storage in this feature (FR-019). Types are
defined in `src/conversation/types.ts`, `src/mcp/*`, `src/auth/*`, `src/confirmation/*`, and
`src/config/*`.

## Entity Overview

```text
AgentConfig ──1:1──> LLMProviderConfig
     │
     ├──1:N──> McpSourceConfig ──1:1──> McpSource ──1:N──> ToolDescriptor
     │
     └──1:N──> CallerIdentity

HTTP Request ──> Conversation ──1:N──> ToolInvocation ──0:1──> PendingConfirmation
                     │
                     └──0:N──> NotificationEvent (separate endpoint)
```

## MCP Source

A configured module MCP endpoint and its live connection state (FR-003, FR-004).

| Field | Type | Notes |
| ----- | ---- | ----- |
| `sourceId` | string | Stable id, no dots: `bus`, `flights`, `tasks`, `weather`. |
| `url` | string | Streamable HTTP `/mcp` endpoint from config. |
| `state` | `'connecting' \| 'ready' \| 'degraded' \| 'unavailable'` | Live status for `/health`. |
| `tools` | `ToolDescriptor[]` | Populated on successful connect; empty when unavailable. |
| `lastError` | `{ code, message } \| null` | Safe, redacted failure summary. |
| `lastCheckedAt` | ISO timestamp | Updated on connect/health refresh. |
| `timeoutMs` | number | From `MCP_TIMEOUT_MS`. |

**Validation / rules**
- One `Client` + transport per `sourceId` for the process lifetime (FR-004).
- A failed connect or dropped connection sets `state` to `degraded`/`unavailable` and never blocks
  other sources (US3, SC-005).
- Retries are bounded; a source that does not recover is reported unavailable (US3 scenario 3).

**State transitions**
```text
connecting ──success──> ready ──call failure──> degraded ──reconnect ok──> ready
     │                                              │
     └──failure──> unavailable <──retries exhausted─┘
ready ──disconnect──> degraded
```

## Tool Descriptor

A discovered, namespaced tool (FR-005, FR-006, FR-008).

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string | Wire-safe namespaced `<sourceId>__<originalName>`, e.g. `tasks__task_create`. Illegal function-name characters (`.`) are replaced with `_` because provider tool APIs require `^[a-zA-Z0-9_-]+$`. |
| `sourceId` | string | Owning source. |
| `originalName` | string | Tool name as advertised by the module. |
| `description` | string | From `listTools()`. |
| `inputSchema` | JSON Schema object | From `listTools()`; used by ajv for validation. |
| `policy` | `'read' \| 'write' \| 'destructive'` | From `ToolPolicy`. |

**Validation / rules**
- `name` MUST be unique across the registry; collisions are prevented by the source-id prefix (edge
  case: cross-module name collisions).
- A model-selected name not present in the registry is rejected with `tool_not_found` (edge case).
- Arguments MUST validate against `inputSchema` before execution; failure → `tool_validation_failed`.

## Tool Policy

Static classification owned by the agent (FR-008, constitution III).

| Policy | Tools (namespaced) | Execution |
| ------ | ------------------ | --------- |
| `read` | `bus.list_lines`, `bus.search_stops`, `bus.get_stop`, `bus.get_stop_times`, `bus.get_status`, `bus.get_config`, `flights.planes_over`, `weather.weather_get_forecast`, `weather.weather_search`, `tasks.task.list`, `tasks.task.get`, `tasks.tag.list`, `tasks.user.list` | Auto-execute with `read` permission. |
| `write` | `bus.add_stop`, `bus.update_stop`, `bus.refresh_schedule`, `tasks.task.create`, `tasks.task.update`, `tasks.task.comment` | Auto-execute with `write` permission. |
| `destructive` | `bus.remove_stop`, `tasks.task.delete`, `tasks.task.set_status` | Require a valid unexpired confirmation (FR-009). |

**Rules**
- Unknown tools use `AGENT_UNKNOWN_TOOL_POLICY` (default `destructive`).
- Permission required: `read` → `read`; `write` → `write`; `destructive` → `destructive`. A caller
  lacking the category permission is rejected before execution (FR-013).

## Caller Identity

Authenticated client mapped to permissions (FR-012, FR-013).

| Field | Type | Notes |
| ----- | ---- | ----- |
| `callerId` | string | Stable identity from the token map. |
| `permissions` | Set of `'read' \| 'write' \| 'destructive'` | Explicit; no implicit escalation. |
| `tokenHash` | string | sha-256 of the bearer token; the lookup key in `AGENT_AUTH_TOKENS`. The raw token is never stored in config or logs. |

**Rules**
- Unknown/absent token → `401 unauthorized` before the LLM or any MCP call (SC-003).
- `callerId` is never accepted from the request body as authority; it comes only from the token.

## Conversation

In-memory interaction scope (FR-002, Key Entities).

| Field | Type | Notes |
| ----- | ---- | ----- |
| `conversationId` | string | Server-generated if absent; stable across a confirmation round-trip. |
| `callerId` | string | Owning identity. |
| `messages` | Chat message[] | Bounded context (existing turns + current request + tool results). |
| `status` | `'active' \| 'completed' \| 'confirmation_required' \| 'failed'` | Result state. |
| `createdAt` / `updatedAt` | ISO timestamp | For bounded retention. |

**Rules**
- State is per-process and lost on restart; restarted processes MUST NOT restore or execute pending
  actions (FR-019, SC-010).
- Context is bounded to avoid sending unbounded tool output to the provider (edge case: oversized
  tool result).

## Tool Invocation

One model-requested tool call within a conversation.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `id` | string | Provider's tool-call id. |
| `toolName` | string | Namespaced name selected by the model. |
| `arguments` | object | Parsed, schema-validated arguments; never logged in full. |
| `argumentsHash` | string | Binds a confirmation to exact arguments (FR-011). |
| `policy` | `'read' \| 'write' \| 'destructive'` | Resolved from the descriptor. |
| `outcome` | `'executed' \| 'confirmation_required' \| 'rejected' \| 'failed'` | Result state. |
| `result` | tool result or `{ code, message }` | Real result, never fabricated (constitution III). |

## Tool Trace Entry

A per-request record of a tool the model selected, returned in the conversation/confirm response and
mirrored as an `info`-level `tool.call` log event (FR-023). Names only — never prompts, arguments,
tokens, or locations.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `tool` | string | Wire-safe namespaced name, e.g. `bus__get_stop_times`. |
| `sourceId` | string | Owning module (`bus`, `flights`, `tasks`, `weather`), or the namespace prefix when the tool was not advertised. |
| `policy` | `'read' \| 'write' \| 'destructive'` (optional) | Omitted when the tool was not found in the registry. |
| `outcome` | `'executed' \| 'confirmation_required' \| 'failed' \| 'rejected'` | What happened to the call. |
| `durationMs` | number | Execution time; `0` for calls that did not reach the module. |

**Rules**
- The trace is additive and per-request; state is in-memory and lost on restart (FR-019).
- `POST /conversation` records a `confirmation_required` entry for a destructive tool; `POST /confirm`
  records the `executed`/`rejected` entry for the approved or rejected action.
- Arguments and their values MUST NOT appear in the trace or logs.

## Pending Confirmation

Short-lived, single-use, caller-bound approval (FR-010, FR-011, SC-002).

| Field | Type | Notes |
| ----- | ---- | ----- |
| `token` | string (opaque) | Returned to the caller; never logged. |
| `callerId` | string | Approval must come from the same caller. |
| `conversationId` | string | Bound conversation. |
| `sourceId` / `toolName` | string | Exact tool to execute. |
| `arguments` / `argumentsHash` | object / string | Exact validated arguments; re-checked on approval. |
| `expiresAt` | ISO timestamp | `now + CONFIRMATION_TTL_MS` (default 120s). |
| `state` | `'pending' \| 'approved' \| 'rejected' \| 'expired' \| 'consumed'` | Lifecycle. |

**Rules**
- Approve: only `pending`, unexpired, same caller → execute exactly once → `consumed`.
- Reject, wrong token, wrong caller, or expiry → no execution → `rejected`/`expired`.
- Reuse of a `consumed` token → `confirmation_invalid`, no execution (edge case: replay).
- Two pending confirmations for one caller/conversation are allowed; tokens disambiguate.

**State transitions**
```text
pending ──approve (valid, unexpired)──> approved ──execute──> consumed
   ├──reject──> rejected
   ├──expires──> expired
   └──replay/unknown token──> confirmation_invalid (no state change)
```

## LLM Provider Configuration

Provider selection and readiness (FR-017, FR-018, FR-022).

| Field | Type | Notes |
| ----- | ---- | ----- |
| `kind` | `'openai-compatible'` | Only adapter in this feature. |
| `baseUrl` | string | Default `https://opencode.ai/zen/go/v1`. |
| `model` | string | Default `deepseek-v4.1-flash`. |
| `apiKey` | string (secret) | From env/secret manager; never logged or returned. |
| `timeoutMs` | number | Bounds `chat()` calls. |
| `ready` | boolean | Reported by `GET /health`. |

**Rules**
- Provider unavailable/rejecting → structured `llm_unavailable` failure with no unrequested tool
  execution (US4 scenario 3).
- Cloud egress is documented as opt-in (FR-022).

## Notification Event

Validated outbound event for a later adapter (FR-016).

| Field | Type | Notes |
| ----- | ---- | ----- |
| `id` | string | Server-generated acknowledgement id. |
| `type` | string (enum) | e.g. `bus.departure`, `task.due`, `flight.overhead`, `service.health`. |
| `severity` | `'info' \| 'warning' \| 'critical'` | Default `info`. |
| `payload` | object | Adapter-specific, schema-validated. |
| `target` | string (optional) | Target adapter hint for a future dispatcher. |
| `receivedAt` | ISO timestamp | Record time. |

**Rules**
- Invalid `type`/`payload` → `malformed_request`; valid → `202 { accepted: true, id }`.
- No scheduling, recurrence, or dispatch in this feature.
