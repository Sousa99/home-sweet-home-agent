# Contract: Home Assistant MCP Source

The agent is the single MCP host (constitution I). Home Assistant's built-in **Model Context Protocol
Server** is registered as a fifth managed source alongside the four modules, using the same
`McpSourceManager`, namespacing, tool policy, confirmation, timeout, trace, and health behavior.

## Source

| Field | Value |
| ----- | ----- |
| Source id | `home_assistant` |
| Env vars | `HOME_ASSISTANT_MCP_URL`, `HOME_ASSISTANT_MCP_TOKEN` |
| Official URL | `https://home-assistant.<tailnet>.ts.net/api/mcp` (home server over Tailscale) |
| Local URL | `http://localhost:8123/api/mcp` (also the code default, for portability) |
| Transport | Streamable HTTP (`StreamableHTTPClientTransport`) |
| Session model | One managed `Client` + transport for the process lifetime |
| Authentication | `Authorization: Bearer <long-lived access token>` on every request |

The token is a Home Assistant long-lived access token. It is supplied only through configuration,
stored as a secret field, and MUST NOT appear in source status, health output, trace entries, or logs
(FR-004, FR-011, FR-012). Home Assistant's admin requirement and entity exposure are configured in
Home Assistant, not by the agent.

## Connection lifecycle

```ts
const client = new Client({ name: AGENT_NAME, version: AGENT_VERSION })
const transport = new StreamableHTTPClientTransport(new URL(sourceUrl), {
  requestInit: { headers: { Authorization: `Bearer ${token}` }, signal },
})
await client.connect(transport)
const { tools } = await client.listTools()
```

Rules
- Exactly one `Client` + transport for `home_assistant` (FR-002); the transport receives the
  `Authorization` header on connect and every `callTool` (FR-016).
- `listTools()` populates the registry; each tool is namespaced `home_assistant__<originalName>`
  (double underscores in the original name are preserved) before it is advertised to the model
  (FR-003).
- A missing/rejected credential or unreachable endpoint marks the source `degraded`/`unavailable`
  without blocking other sources; retries are bounded (FR-010).
- Every `connect()`/`listTools()`/`callTool()` is bounded by `MCP_TIMEOUT_MS`; exceeding it yields
  `timeout`/`mcp_unavailable`, never an indefinite hang (FR-009).

## Tool call contract

```ts
const result = await client.callTool({ name: originalName, arguments: validatedArgs })
```

Rules
- `name` is the original Home Assistant tool name (e.g. `intent__HassTurnOn`); `arguments` are the
  exact schema-validated object.
- The registry maps the namespaced model-selected name back to `(home_assistant, originalName)`.
- Errors, malformed output, or oversized results (`GetLiveContext` can be several KB) are bounded by
  `AGENT_MAX_TOOL_RESULT_CHARS` and reported as labeled failures; the agent never fabricates a result
  (constitution III).

## Discovered tool inventory

Names vary with the enabled LLM APIs and Home Assistant version; the classifier covers the following
representative set (verified against Home Assistant's built-in MCP Server).

| Policy | Original tool names |
| ------ | ------------------- |
| `read` | `homeassistant__GetLiveContext`, `llm__GetDateTime`, `homeassistant__GetState`, `todo__get_items` |
| `write` | `light__HassLightSet`, `climate__HassClimateSetTemperature`, `media_player__*` (pause/resume/next/volume/mute), `todo__HassListAddItem` |
| `destructive` | `intent__HassTurnOn`, `intent__HassTurnOff`, `intent__HassToggle`, `intent__HassSetPosition`, and any unclassified Home Assistant tool |

`destructive` tools require an explicit, unexpired, single-use confirmation before execution
(FR-007). Generic intent control is destructive because it can target consequential exposed entities
(such as `cover`); the same tools are therefore not silently auto-executed.

## Health

- `GET /health` reports `home_assistant` with `ready`/`degraded`/`unavailable` and a tool count, and
  MUST NOT expose the credential or entity details (FR-011).
- A Home Assistant outage leaves the four module sources usable (FR-010).

## Out of contract

- Home Assistant **prompts** and the Assist context **resource** are not consumed; the agent uses only
  tools and assembles its own prompt (R9).
- Home Assistant device, entity, area, and automation configuration is owned by the
  `home-sweet-home-home-assistant` repository.
- The Home Assistant conversation adapter is a separate feature.
