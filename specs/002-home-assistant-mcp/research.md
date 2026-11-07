# Phase 0 Research: Home Assistant MCP Integration

All Technical Context items are resolved below. No `NEEDS CLARIFICATION` markers remain. Findings were
verified against the Home Assistant MCP Server integration documentation, the Home Assistant 2026.10
release notes, the OpenCode MCP server documentation, and the sibling `home-sweet-home-home-assistant`
repository.

## R1. Home Assistant MCP endpoint and transport

- **Decision**: Treat Home Assistant's built-in **Model Context Protocol Server** integration as the
  Home Assistant MCP source, reached over **Streamable HTTP** at `/api/mcp` (the "All LLM APIs"
  endpoint). Reuse the existing `StreamableHTTPClientTransport`; do not add a new transport.
- **Rationale**: Home Assistant 2026.10 exposes the MCP Server over Streamable HTTP at `/api/mcp`
  (and a narrower `/api/mcp/assist`), which matching the agent's existing module transport means
  `McpSource`/`McpSourceManager`, namespacing, timeouts, health, and retries all apply unchanged
  (FR-001, FR-002, FR-009, FR-010, FR-016). The older HTTP+SSE transport is deprecated in the MCP
  specification and should not be adopted.
- **Alternatives considered**: (a) SSE transport — deprecated and unnecessary. (b) The third-party
  `ha-mcp` add-on — larger scope (config/automation editing) than household device control requires,
  and it would duplicate configuration ownership that belongs to the Home Assistant repository.
  (c) A bespoke Home Assistant REST client — rejected; it would bypass the single-MCP-host model.
- **Verified facts**: `/api/mcp` requires an `Authorization` header on every request (401 without
  it); admin is required by default; the negotiated protocol revision is `2025-11-25` from a Python
  SDK 1.28 server, and an SDK v1 client connects without changes. Prompts and a read-only Assist
  resource are supported; sampling and notifications are not.

## R2. Authentication to Home Assistant

- **Decision**: Authenticate with a Home Assistant long-lived access token sent as
  `Authorization: Bearer <token>`, supplied through configuration (`HOME_ASSISTANT_MCP_TOKEN`) and
  never committed.
- **Rationale**: The built-in MCP Server authenticates every request with a bearer token
  (FR-004, constitution V). Long-lived access tokens are the simplest supported method for a private
  agent on the deployment network. The agent already loads secrets only from the environment, so no
  new secret mechanism is needed.
- **Alternatives considered**: (a) OAuth — the built-in server does not require it for a private
  client, and it adds an authorization server dependency. (b) Embedding the token in the URL —
  rejected; it would leak into logs and health output.
- **How to apply**: Extend the MCP client to accept custom request headers so the token reaches the
  transport as `requestInit.headers`, and keep the token out of all log fields (R6).

## R3. Source id and tool namespacing

- **Decision**: Register Home Assistant with source id `home_assistant`. Namespaced tools are
  `home_assistant__<originalName>`, e.g. `home_assistant__intent__HassTurnOn`,
  `home_assistant__homeassistant__GetLiveContext`. Safety policy is keyed by
  `home_assistant.<originalName>`, e.g. `home_assistant.intent__HassTurnOn`.
- **Rationale**: Home Assistant's original tool names already contain double underscores
  (`intent__HassTurnOn`, `homeassistant__GetLiveContext`), and the agent's separator is `__`. Because
  `home_assistant` contains only single underscores, the first `__` in the namespaced name still
  recovers the source unambiguously, so the existing `splitNamespacedTool` logic is correct without
  change (FR-003, edge case: cross-source name collisions). The underscore form avoids a hyphen in
  tool names and matches the `HOME_ASSISTANT_*` configuration naming.
- **Alternatives considered**: (a) `home-assistant` — a hyphen is legal in function names but
  inconsistent with the env-var prefix. (b) `ha` — shorter but less legible in traces and policy keys.

## R4. Tool discovery and safety classification

- **Decision**: Discover Home Assistant tools dynamically at connect time (they vary with the enabled
  LLM APIs and Home Assistant version) and classify them with a dedicated Home Assistant classifier:
  - **read**: `homeassistant__GetLiveContext`, `llm__GetDateTime`, `homeassistant__GetState`-style
    query tools, and `todo__get_items`.
  - **write**: domain-specific benign controls, e.g. `light__HassLightSet`,
    `climate__HassClimateSetTemperature`, `media_player__*` transport/volume/mute tools, and
    `todo__HassListAddItem`.
  - **destructive** (confirmation required): generic entity control that can target consequential
    devices — `intent__HassTurnOn`, `intent__HassTurnOff`, `intent__HassToggle`,
    `intent__HassSetPosition` — because their effect depends on the target entity (a cover/garage,
    lock, or alarm is consequential), plus any tool the classifier cannot confidently place.
- **Rationale**: Home Assistant's tool set is dynamic and domain-prefixed, so a fixed table alone is
  insufficient, but trusting model-driven tool names without a policy is unsafe (constitution III).
  Generic turn-on/turn-off tools can act on `cover` entities, which are exposed to Assist by default,
  so a conservative destructive classification for generic control prevents an ambiguous instruction
  from opening a garage or changing a security device (FR-006, FR-007, US2). Domain-specific benign
  controls (lights, climate setpoint, media) remain `write` so everyday control stays usable. The
  global `AGENT_UNKNOWN_TOOL_POLICY` (default `destructive`) remains the final fallback.
- **Alternatives considered**: (a) Rely on Home Assistant entity exposure and treat all control as
  `write` — rejected; exposed defaults include `cover`, so an assistant "turn on" could open a
  garage. (b) Classify everything destructive — safe but makes routine light/media control unusable.
  (c) Trust HA/MCP annotations — not guaranteed to be present or trustworthy, and the agent owns
  policy.

## R5. Custom request headers in the MCP client

- **Decision**: Extend `McpClientHandle` creation and `McpSourceConfig` with optional `headers`, and
  pass them to `StreamableHTTPClientTransport` as `requestInit.headers`. The Home Assistant source is
  configured with `Authorization: Bearer <token>`.
- **Rationale**: The existing client passes only a `signal`; Home Assistant needs an auth header
  (FR-004, FR-016). Keeping headers in source configuration means the token travels with the source
  that owns it and is trivially injectable in tests (a fake server can assert the header). Module
  sources keep working with no headers.
- **Alternatives considered**: (a) A Home Assistant-specific client subclass — duplicates transport
  code. (b) Setting a process-global header — leaks credentials to unrelated sources.

## R6. Configuration and redaction

- **Decision**: Add `HOME_ASSISTANT_MCP_URL` (default `http://localhost:8123/api/mcp`) and
  `HOME_ASSISTANT_MCP_TOKEN` (default empty) to the zod-validated config, and include Home Assistant
  in `AgentConfig.mcpSources` with a credential reference. Log keys such as `authorization` and
  `token` are already redacted by the logger, and the token is never placed in the source's status,
  health output, or trace.
- **Rationale**: Matches the existing config pattern and defaults (FR-004, FR-012, constitution V).
  The default URL mirrors the Home Assistant port already used by the sibling repository. The
  credential is represented only as a secret field, never serialized (US3 scenario 4, SC-005, SC-006).
- **Alternatives considered**: (a) Reuse `HOME_ASSISTANT_URL`/`HOME_ASSISTANT_TOKEN` reserved for the
  future conversation adapter — rejected; keeping the MCP source's URL/token distinct avoids coupling
  two independent integrations (the same long-lived token value may still be reused). (b) Deriving
  `/api/mcp` from `HOME_ASSISTANT_URL` — brittle if a non-default path is used.

## R7. OpenCode MCP configuration

- **Decision**: Add a `home-assistant` remote MCP server to `opencode.json`:
  `type: remote`, `url: {env:HOME_ASSISTANT_MCP_URL}`, `enabled: true`, `oauth: false`, and
  `headers: { "Authorization": "Bearer {env:HOME_ASSISTANT_TOKEN}" }`. The URL and token are
  interpolated from the environment and never written into the file (FR-014, FR-015, US4). The
  deployment sets the URL to the official home-server endpoint
  `https://home-assistant.<tailnet>.ts.net/api/mcp`, while `http://localhost:8123/api/mcp` remains a
  valid local value.
- **Rationale**: OpenCode supports remote MCP servers with `headers` and `{env:VAR}` substitution;
  disabling OAuth is the documented pattern for API-key/token servers. This lets a developer inspect
  and call Home Assistant tools directly during integration work without committing a secret.
- **Alternatives considered**: (a) Hardcoding a token — rejected (constitution V). (b) OAuth flow —
  unnecessary for a long-lived token and unavailable when Home Assistant is only on the LAN.

## R8. Testing strategy

- **Decision**: Extend the existing fakes and add focused tests:
  - Unit: `home_assistant` source classification (read/write/destructive incl. generic control),
    configuration parsing/defaults and secret non-exposure, and header propagation to the transport.
  - Contract: assert `opencode.json` registers an enabled `home-assistant` remote MCP server with no
    literal secret, and that the frozen HTTP/trace/health contracts are unchanged for module sources.
  - Integration: a fake Home Assistant MCP server advertising query tools, a benign control tool, and
    a generic (destructive) control tool; verify a read completes, a benign control executes for a
    `write` caller, a generic control returns `confirmation_required`, an unexpired approval executes
    once, and Home Assistant being unavailable leaves module sources usable.
- **Rationale**: Deterministic fakes satisfy FR-017 and SC-001/SC-002/SC-008 with no live Home
  Assistant or token, and reuse the in-process streamable HTTP fake already used by feature
  `001-agent-core` (R11).
- **Alternatives considered**: (a) A live Home Assistant in CI — non-deterministic and credential
  dependent. (b) Mocking the SDK client — brittle and skips transport/header behavior.

## R9. Prompts and resources from Home Assistant

- **Decision**: The agent consumes only Home Assistant **tools**; it ignores MCP prompts and the
  Assist context resource, keeping its own system prompt and context assembly.
- **Rationale**: The agent is provider- and prompt-agnostic (constitution IV) and already builds its
  own prompt; MCP prompts are not part of the client contract the agent exposes (FR-016). The Assist
  resource is derivable from `GetLiveContext`, so it is unnecessary.
- **Alternatives considered**: Injecting Home Assistant's `Assist` prompt — would couple agent
  behavior to a source and complicate prompt ownership.

## Open Items

None. The Home Assistant MCP endpoint, transport, authentication, tool naming, and dynamic tool
characteristics are verified; the agent's existing MCP host, policy, confirmation, trace, and logging
machinery is reused without modification beyond configurable headers and the new source classifier.
