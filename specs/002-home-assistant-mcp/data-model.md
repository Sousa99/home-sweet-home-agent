# Phase 1 Data Model: Home Assistant MCP Integration

This feature extends the in-memory domain model from `001-agent-core` (`specs/001-agent-core/
data-model.md`). Only the additions and changes are described here; unchanged entities are referenced,
not restated. There is no persistent storage.

## What changes

| Entity | Change |
| ------ | ------ |
| MCP Source | Gains an optional credential/header set so a source can send `Authorization`. |
| MCP Source Config | Gains `headers` for the Home Assistant source. |
| Agent Config | Gains the Home Assistant MCP URL and token (secret). |
| Tool Policy | Gains a Home Assistant classifier for its dynamic, domain-prefixed tools. |
| Tool Descriptor | Unchanged, but now includes Home Assistant tools namespaced as `home_assistant__<name>`. |
| OpenCode MCP Configuration | New repository artifact registering the Home Assistant MCP server. |

## MCP Source (extended)

A configured MCP endpoint and its live connection state. Home Assistant is a normal source with
source id `home_assistant`.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `sourceId` | string | Now includes `home_assistant` alongside `bus`, `flights`, `tasks`, `weather`. |
| `url` | string | Streamable HTTP endpoint. Official deployment: `https://home-assistant.<tailnet>.ts.net/api/mcp`; local: `http://localhost:8123/api/mcp` (code default). |
| `headers` | `Record<string, string>` (optional) | Request headers sent on connect and every call; Home Assistant uses `Authorization: Bearer <token>`. Never logged. |
| `state` | `'connecting' \| 'ready' \| 'degraded' \| 'unavailable'` | Unchanged; `/health` reports Home Assistant like any source. |
| `tools` | `ToolDescriptor[]` | Dynamically discovered Home Assistant tools. |
| `lastError` | `{ code, message } \| null` | Safe, redacted summary; a 401 from Home Assistant maps to an availability error, not a caller error. |
| `timeoutMs` | number | From `MCP_TIMEOUT_MS`. |

**Validation / rules**
- Exactly one managed `Client` + transport for `home_assistant` (FR-002).
- Credential values MUST NOT appear in `state`, `lastError`, `status()`, health output, or logs
  (FR-011, FR-012; US3 scenario 4).
- A missing/rejected credential or unreachable endpoint sets `degraded`/`unavailable` and never blocks
  other sources (FR-010; US3 scenarios 1–2).

**State transitions**: unchanged from `001-agent-core` (`connecting → ready → degraded → ready`,
failure paths to `unavailable`). Home Assistant reconnection follows the same bounded retry policy
(US3 scenario 3).

## MCP Source Config (extended)

`McpSourceConfig` (in `src/config/config.ts`) gains an optional `headers` field. The Home Assistant
entry is built from `HOME_ASSISTANT_MCP_URL` and `HOME_ASSISTANT_MCP_TOKEN`; when the token is present
it produces `headers: { Authorization: 'Bearer <token>' }`. The token value is a secret field on
`AgentConfig` and is not serialized.

| Field | Type | Source | Notes |
| ----- | ---- | ------ | ----- |
| `sourceId` | `'home_assistant'` | constant | Source namespace prefix. |
| `url` | string | `HOME_ASSISTANT_MCP_URL` | Default `http://localhost:8123/api/mcp`; validated as a URL. |
| `headers` | `{ Authorization: string }` (optional) | `HOME_ASSISTANT_MCP_TOKEN` | Omitted when the token is empty so a missing credential fails as unavailable rather than sending an empty header. |

## Agent Config (extended)

`AgentConfig` gains nothing beyond the existing `mcpSources` and the secret token reference:

| Field | Type | Notes |
| ----- | ---- | ----- |
| `mcpSources` | `McpSourceConfig[]` | Now five entries, including Home Assistant. |
| `homeAssistantToken` | string (secret) | From `HOME_ASSISTANT_MCP_TOKEN`; blank by default; never logged or returned. |

**Rules**: Unknown/missing token does not fail startup; the source simply reports `unavailable`
(FR-010). The token is not printed by config tests or error messages.

## Home Assistant Tool Policy (new classifier)

Home Assistant tools are dynamic and prefixed by domain, so classification uses a dedicated function
`classifyHomeAssistantTool(originalName, fallback)` instead of only the static table. Namespaced names
are `home_assistant__<originalName>`; policy keys are `home_assistant.<originalName>`.

| Policy | Matches (by original tool name) | Execution |
| ------ | ------------------------------- | --------- |
| `read` | `homeassistant__GetLiveContext`, `llm__GetDateTime`, `homeassistant__GetState`, `todo__get_items` | Auto-execute with `read` permission. |
| `write` | `light__HassLightSet`, `climate__HassClimateSetTemperature`, `media_player__*` transport/volume/mute, `todo__HassListAddItem` | Auto-execute with `write` permission. |
| `destructive` | `intent__HassTurnOn`, `intent__HassTurnOff`, `intent__HassToggle`, `intent__HassSetPosition`, and any Home Assistant tool not confidently classified | Require a valid, unexpired, single-use confirmation (FR-007). |

**Rules**
- Generic entity control is destructive because its effect depends on the target entity, and Home
  Assistant exposes `cover` entities to Assist by default (R4).
- Matching is by prefix/domain where a domain is uniformly safe (e.g. `light__`, `media_player__`),
  and by exact/suffix rules for generic intents.
- The global `AGENT_UNKNOWN_TOOL_POLICY` (default `destructive`) remains the fallback when neither the
  static table nor the Home Assistant classifier resolves a policy.
- Permission required mirrors policy: `read`→`read`, `write`→`write`, `destructive`→`destructive`; a
  caller lacking the category is rejected before execution (FR-008).

## Tool Descriptor (unchanged shape, new instances)

Home Assistant tools appear as ordinary descriptors:

| Field | Example |
| ----- | ------- |
| `name` | `home_assistant__intent__HassTurnOn` |
| `sourceId` | `home_assistant` |
| `originalName` | `intent__HassTurnOn` |
| `description` | From Home Assistant `listTools()`. |
| `inputSchema` | From Home Assistant `listTools()`; used by ajv. |
| `policy` | From the Home Assistant classifier. |

**Rules**: The first `__` in `name` recovers `sourceId` because `home_assistant` contains only single
underscores, so original double-underscore names remain unambiguous (R3). Model-selected names not in
the registry → `tool_not_found`; invalid arguments → `tool_validation_failed`.

## OpenCode MCP Configuration (new artifact)

The repository's `opencode.json` MCP section gains one entry. This is a development aid, not runtime
configuration.

| Field | Value | Notes |
| ----- | ----- | ----- |
| name | `home-assistant` | OpenCode server name; tools are exposed as `home-assistant_*`. |
| `type` | `remote` | Streamable HTTP MCP server. |
| `url` | `http://localhost:8123/api/mcp` | Local Home Assistant MCP Server endpoint. |
| `enabled` | `true` | Available in the OpenCode session. |
| `oauth` | `false` | Token-based, not OAuth. |
| `headers.Authorization` | `Bearer {env:HOME_ASSISTANT_TOKEN}` | Interpolated from the environment; no secret in the file. |

**Rules**: The committed file MUST NOT contain a literal credential (FR-015). If
`HOME_ASSISTANT_TOKEN` is unset, OpenCode starts and the other module MCP servers remain usable
(US4 scenario 3).

## Trace, Confirmation, and Health (reused)

Home Assistant tool calls flow through the existing `Tool Trace Entry`, `Pending Confirmation`, and
`GET /health` structures with no shape changes:

- Trace entries use the namespaced name (e.g. `home_assistant__intent__HassTurnOn`) and
  `sourceId: home_assistant` (FR-013).
- Generic Home Assistant control actions produce a `confirmation_required` trace entry and a pending
  confirmation bound to the caller, conversation, tool, and exact arguments; approval executes once
  (FR-007).
- `/health` reports `home_assistant` with its state and tool count and no credential or entity details
  (FR-011).
