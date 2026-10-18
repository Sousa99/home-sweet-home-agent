---
description: 'Task list for the Centralized MCP Agent Core feature'
---

# Tasks: Centralized MCP Agent Core

**Input**: Design documents from `/specs/001-agent-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED. The feature spec (FR-021, SC-001–SC-010) and the project constitution
(Principle VII, Test-First Development) require automated tests before implementation is complete.
Test tasks are marked and MUST fail before the implementation task they cover.

**Organization**: Tasks are grouped by user story so each story is independently implementable and
testable. All paths are repository-relative.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps the task to a user story (US1–US5)
- Every task includes an exact file path

## Path Conventions

Single project (per plan.md): `src/`, `scripts/`, and `tests/` at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project dependencies, structure, and tool configuration.

- [X] T001 Add `hono`, `@hono/node-server`, `zod`, and `ajv` to dependencies in `package.json` and install with `pnpm install` (keep `@modelcontextprotocol/sdk` and dev tooling; regenerate `pnpm-lock.yaml`)
- [X] T002 Create source/test/script directory structure: `src/config/`, `src/http/`, `src/http/routes/`, `src/http/middleware/`, `src/auth/`, `src/mcp/`, `src/llm/`, `src/conversation/`, `src/confirmation/`, `src/notifications/`, `src/cli/`, `src/logging/`, `scripts/`, `tests/unit/`, `tests/contract/`, `tests/integration/`, `tests/fakes/`
- [X] T003 [P] Add ESLint flat config in `eslint.config.js` so `pnpm lint` runs against `src`, `scripts`, and `tests`
- [X] T004 [P] Add Prettier config in `.prettierrc.json` so `pnpm format` passes
- [X] T005 [P] Add Vitest config in `vitest.config.ts` with Node environment and `tests/**/*.test.ts` include glob; add `.dockerignore`

**Checkpoint**: `pnpm lint`, `pnpm format`, `pnpm typecheck`, and `pnpm test` run (test suite may be empty).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared primitives every user story depends on. No story work begins until complete.

**⚠️ CRITICAL**: Blocks all user stories.

- [X] T006 Implement zod environment schema and `loadConfig()` (host/port, four MCP URLs, `MCP_TIMEOUT_MS`, LLM provider/base URL/model/key/timeout, `AGENT_AUTH_TOKENS` **hashed** token map, `CONFIRMATION_TTL_MS`, `AGENT_MAX_TOOL_ITERATIONS`, `AGENT_UNKNOWN_TOOL_POLICY`, log level/redaction) in `src/config/config.ts`
- [X] T007 [P] Extend `.env.example` with the new variables and safe defaults (`LLM_BASE_URL`, `LLM_TIMEOUT_MS`, `MCP_TIMEOUT_MS`, `AGENT_AUTH_TOKENS`, `CONFIRMATION_TTL_MS`, `AGENT_MAX_TOOL_ITERATIONS`, `AGENT_UNKNOWN_TOOL_POLICY`, `LOG_LEVEL`) and a note on generating tokens
- [X] T008 [P] Implement the redacting structured logger (event/duration fields; never tokens, prompts, message text, full tool arguments, phone ids, or locations) in `src/logging/logger.ts`
- [X] T009 [P] Implement `CallerIdentity`/`Permission` types and hashed token→identity lookup with constant-time comparison in `src/auth/caller.ts` and `src/auth/tokens.ts`
- [X] T010 [P] Implement the structured HTTP error envelope, codes, and safe-message helpers in `src/http/errors.ts`
- [X] T011 [P] Define the `LLMProvider` interface and chat message/tool-call types in `src/llm/provider.ts`
- [X] T012 [P] Implement the MCP `Client` + `StreamableHTTPClientTransport` factory in `src/mcp/client.ts`
- [X] T013 [P] Implement the namespaced tool registry (`<sourceId>.<tool>` names, lookup back to source + original name, `ToolDescriptor`) in `src/mcp/registry.ts`
- [X] T014 [P] Define conversation, tool-invocation, and result types in `src/conversation/types.ts`
- [X] T015 Implement the `McpSourceManager` core (per-source connect, `listTools` discovery into the registry, `callTool`) in `src/mcp/source.ts`
- [X] T016 Implement the Hono app factory with JSON parsing and a global error-envelope handler in `src/http/app.ts`
- [X] T017 Implement bearer-token auth middleware that attaches `CallerIdentity` and rejects unknown/missing tokens with `401 unauthorized` in `src/http/middleware/auth.ts`
- [X] T018 [P] Implement token hashing/generation helpers (`hashToken`, `findTokenEntry`, `generateToken`, `generateTokenEntry`) in `src/auth/token-tool.ts`
- [X] T019 [P] Implement `FakeLLMProvider` (scripted message/tool-call sequences, readiness, call recording) in `tests/fakes/fake-llm.ts`
- [X] T020 [P] Implement an in-process fake streamable HTTP MCP server (healthy tools, a destructive tool, a failing tool, a hanging tool) in `tests/fakes/fake-mcp-server.ts`
- [X] T021 [P] Implement shared test helpers (sample config/token map, fixed clock) in `tests/fakes/sample-config.ts`
- [X] T022 [P] Unit tests for config defaults/validation/hashed token-map parsing in `tests/unit/config.test.ts`
- [X] T023 [P] Unit tests asserting logger redaction of tokens/prompts/arguments/locations in `tests/unit/logger.test.ts`
- [X] T024 [P] Unit tests for hashed token lookup and permission checks in `tests/unit/auth.test.ts`
- [X] T025 [P] Unit tests for namespacing, collision avoidance, and reverse lookup in `tests/unit/registry.test.ts`
- [X] T026 [P] Unit tests for token hashing/generation and input validation in `tests/unit/token-tool.test.ts`

**Checkpoint**: Foundation ready — user stories can begin.

---

## Phase 3: User Story 1 - Ask About Home Sweet Home Data (Priority: P1) 🎯 MVP

**Goal**: An authorized caller asks a natural-language question and receives an answer grounded in
module data via discovered tools.

**Independent Test**: Drive `POST /conversation` with `FakeLLMProvider` + fake MCP server; verify the
agent discovers a tool, executes it, and returns the real tool result (and returns a plain reply with
no execution when the model selects no tool).

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T027 [P] [US1] Contract tests for `POST /conversation` (completed reply, no-tool reply, malformed body `400`) in `tests/contract/conversation.test.ts`
- [X] T028 [P] [US1] Integration test for read flow: tool discovery → schema-validated execution → grounded reply, in `tests/integration/read-conversation.test.ts`

### Implementation for User Story 1

- [X] T029 [P] [US1] Implement the tool safety policy table (read/write/destructive classification and required permission per category) in `src/config/policy.ts`
- [X] T030 [US1] Implement the tool executor (registry lookup, ajv validation of arguments against the discovered `inputSchema`, permission gate, execution, real-result propagation) in `src/conversation/tool-executor.ts`
- [X] T031 [US1] Implement the bounded conversation loop (provider call → tool calls → append results → repeat until message or `AGENT_MAX_TOOL_ITERATIONS`) in `src/conversation/loop.ts`
- [X] T032 [US1] Implement `POST /conversation` route and register it in `src/http/routes/conversation.ts` and `src/http/app.ts`
- [X] T033 [US1] Compose config → sources → provider → app factory → `server.listen` in `src/index.ts`
- [X] T034 [P] [US1] Unit tests for policy classification of all discovered tools in `tests/unit/policy.test.ts`
- [X] T035 [P] [US1] Unit tests for tool argument validation (unknown tool `tool_not_found`, malformed args `tool_validation_failed`) in `tests/unit/tool-executor.test.ts`

**Checkpoint**: User Story 1 works and is independently testable (MVP).

---

## Phase 4: User Story 2 - Perform a Confirmed Household Change (Priority: P1)

**Goal**: Authorized callers create/update tasks, while destructive actions require explicit,
single-use confirmation.

**Independent Test**: With a fake LLM requesting a write and a destructive tool, verify the write
executes, the destructive call returns `confirmation_required` without executing, and only an
approved, unexpired, caller-matched token executes exactly once.

**Dependency**: Extends the loop/tool-executor introduced in US1 (`src/conversation/loop.ts`,
`src/conversation/tool-executor.ts`), so it is implemented after US1.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T036 [P] [US2] Contract tests for `POST /confirm` (approve executes once; reject/invalid/expired/replayed token does not) in `tests/contract/confirm.test.ts`
- [X] T037 [P] [US2] Integration tests for write auto-execution and destructive confirmation round-trip in `tests/integration/confirmed-change.test.ts`

### Implementation for User Story 2

- [X] T038 [US2] Implement the in-memory single-use confirmation store (token, caller/conversation/tool/args-hash binding, TTL, approve/reject/expire/consume transitions) in `src/confirmation/store.ts`
- [X] T039 [US2] Extend the tool executor and loop to auto-execute writes with the `write` permission and return `confirmation_required` for destructive calls without executing, in `src/conversation/tool-executor.ts` and `src/conversation/loop.ts`
- [X] T040 [US2] Implement `POST /confirm` (re-validate presented tool/args against the live schema, execute exactly once, consume token) in `src/http/routes/confirm.ts`
- [X] T041 [US2] Wire the confirmation store into the composition root in `src/index.ts`
- [X] T042 [P] [US2] Unit tests for confirmation store transitions and single-use/expiry/replay in `tests/unit/confirmation-store.test.ts`

**Checkpoint**: US1 and US2 both work independently; no destructive action executes without approval.

---

## Phase 5: User Story 3 - Operate Through One Reliable MCP Host (Priority: P1)

**Goal**: One agent process owns the module MCP sessions, tolerates a failing source, and reports
per-source health.

**Independent Test**: Start fake streamable HTTP MCP servers for all four sources, connect one agent,
break one server, and verify the others stay usable while `GET /health` reports the failed source.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T043 [P] [US3] Contract tests for `GET /health` shape (overall + per-source + LLM readiness, no secrets) in `tests/contract/health.test.ts`
- [X] T044 [P] [US3] Integration tests for multi-source isolation and bounded timeout (one source down/hanging; healthy request still succeeds within limits) in `tests/integration/mcp-resilience.test.ts`

### Implementation for User Story 3

- [X] T045 [US3] Add bounded connect/call timeouts, bounded reconnect retries, and `ready/degraded/unavailable` transitions (without blocking other sources) to `src/mcp/source.ts`
- [X] T046 [US3] Implement health aggregation (`GET /health`: overall status, per-source state + tool count + safe error, LLM readiness) in `src/http/routes/health.ts`
- [X] T047 [US3] Register the health route and readiness refresh in `src/http/app.ts` and `src/index.ts`, replacing the scaffold inline handler
- [X] T048 [P] [US3] Unit tests for source state transitions and timeout bounding in `tests/unit/source.test.ts`

**Checkpoint**: One managed session per source; single-source failure does not hang or break others.

---

## Phase 6: User Story 4 - Use a Configurable, Affordable LLM Provider (Priority: P2)

**Goal**: Select provider/model/base URL/key by configuration (OpenCode Go DeepSeek, OpenCode free,
Ollama) without agent code changes.

**Independent Test**: Run the provider adapter against a fake OpenAI-compatible `/chat/completions`
endpoint configured with an OpenCode Go-style base URL and model, and verify the request body and
tool-call parsing.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [X] T049 [P] [US4] Contract tests for the OpenAI-compatible adapter against a fake `/chat/completions` endpoint in `tests/contract/llm-provider.contract.test.ts`

### Implementation for User Story 4

- [X] T050 [US4] Implement the OpenAI-compatible provider adapter (`chat()` with tools + `tool_choice: auto`, response/tool-call mapping, timeout, `llm_unavailable` classification) in `src/llm/openai-compatible.ts`
- [X] T051 [US4] Implement provider selection/factory from config in `src/llm/index.ts`
- [X] T052 [US4] Wire the configured provider into the composition root in `src/index.ts`
- [X] T053 [P] [US4] Unit tests for response mapping and provider failure classification in `tests/unit/provider.test.ts`
- [X] T054 [US4] Document provider selection and cloud-egress/privacy assumptions in `docs/README.md` and `.env.example`

**Checkpoint**: Provider is configuration-driven; provider outage returns `llm_unavailable` with no tool side effects.

---

## Phase 7: User Story 5 - Inspect Safe Operational Behavior (Priority: P2)

**Goal**: Contracts and failure behavior are testable without a real LLM or household changes, with
redaction and rejection enforcing safety by default.

**Independent Test**: Run the unit/contract/integration suites with no credentials or live services;
confirm sensitive values never appear in logs and unauthorized callers are rejected before any LLM
or MCP call.

**Dependency**: Cross-cutting; exercises flows from US1–US4, so it runs after them.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [X] T055 [P] [US5] Authorization tests proving every endpoint rejects unknown/invalid tokens (and missing permissions) before any LLM/MCP invocation in `tests/integration/authorization.test.ts`
- [X] T056 [P] [US5] Log-redaction assertions across conversation/confirm/health flows (no tokens, prompts, arguments, locations) in `tests/integration/log-redaction.test.ts`
- [X] T057 [P] [US5] Restart tests confirming in-memory conversations/confirmations are not restored or executed after a simulated restart in `tests/integration/restart.test.ts`

### Implementation for User Story 5

- [X] T058 [US5] Apply the redacting logger at every operational call site (auth, tool execution, provider, confirmation) across `src/`
- [X] T059 [US5] Enforce authorization-before-side-effect ordering in `src/http/middleware/auth.ts` and `src/http/routes/` so no LLM/MCP work precedes a rejection
- [X] T060 [US5] Document deterministic fakes and the no-credential test mode in `tests/fakes/README.md`

**Checkpoint**: Safe-by-default behavior is provable by automated tests with no external dependencies.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Remaining contract surface, developer tooling, documentation, and end-to-end validation.

- [X] T061 [P] Implement `POST /notifications` (zod event validation, `202 { accepted: true, id }`, in-memory record) in `src/notifications/contract.ts` and `src/http/routes/notifications.ts`, registered in `src/http/app.ts`
- [X] T062 [P] Unit tests for notification event validation and acknowledgement in `tests/unit/notifications.test.ts`
- [X] T063 [P] Implement the bearer-token generator CLI (`scripts/generate-token.ts`, `pnpm token:generate`, flags `--caller-id`/`--permissions`) printing the token once plus the hashed `AGENT_AUTH_TOKENS` entry
- [X] T064 [P] Implement the local chat CLI (`src/cli/chat.ts` core with injectable fetch, `scripts/chat.ts` REPL entrypoint, `pnpm chat`, flags `--once`/`--conversation`/`--verbose`/`--token`/`--url`) and unit tests in `tests/unit/chat-client.test.ts`
- [X] T065 [P] Add runnable REST-client requests for all four endpoints in `docs/agent.http`
- [X] T066 [P] Document the HTTP contract, error codes, tool policy, auth model, and provider setup in `docs/http-contract.md`
- [X] T067 Update `README.md` quick start with `pnpm token:generate`, `pnpm chat`, auth token, provider, and MCP URL configuration
- [X] T068 [P] Verify `Dockerfile`/`compose.yaml` pass through new environment variables
- [X] T069 Run `specs/001-agent-core/quickstart.md` validation: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`

---

## Phase 9: Tool Trace & Audit Logging (addendum)

**Goal**: Expose which module tools the agent selected (names only) in the API response and in logs,
so a Home Assistant adapter and operators can observe tool usage without leaking arguments.

**Independent Test**: Drive `/conversation` and `/confirm` with fakes and assert the `trace` array and
`info`-level `tool.call` logs name the tools and contain no argument values.

- [X] T070 [P] Add `ToolTraceEntry`/`trace` types in `src/conversation/types.ts`
- [X] T071 Accumulate a tool trace and emit an `info` `tool.call` audit event in `src/conversation/loop.ts`
- [X] T072 [P] Return the trace from `src/http/routes/confirm.ts` (executed/rejected)
- [X] T073 [P] Unit tests for trace outcomes (read/write/destructive/failed, no args) in `tests/unit/trace.test.ts`
- [X] T074 [P] Contract tests for `trace` on `/conversation` and `/confirm` in `tests/contract/trace.test.ts`
- [X] T075 [P] Integration test for trace order + `info` logging in `tests/integration/trace.test.ts`
- [X] T076 [P] Update `docs/http-contract.md`, `README.md`, `.env.example`, and spec contracts/data-model
- [X] T077 Validate: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–7)**: All depend on Foundational.
  - US1, US3, US4 can start in parallel after Foundational.
  - US2 depends on US1 (extends the loop/tool-executor).
  - US5 depends on US1–US4 (cross-cutting verification).
- **Polish (Phase 8)**: Depends on all desired stories; T069 runs last.

### User Story Dependencies

- **US1 (P1)**: After Foundational — no dependency on other stories. **MVP.**
- **US2 (P1)**: After US1 — extends shared conversation loop/tool-executor.
- **US3 (P1)**: After Foundational — builds on `src/mcp/source.ts` and app factory.
- **US4 (P2)**: After Foundational — implements the provider interface against the loop.
- **US5 (P2)**: After US1–US4 — verifies their end-to-end safety behavior.

### Within Each User Story

- Tests first and failing → policy/types → services → routes → composition → story validation.
- US2/US3 edit files created earlier; sequence within the story to avoid same-file conflicts.

### Parallel Opportunities

- Setup: T003, T004, T005.
- Foundational: T007–T014 and T018 (distinct files) and T019–T026 (test/fake files).
- US1: T027/T028 tests; T029, T034, T035 independent files.
- US2: T036/T037 tests; T042 tests.
- US3: T043/T044 tests; T048 tests.
- US4: T049 test; T053 test; T054 docs.
- US5: T055–T057 (distinct test files) in parallel.
- Polish: T061, T063, T064, T065, T066, T068 parallel.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational) — CRITICAL, blocks all stories.
3. Complete Phase 3 (US1) and validate: `pnpm vitest run tests/contract/conversation.test.ts tests/integration/read-conversation.test.ts`.
4. Stop and demo the read-only grounded answer path.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → grounded reads (MVP).
3. US2 → confirmed writes/destructive safety.
4. US3 → resilient single MCP host + health.
5. US4 → real configurable provider.
6. US5 → provable safe-by-default behavior.
7. Polish → notifications, token generator, chat CLI, docs, full quickstart validation.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. After Foundational: Developer A → US1 (then US2), Developer B → US3, Developer C → US4.
3. US5 after US1–US4 converge; Polish last.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks.
- `[Story]` labels map tasks to spec user stories for traceability.
- Tests MUST be written and fail before the corresponding implementation task.
- Commit after each task or logical group.
- Every code task must satisfy the constitution: one MCP host, explicit authorization, safe tool
  execution, provider-agnostic LLM, private-by-default with redaction, contract-first, test-first.
