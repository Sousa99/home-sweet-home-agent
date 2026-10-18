# Contract: MCP Client

The agent is the single MCP host (constitution I, FR-004). It connects to each configured module MCP
server with the official MCP TypeScript SDK over streamable HTTP, discovers tools, and executes them
through the owning source's one managed session. Module MCP ports are never re-exposed to callers.

## Sources

| Source id | Env var | Default URL | Module | Session model |
| --------- | ------- | ----------- | ------ | ------------- |
| `bus` | `BUS_MCP_URL` | `http://localhost:3200/mcp` | bus-catcher | stateless |
| `flights` | `FLIGHTS_MCP_URL` | `http://localhost:3201/mcp` | fly-over-tracker | stateless |
| `tasks` | `TASKS_MCP_URL` | `http://localhost:3202/mcp` | procrastinator-tracker | sessionful (max 32) |
| `weather` | `WEATHER_MCP_URL` | `http://localhost:3203/mcp` | weather-psychic | stateless |

All modules use streamable HTTP at path `/mcp` and expose no MCP-level authentication. URLs are
deployment-specific and supplied only through configuration.

## Connection lifecycle

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const client = new Client({ name: 'home-sweet-home-agent', version: '<agentVersion>' })
const transport = new StreamableHTTPClientTransport(new URL(sourceUrl), { requestInit: { signal } })
await client.connect(transport)
const { tools } = await client.listTools()
```

Rules
- Exactly one `Client` + transport per source for the process lifetime; connect at startup (FR-004,
  SC-008). The SDK propagates `mcp-session-id` automatically for the sessionful procrastinator source.
- `listTools()` populates the registry; each tool is namespaced to a wire-safe `<sourceId>__<name>`
  (illegal characters become `_`) before it is advertised to the model (FR-005).
- On connect failure or mid-session failure, the source is marked `degraded`/`unavailable`, retries
  are bounded, and other sources remain usable (US3, SC-005).
- Every `connect()`/`listTools()`/`callTool()` is bounded by `MCP_TIMEOUT_MS`; exceeding it yields
  `timeout`/`mcp_unavailable`, never an indefinite hang (FR-015).

## Tool call contract

```ts
const result = await client.callTool({ name: originalName, arguments: validatedArgs })
```

Rules
- `name` is the original (un-namespaced) module tool name; `arguments` are the exact schema-validated
  object for that tool.
- The registry lookup maps the namespaced model-selected name back to `(sourceId, originalName)`.
- A tool result is returned to the model as a `tool` message keyed by the provider tool-call id.
- Module errors, malformed output, or oversized results are bounded and reported as labeled failures;
  the agent never fabricates a result (constitution III).

## Discovered tool inventory (verified against `home-sweet-home-modules`)

| Source | Tools |
| ------ | ----- |
| `bus` | `list_lines`, `search_stops`, `get_stop`, `get_stop_times`, `get_status`, `refresh_schedule`*, `get_config`, `add_stop`*, `update_stop`*, `remove_stop`* |
| `flights` | `planes_over` |
| `tasks` | `task.create`*, `task.list`, `task.get`, `task.update`*, `task.set_status`*, `task.comment`*, `task.delete`*, `tag.list`, `user.list` |
| `weather` | `weather.get_forecast`, `weather.search` |

`*` denotes a mutating tool. Reads vs. writes vs. destructive are assigned by the agent's `ToolPolicy`
(see `data-model.md` and `research.md` R4), not by module annotations.

## Health

- `GET /health` reports per-source `ready`/`degraded`/`unavailable` and a tool count (FR-014).
- Sources that need an HTTP probe beyond the SDK connection use the module REST `/health` or
  `/api/health` endpoints as a fallback signal; the primary signal is the managed MCP connection
  state.
