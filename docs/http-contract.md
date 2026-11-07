# Agent HTTP contract

Base URL: `http://127.0.0.1:3400` by default (`AGENT_HOST` / `AGENT_PORT`). All requests and
responses are JSON. Every endpoint except the `/healthz` and `/readyz` probes requires
`Authorization: Bearer <token>`, where the token is a random secret whose sha-256 hash appears in
`AGENT_AUTH_TOKENS`.

Generate a token and a readable token file:

```bash
pnpm token:generate -- --caller-id you --permissions read,write,destructive --out secrets/tokens.json
# then set AGENT_TOKENS_FILE=secrets/tokens.json in .env
```

`AGENT_TOKENS_FILE` is a pretty-printed JSON object of
`{ "<sha256(token)>": { "callerId": "...", "permissions": [...] } }`. You can also inline the same
map as a single-line JSON object in `AGENT_AUTH_TOKENS`; inline entries merge over the file.

## Error envelope

```json
{ "error": { "code": "unauthorized", "message": "Missing or invalid bearer token, or insufficient permissions." } }
```

| Code | HTTP | Meaning |
| ---- | ---- | ------- |
| `unauthorized` | 401 | Missing/unknown token, or caller lacks the required permission. |
| `malformed_request` | 400 | Body fails schema validation. |
| `tool_not_found` | 422 | Model selected a tool that is not advertised. |
| `tool_validation_failed` | 422 | Tool arguments fail the discovered JSON Schema. |
| `confirmation_invalid` | 409 | Unknown, wrong-caller, or already-consumed confirmation token. |
| `confirmation_expired` | 410 | Confirmation token past `expiresAt`. |
| `llm_unavailable` | 502 | Provider unreachable, rejecting, or timed out. |
| `mcp_unavailable` | 502 | Target module unavailable. |
| `timeout` | 504 | A bounded operation exceeded its configured timeout. |
| `internal_error` | 500 | Unexpected failure. |

## Probes (unauthenticated)

`GET /healthz` is the liveness probe. It returns `200` whenever the process is alive and performs no
network I/O:

```json
{ "status": "ok", "service": "home-sweet-home-agent", "version": "0.1.0" }
```

`GET /readyz` is the readiness probe. It returns `200` when the provider is ready and the instance is
not draining, and `503` otherwise. It never calls the LLM or any MCP source and exposes no secrets or
URLs:

```json
{
  "status": "ok",
  "service": "home-sweet-home-agent",
  "llm": { "ready": true, "provider": "openai-compatible", "model": "deepseek-v4.1-flash" },
  "mcp": {
    "bus": { "status": "ready", "tools": 10 },
    "tasks": { "status": "unavailable", "tools": 0 }
  }
}
```

`status` is `ok` (200), `not_ready` (503, provider not ready), or `draining` (503, shutdown in
progress). MCP source outages do not fail readiness; degraded operation is supported.

## POST /conversation

Request `{ "message": string, "conversationId"?: string }`.

Response — completed:

```json
{
  "conversationId": "c-123",
  "status": "completed",
  "reply": "The next bus is at 14:32.",
  "trace": [
    { "tool": "bus__get_stop_times", "sourceId": "bus", "policy": "read", "outcome": "executed", "durationMs": 42 }
  ]
}
```

Response — confirmation required (destructive tool):

```json
{
  "conversationId": "c-123",
  "status": "confirmation_required",
  "reply": "I can run tasks__task_delete, but I need your confirmation before doing that.",
  "confirmation": { "token": "...", "tool": "tasks__task_delete", "argumentsPreview": { "id": 42 }, "expiresAt": "..." },
  "trace": [
    { "tool": "tasks__task_delete", "sourceId": "tasks", "policy": "destructive", "outcome": "confirmation_required", "durationMs": 0 }
  ]
}
```

Response — failed:

```json
{ "conversationId": "c-123", "status": "failed", "error": { "code": "mcp_unavailable", "message": "..." } }
```

## POST /confirm

Request `{ "conversationId": string, "confirmationToken": string, "decision": "approve" | "reject" }`.

Approving executes exactly the presented tool and arguments once (re-validated against the live
schema) and consumes the token. Rejecting, an unknown token, a wrong caller, or expiry performs no
execution. Reusing a consumed token returns `confirmation_invalid`. The response includes a one-entry
`trace` for the approved (`executed`) or rejected (`rejected`) action.

## Tool trace

`POST /conversation` and `POST /confirm` return a `trace` array describing every tool the model
selected and what happened to it:

```json
{ "tool": "bus__get_stop_times", "sourceId": "bus", "policy": "read", "outcome": "executed", "durationMs": 42 }
```

- `outcome` is `executed`, `confirmation_required`, `failed`, or `rejected`.
- `policy` is `read`, `write`, or `destructive` (omitted for a tool that was not advertised).
- **Tool names only.** Prompts, tool arguments, tokens, and household locations are never included
  in the trace or in logs. Every tool call is also emitted as an `info`-level `tool.call` log event,
  so operators see it at the default `LOG_LEVEL=info`.

## POST /notifications

Request `{ "type": "bus.departure" | "task.due" | "flight.overhead" | "service.health", "severity"?: "info" | "warning" | "critical", "payload": object, "target"?: string }`.

Response `202`:

```json
{ "accepted": true, "id": "n-789", "receivedAt": "2026-10-18T10:00:00.000Z" }
```

This is a contract for a future Home Assistant notification adapter. It validates and records the
event but does not schedule or dispatch anything.

## GET /health

```json
{
  "status": "ok",
  "service": "home-sweet-home-agent",
  "mcp": {
    "bus": { "status": "ready", "tools": 10 },
    "flights": { "status": "ready", "tools": 1 },
    "tasks": { "status": "degraded", "tools": 9, "error": { "code": "mcp_unavailable", "message": "Module request failed." } },
    "weather": { "status": "unavailable", "tools": 0 },
    "home_assistant": { "status": "ready", "tools": 28 }
  },
  "llm": { "ready": true, "provider": "openai-compatible", "model": "deepseek-v4.1-flash" }
}
```

`status` is `ok` when every module and the LLM are ready, `degraded` when some are, and `down`
otherwise. The agent never returns sensitive values such as MCP credentials.

## Home Assistant MCP source

Home Assistant is the fifth managed MCP source (`sourceId: home_assistant`). It connects to Home
Assistant's built-in Model Context Protocol Server over Streamable HTTP at `/api/mcp` and
authenticates with a long-lived access token sent as `Authorization: Bearer <token>`.

- **Configuration**: `HOME_ASSISTANT_MCP_URL` and `HOME_ASSISTANT_MCP_TOKEN`. The official deployment
  is the home server over Tailscale at `https://home-assistant.<tailnet>.ts.net/api/mcp`. A local
  Home Assistant still works with `HOME_ASSISTANT_MCP_URL=http://localhost:8123/api/mcp`; the code
  default is the local URL for portability. Both use the same long-lived access token. The token is a
  secret supplied only through the environment; it is never logged, returned, or committed. With no
  token the source simply reports `unavailable`.
- **OpenCode**: the development MCP entry resolves both the URL and token from
  `HOME_ASSISTANT_MCP_URL` and `HOME_ASSISTANT_TOKEN`, so the same environment settings drive OpenCode
  and the agent. Export them in your shell (for example from `.env`) before starting OpenCode.
- **Namespacing**: discovered tools are advertised as `home_assistant__<originalName>`, e.g.
  `home_assistant__intent__HassTurnOn`. Home Assistant entity access is configured in Home Assistant
  (Settings > System > AI and exposed entities), not by the agent.
- **Policy**: query tools (`homeassistant__GetLiveContext`, `llm__GetDateTime`, `todo__get_items`) are
  `read`; benign domain controls (`light__HassLightSet`, `climate__HassClimateSetTemperature`,
  `media_player__*`, `todo__HassListAddItem`) are `write`; generic entity control
  (`intent__HassTurnOn`, `intent__HassTurnOff`, `intent__HassToggle`, `intent__HassSetPosition`) and
  any unclassified tool require confirmation. Generic control is destructive because its effect
  depends on the target entity, which may be a cover, lock, or alarm.
- **Failure isolation**: if Home Assistant is unavailable, the four module sources keep working and
  `/health` reports Home Assistant accurately.

## Tool safety policy

The agent classifies every discovered tool rather than trusting module hints:

| Policy | Examples | Behavior |
| ------ | -------- | -------- |
| `read` | `bus.get_stop_times`, `flights.planes_over`, `tasks.task.list`, `weather.*`, `home_assistant.homeassistant__GetLiveContext` | Auto-execute with the `read` permission. |
| `write` | `tasks.task.create`, `tasks.task.update`, `tasks.task.comment`, `bus.add_stop`, `home_assistant.light__HassLightSet` | Auto-execute with the `write` permission. |
| `destructive` | `tasks.task.delete`, `tasks.task.set_status`, `bus.remove_stop`, `home_assistant.intent__HassTurnOn` | Require an approved confirmation. |

Unknown tools use `AGENT_UNKNOWN_TOOL_POLICY` (default `destructive`). Tools the caller lacks
permission for are not advertised to the model. Tool output fed back to the model is capped at
`AGENT_MAX_TOOL_RESULT_CHARS` (default 8000) so an oversized module response cannot blow the model
context or stall the request.

## Providers

`LLM_PROVIDER=openai-compatible` with `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`. Defaults target
OpenCode Go (`https://opencode.ai/inference/go/openai/v1`, `deepseek-v4.1-flash`), which also expects
the agent's `x-opencode-session` (per-conversation) and `user-agent` headers — both sent
automatically. Point `LLM_BASE_URL` at `http://localhost:11434/v1` for Ollama. Cloud endpoints are
opt-in data-egress paths.
