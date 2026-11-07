# Probe contract

Base URL: `AGENT_HOST` / `AGENT_PORT` (container default `0.0.0.0:3400`).

The two probe endpoints are the only unauthenticated routes. Every other route keeps the bearer-token
requirement described in `docs/http-contract.md`.

## GET /healthz (liveness)

No authentication. Returns `200` whenever the process is running.

```json
{ "status": "ok", "service": "home-sweet-home-agent", "version": "0.1.0" }
```

- Never performs network I/O.
- Never reports sources, provider keys, URLs, prompts, or household data.
- Stays `200` during draining; liveness answers "is the process alive", not "should it receive
  traffic".

## GET /readyz (readiness)

No authentication. Returns `200` when the provider is ready and the instance is not draining.

```json
{
  "status": "ok",
  "service": "home-sweet-home-agent",
  "llm": { "ready": true, "provider": "openai-compatible", "model": "deepseek-v4.1-flash" },
  "mcp": {
    "bus": { "status": "ready", "tools": 10 },
    "home_assistant": { "status": "ready", "tools": 28 }
  }
}
```

| Condition | HTTP | `status` |
| --------- | ---- | -------- |
| Provider ready, not draining | `200` | `ok` |
| Provider not ready, not draining | `503` | `not_ready` |
| Draining | `503` | `draining` |

- MCP source outages do **not** fail readiness; degraded operation is supported and the per-source
  summary is advisory.
- Uses the provider's local readiness check only; no LLM request is made.
- Contains no secrets or endpoints.

## Authentication boundary

| Path | Auth |
| ---- | ---- |
| `/healthz` | none |
| `/readyz` | none |
| `/health` | bearer |
| `/conversation` | bearer |
| `/confirm` | bearer |
| `/notifications` | bearer |
