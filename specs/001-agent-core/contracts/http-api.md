# Contract: Agent HTTP API

Base URL: private deployment host, default `http://127.0.0.1:3400`. All requests/responses are
`application/json`. All endpoints except none are authenticated: every request MUST present
`Authorization: Bearer <token>` matching `AGENT_AUTH_TOKENS`. Unknown/absent tokens are rejected
before any LLM or MCP call (FR-012, FR-013, SC-003).

## Error envelope

All non-2xx responses use a stable machine-readable code and a safe message:

```json
{ "error": { "code": "unauthorized", "message": "Missing or invalid bearer token." } }
```

| Code | HTTP | Meaning |
| ---- | ---- | ------- |
| `unauthorized` | 401 | Missing/unknown bearer token, or caller lacks the required permission. |
| `malformed_request` | 400 | Body fails schema validation. |
| `tool_not_found` | 422 | Model selected a tool not currently advertised. |
| `tool_validation_failed` | 422 | Tool arguments fail the discovered JSON Schema or policy denies. |
| `confirmation_invalid` | 409 | Unknown, wrong-caller, or already-consumed confirmation token. |
| `confirmation_expired` | 410 | Confirmation token past `expiresAt`. |
| `llm_unavailable` | 502 | Provider unreachable, rejecting, or timed out. |
| `mcp_unavailable` | 502 | Target source unavailable. |
| `timeout` | 504 | Bounded operation exceeded its configured timeout. |
| `internal_error` | 500 | Unexpected failure; no sensitive detail. |

Messages MUST NOT contain tokens, prompts, tool arguments, or household locations (FR-020).

## POST /conversation

Handles one natural-language request through the provider and MCP tools (FR-001, FR-002).

**Request**
```json
{ "conversationId": "optional-existing-id", "message": "When is the next bus at my stop?" }
```
- `message`: required, non-empty string.
- `conversationId`: optional; server generates one when absent. Caller identity is derived from the
  bearer token, never from the body.

**Response 200 — completed**
```json
{
  "conversationId": "c-123",
  "status": "completed",
  "reply": "The next bus is at 14:32.",
  "trace": [ { "tool": "bus__get_stop_times", "sourceId": "bus", "policy": "read", "outcome": "executed", "durationMs": 42 } ]
}
```

**Response 200 — confirmation required** (destructive tool short-circuit, FR-009, FR-010)
```json
{
  "conversationId": "c-123",
  "status": "confirmation_required",
  "reply": "I can run tasks__task_delete, but I need your confirmation before doing that.",
  "confirmation": {
    "token": "opaque-single-use-token",
    "tool": "tasks__task_delete",
    "argumentsPreview": { "id": 42 },
    "expiresAt": "2026-10-18T10:02:00.000Z"
  },
  "trace": [ { "tool": "tasks__task_delete", "sourceId": "tasks", "policy": "destructive", "outcome": "confirmation_required", "durationMs": 0 } ]
}
```

**Response 200 — failed** (bounded, structured; underlying tool failures are reported, never faked)
```json
{ "conversationId": "c-123", "status": "failed", "error": { "code": "mcp_unavailable", "message": "The weather module is unavailable." } }
```

Rules
- If the model selects no tool, the reply is returned with no MCP execution (US1 scenario 3).
- If the model selects an advertised read/write tool with valid arguments and the caller has the
  category permission, the tool executes and the reply reflects the real result (US1, FR-007).
- A destructive tool call returns `confirmation_required` and does not execute (SC-002).
- The tool loop is bounded by `AGENT_MAX_TOOL_ITERATIONS`; exceeding the bound is a structured
  failure, never an unbounded hang (FR-015).
- Both `/conversation` and `/confirm` return a `trace` array (namespaced tool name, source id, policy,
  outcome, duration) describing the tools selected; tool arguments are never included (FR-023).

## POST /confirm

Approves or rejects a pending action (FR-010, FR-011).

**Request**
```json
{ "conversationId": "c-123", "confirmationToken": "opaque-single-use-token", "decision": "approve" }
```
- `decision`: `approve` or `reject`.

**Response 200 — approved and executed**
```json
{ "conversationId": "c-123", "status": "completed", "reply": "Task 42 was deleted." }
```

**Response 200 — rejected**
```json
{ "conversationId": "c-123", "status": "completed", "reply": "Okay, I did not delete the task." }
```

Rules
- Approve executes exactly the presented tool and arguments once, re-validated against the live
  schema, then consumes the token (FR-011, SC-002).
- Reject, invalid token, wrong caller, or expiry → no execution and the pending action is invalidated
  (US2 scenario 4). Replay of a consumed token → `confirmation_invalid`.

## POST /notifications

Documented contract for a later Home Assistant notification adapter; no scheduling in this feature
(FR-016).

**Request**
```json
{ "type": "bus.departure", "severity": "info", "payload": { "stopId": "123", "line": "758", "minutes": 3 }, "target": "home-assistant" }
```
- `type`: required enum (`bus.departure`, `task.due`, `flight.overhead`, `service.health`).
- `severity`: optional (`info`|`warning`|`critical`), default `info`.
- `payload`: required object, validated per event type.
- `target`: optional adapter hint.

**Response 202**
```json
{ "accepted": true, "id": "n-789", "receivedAt": "2026-10-18T10:00:00.000Z" }
```

## GET /health

Safe to call without exposing credentials, prompts, or tool arguments (FR-014, SC-004).

**Response 200**
```json
{
  "status": "ok",
  "service": "home-sweet-home-agent",
  "mcp": {
    "bus": { "status": "ready", "tools": 10 },
    "flights": { "status": "ready", "tools": 1 },
    "tasks": { "status": "degraded", "tools": 9, "error": { "code": "mcp_unavailable", "message": "Connection lost." } },
    "weather": { "status": "unavailable", "tools": 0 }
  },
  "llm": { "ready": true, "provider": "openai-compatible", "model": "deepseek-v4.1-flash" }
}
```
- Overall `status`: `ok` if all sources ready and LLM ready; `degraded` if some are degraded; `down`
  if all MCP sources are unavailable or the LLM is not ready.
- Each source resolves to `ready`/`degraded`/`unavailable` within 10 seconds (SC-004).
