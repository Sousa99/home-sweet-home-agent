# Phase 0 Research: Centralized MCP Agent Core

All Technical Context items are resolved below. No `NEEDS CLARIFICATION` markers remain.

## R1. HTTP framework and request validation

- **Decision**: Use Hono with `@hono/node-server` for the HTTP layer, and zod for configuration and
  request-body validation.
- **Rationale**: Hono provides routing, JSON parsing, and composable middleware while remaining a
  small dependency, and it is already used across the module backends. Hono's `app.request()` lets
  contract tests exercise every endpoint and error path without opening a socket, which directly
  supports SC-009 (all HTTP contracts covered by automated tests). zod gives declarative, typed
  request/config schemas and precise validation errors that map to stable error codes.
- **Alternatives considered**: (a) Raw `node:http` + hand-rolled router — zero new deps but verbose
  auth/body/error handling and harder to test in isolation. (b) Express — larger surface, older
  middleware idioms, and no in-process request helper. (c) Fastify — good but a heavier dependency
  than needed for four routes.

## R2. MCP client transport and session ownership

- **Decision**: Use the official `@modelcontextprotocol/sdk` `Client` with
  `StreamableHTTPClientTransport` (`client/streamableHttp.js`). Create exactly one long-lived
  `Client` + transport per configured source in an `McpSourceManager`, connect at startup, and call
  `listTools()` / `callTool()` through that single client.
- **Rationale**: The four modules expose streamable HTTP at `/mcp`; the SDK client handles session
  negotiation transparently. A single long-lived client satisfies "one managed connection per source"
  (FR-004) and naturally respects the procrastinator MCP's single-session constraint (SC-008),
  because the agent never opens competing sessions. The SDK auto-propagates `mcp-session-id`.
- **Verified module facts**: bus-catcher and procrastinator-tracker use SDK v1 streamable HTTP;
  fly-over-tracker and weather-psychic use `@modelcontextprotocol/server` v2 with a stateless
  per-request handler. Three sources are stateless (a long-lived client still works), and only
  procrastinator-tracker is sessionful. None implement MCP-level auth. Transport is uniformly
  `POST/GET /mcp`.
- **Alternatives considered**: (a) A new client per request — violates single-session ownership and
  would exceed the procrastinator 32-session cap under load. (b) `SSE`/`stdio` transports — modules
  do not expose them.

## R3. Tool discovery, namespacing, and validation

- **Decision**: Namespace every discovered tool as `<sourceId>__<sanitizedName>` (e.g.
  `tasks__task_create`, `bus__get_stop_times`), replacing characters outside `[a-zA-Z0-9_-]` with `_`
  so names satisfy the provider function-name pattern. Keep a registry keyed by the wire-safe name
  that stores the source id, the original tool name, description, and JSON `inputSchema`; safety
  policy is keyed by the readable `sourceId.originalName`. Validate model-selected tool names against
  the registry and model-supplied arguments against the stored JSON Schema with ajv.
- **Rationale**: Source ids contain no dots, so the first dot segment unambiguously recovers the
  source, preventing cross-module collisions (FR-005) even though procrastinator tools already use
  dotted names. Validating against the *discovered* schema (not a hardcoded copy) means agent safety
  tracks module schema changes for free (FR-006, constitution VI). ajv is the same validator family
  the SDK uses, so behavior is consistent.
- **Alternatives considered**: (a) `source__tool` delimiters — workable but noisier for the LLM.
  (b) Relying on MCP tool `annotations` (`readOnlyHint`/`destructiveHint`) for safety — modules do
  not currently set them, so safety cannot depend on them (see R4).

## R4. Tool safety classification

- **Decision**: A static, config-reviewed `ToolPolicy` table classifies each known namespaced tool as
  `read`, `write`, or `destructive`. Unknown tools default to `write` for read-only-looking verbs and
  otherwise to `destructive` (confirmation-required); the conservative default is configurable and
  defaults to `destructive`.
- **Rationale**: Modules do not publish trustworthy safety annotations, so classification must be
  owned by the agent (constitution III). Explicit entries give audits and tests a single source of
  truth. Classifications: reads = `bus.list_lines/search_stops/get_stop/get_stop_times/get_status/
  get_config`, `flights.planes_over`, `weather.*`, `tasks.task.list/get/tag.list/user.list`;
  writes = `bus.add_stop/update_stop/refresh_schedule`, `tasks.task.create/update/set_status/
  comment`; destructive = `bus.remove_stop`, `tasks.task.delete`. `tasks.task.set_status` completing
  a task is treated as destructive per US2 scenario 2, so it is classified `destructive`.
- **Alternatives considered**: (a) Trust MCP annotations — absent today. (b) Keyword heuristics on
  tool names — brittle and unsafe for household data.

## R5. LLM provider integration

- **Decision**: Define a small `LLMProvider` interface (`chat()`, `checkReady()`) and implement one
  OpenAI-compatible adapter that issues `POST {baseUrl}/chat/completions` with `messages`, `tools`
  (JSON Schema function definitions), and `tool_choice: 'auto'`, parsing `choices[0].message` and
  `tool_calls`. Defaults from configuration: base URL
  `https://opencode.ai/inference/go/openai/v1`, model `deepseek-v4.1-flash`. The adapter also sends a
  client `user-agent` and, when a conversation id is available, an `x-opencode-session` header, since
  OpenCode Go requires the session header for routing and prompt caching.
- **Rationale**: The OpenAI chat-completions shape is the widest compatibility surface — it covers
  OpenCode Go, the OpenCode free model, and local Ollama with no adapter changes (constitution IV,
  FR-017/FR-018). Keeping the interface minimal means fakes are trivial for deterministic tests.
- **Alternatives considered**: (a) A provider-specific SDK per vendor — couples the agent to vendors
  and multiplies deps. (b) Node `fetch`-based generic adapter without an interface — harder to fake
  and to keep provider-agnostic.

## R6. Conversation lifecycle and tool loop

- **Decision**: `runConversation()` executes a bounded loop: send messages + tools to the provider;
  if the response contains tool calls, validate/authorize/execute each, append tool results, and
  repeat; stop when the model returns a message with no tool calls or when a max-iteration bound is
  reached. A destructive tool call short-circuits into a `confirmation_required` result. The final
  `ConversationResult` is one of `completed`, `confirmation_required`, or a structured failure.
- **Rationale**: A bounded loop prevents runaway tool use and satisfies FR-015's bounded-failure
  requirement. Short-circuiting on destructive calls keeps confirmation before execution (FR-009).
  Confirmation tokens bind caller, conversation, tool, and a hash of the exact validated arguments so
  approval executes exactly what was shown (FR-010/FR-011).
- **Alternatives considered**: (a) Single LLM round-trip — cannot chain tools or ground multi-step
  answers. (b) Unbounded agent loop — violates bounded-failure and cost constraints.

## R7. Authentication and permissions

- **Decision**: A Hono auth middleware reads `Authorization: Bearer <token>`, hashes it (sha-256) and
  looks the hash up in a config-supplied map (`AGENT_AUTH_TOKENS` JSON of
  `{ "<sha256(token)>": { callerId, permissions } }`), then attaches a
  `CallerIdentity { callerId, permissions }`. Missing/unknown tokens → `401 unauthorized` before any
  LLM or MCP call. Permissions are explicit subsets of `read`/`write`/`destructive`. Tokens are
  stored hashed at rest so the config never holds a usable credential; a `pnpm token:generate` script
  mints tokens and writes a readable, git-ignored `AGENT_TOKENS_FILE` (pretty JSON), or prints a
  single-line inline map for `AGENT_AUTH_TOKENS`. Inline entries merge over the file.
- **Rationale**: Hashing aligns with Private-by-Default and the `tokenHash` field in the data model,
  rejects unknown callers early (FR-012/FR-013, SC-003), and lets tests construct identities
  directly. Tools the caller lacks permission for are also filtered out of the advertised tool set.
- **Alternatives considered**: (a) Raw tokens in `AGENT_AUTH_TOKENS` — simpler to hand-edit but the
  config would contain usable secrets. (b) HMAC-signed tokens — more moving parts than a household
  system needs. (c) OAuth/JWT — out of scope.

## R8. Confirmation store

- **Decision**: In-memory `ConfirmationStore` keyed by a random token, storing `{ callerId,
  conversationId, sourceId, toolName, argumentsHash, arguments, expiresAt, used }`. Default TTL
  120s (configurable). Approval marks the entry used and executes once; reject, expiry, wrong token,
  or reuse invalidates it.
- **Rationale**: Satisfies single-use, caller-bound, short-lived confirmation (FR-010/FR-011) with
  no persistence, matching FR-019. Two pending confirmations for one caller/conversation are allowed
  and distinguished by token.
- **Alternatives considered**: (a) Persist confirmations — deferred with durable storage. (b) Encode
  the pending action in a signed token — viable, but in-memory storage makes single-use and expiry
  enforcement simpler and testable.

## R9. Logging and redaction

- **Decision**: A structured JSON logger with redaction on by default. Logs record event type,
  caller id hash, conversation id, tool namespaced name, outcome, and duration, but never tokens,
  prompts, message text, full tool arguments, phone identifiers, or household locations. A debug mode
  may log redacted/structured summaries only.
- **Rationale**: Directly implements FR-020 and SC-007 and constitution V. Keeping redaction in the
  logger (not at call sites) means tests can assert absence of sensitive values globally.
- **Alternatives considered**: (a) Ad-hoc `console.log` — untestable redaction. (b) Third-party
  logger — unnecessary dependency; a small wrapper suffices.

## R10. Notifications contract (deferred adapter)

- **Decision**: Implement `POST /notifications` as a validated, acknowledged contract: zod-validate
  `{ type, severity, payload, target? }`, return `202 { accepted: true, id }`, and record the event
  in-memory. No scheduling, recurrence, or dispatch — that is a later feature (FR-016).
- **Rationale**: Locks the outbound event shape for the future Home Assistant adapter (constitution
  VI) without implementing scheduling that the spec defers.
- **Alternatives considered**: Omitting the endpoint until the adapter exists — rejected because
  FR-016 explicitly requires the documented contract now.

## R11. Testing strategy and fakes

- **Decision**: Vitest across three tiers. Fakes: (a) `FakeLLMProvider` scripting deterministic
  message/tool-call sequences; (b) `FakeMcpServer`, an in-process streamable HTTP MCP server exposing
  controllable tools (including a failing/hanging tool and a destructive tool); (c) an
  OpenAI-compatible fake HTTP endpoint (via Hono) for provider wire-format tests; (d) a fixed clock
  for confirmation expiry. No live services or credentials (FR-021).
- **Rationale**: Deterministic fakes make the failure paths in the spec's edge cases testable, and
  satisfy SC-001/SC-006/SC-009 without external dependencies. The same `LLMProvider` interface and
  in-process MCP server back both unit and integration tests.
- **Alternatives considered**: (a) Mocking the SDK client directly — brittle and skips transport
  behavior. (b) Live modules — non-deterministic and unsuitable for CI.

## R12. Configuration

- **Decision**: A zod-validated config loaded from environment with documented defaults in
  `.env.example`: host/port; four MCP URLs; `MCP_TIMEOUT_MS`; LLM provider/base URL/model/key/timeout;
  `AGENT_AUTH_TOKENS`; `CONFIRMATION_TTL_MS`; `AGENT_MAX_TOOL_ITERATIONS`; `AGENT_UNKNOWN_TOOL_POLICY`;
  log level/redaction. Secrets come only from env or a secret manager; config is injected into the
  app factory for tests.
- **Rationale**: Satisfies FR-017/FR-018/FR-022 and constitution V while letting tests construct
  config objects without environment mutation. Keeping defaults in `.env.example` documents the
  intended OpenCode Go deployment.
- **Alternatives considered**: (a) Config files in-repo — risks committing secrets. (b) A config
  library — zod already covers schema + coercion.

## R13. Developer tooling (token generator + local chat CLI)

- **Decision**: Ship two small tools sharing the agent's own modules. `scripts/generate-token.ts`
  (`pnpm token:generate -- --caller-id <id> --permissions read,write,destructive`) calls
  `generateTokenEntry()` in `src/auth/token-tool.ts` and prints the token once plus the hashed
  `AGENT_AUTH_TOKENS` entry. `src/cli/chat.ts` provides a `createChatClient({ baseUrl, token, fetch })`
  with injectable `fetch` (unit-tested), and `scripts/chat.ts` wires it to a Node `readline` REPL
  (`pnpm chat`, flags `--once`, `--conversation`, `--verbose`, `--token`, `--url`) that prompts for
  destructive-action approval and calls `POST /confirm`.
- **Rationale**: Makes manual validation one command, keeps generator/CLI logic unit-testable (the
  scripts are thin entrypoints), and uses only Node built-ins plus existing deps (no new runtime
  dependencies).
- **Alternatives considered**: (a) Raw `curl` only — workable but error-prone for the confirmation
  round-trip. (b) A separate npm package for the CLI — unnecessary overhead.

## Open Items

None. Module MCP tool sets, transports, ports, and session characteristics were verified against the
`home-sweet-home-modules` repository; the env-configured weather URL (3203) is deployment-specific and
does not affect the design.
