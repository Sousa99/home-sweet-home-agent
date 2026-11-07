---

description: "Task list for Home Assistant MCP Integration"
---

# Tasks: Home Assistant MCP Integration

**Input**: Design documents from `/specs/002-home-assistant-mcp/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED. The constitution (VII. Test-First Development) and `AGENTS.md` mandate a failing
test before every behavior change. Write each test task first, run it, and confirm it fails before
implementing the paired task.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1, US2, US3, US4)
- Every task includes an exact file path

## Path Conventions

Single project: `src/`, `tests/`, `docs/` at repository root, plus `opencode.json`, `.env.example`,
and `compose.yaml`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Document and expose the new Home Assistant MCP configuration variables.

- [X] T001 Add `HOME_ASSISTANT_MCP_URL` (default `http://localhost:8123/api/mcp`) and `HOME_ASSISTANT_MCP_TOKEN` (empty) to `.env.example`
- [X] T002 Pass `HOME_ASSISTANT_MCP_URL` and `HOME_ASSISTANT_MCP_TOKEN` through the agent service environment in `compose.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared plumbing every user story depends on: source configuration, credential-bearing
headers, the Home Assistant safety classifier, and test fakes.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests first

- [X] T003 [P] Add failing config tests to `tests/unit/config.test.ts`: default `mcpSources` includes `home_assistant` with URL `http://localhost:8123/api/mcp`; `HOME_ASSISTANT_MCP_URL`/`HOME_ASSISTANT_MCP_TOKEN` are parsed; the token never appears in the returned config serialization
- [X] T004 [P] Add a failing header-propagation test to `tests/unit/mcp-client-headers.test.ts` asserting `createMcpClient({ url, headers })` passes `Authorization` into the transport `requestInit.headers`
- [X] T005 [P] Add failing classifier tests to `tests/unit/policy.test.ts`: `home_assistant.homeassistant__GetLiveContext`/`llm__GetDateTime`/`todo__get_items` → `read`; `light__HassLightSet`/`climate__HassClimateSetTemperature`/`media_player__*`/`todo__HassListAddItem` → `write`; `intent__HassTurnOn`/`intent__HassTurnOff`/`intent__HassToggle`/`intent__HassSetPosition` and unknown tools → `destructive`

### Implementation

- [X] T006 Add `HOME_ASSISTANT_MCP_URL`/`HOME_ASSISTANT_MCP_TOKEN` to the env schema and append the `home_assistant` source (with `headers: { Authorization: 'Bearer <token>' }` when the token is set) to `AgentConfig.mcpSources` in `src/config/config.ts`; add optional `headers` to `McpSourceConfig`
- [X] T007 Extend `createMcpClient` to accept `headers` and pass them as `requestInit.headers` in `src/mcp/client.ts`
- [X] T008 Extend `McpSourceOptions`/`McpSource` to accept `headers` and forward them to `createClient` in `src/mcp/source.ts`
- [X] T009 Add `classifyHomeAssistantTool(originalName, fallback)` and wire it into `classifyTool` for `sourceId === 'home_assistant'` in `src/config/policy.ts`
- [X] T010 Extend `startFakeMcpServer` in `tests/fakes/fake-mcp-server.ts` to advertise Home Assistant-style tools and capture received request headers into the returned handle for assertions
- [X] T011 Add a `home_assistant` source helper (URL + `Authorization` header) to `tests/fakes/sample-config.ts`
- [X] T012 Wire the composition root in `src/index.ts` to pass each source's `headers` into `McpSource` and to route `home_assistant` classification through the new classifier

**Checkpoint**: Foundation ready — configuration, headers, classifier, fakes, and composition root in place.

---

## Phase 3: User Story 1 - Ask About Household Devices (Priority: P1) 🎯 MVP

**Goal**: An authorized caller can ask about home state and get an answer grounded in Home Assistant
MCP tool output.

**Independent Test**: Run the agent against a fake Home Assistant MCP server advertising query tools;
a read request completes, and the reply contains the real tool result.

- [X] T013 [US1] Integration test: fake Home Assistant MCP + fake LLM completes a read conversation (discovery, namespacing, `executed` trace, grounded reply) in `tests/integration/home-assistant-source.test.ts`
- [X] T014 [P] [US1] Unit test: double-underscore Home Assistant tool names (`intent__HassTurnOn`, `homeassistant__GetLiveContext`) namespace to `home_assistant__*` and split back to `(home_assistant, original)` in `tests/unit/registry.test.ts`

**Checkpoint**: User Story 1 works independently — read-only Home Assistant conversations are grounded.

---

## Phase 4: User Story 2 - Control Devices Safely (Priority: P1)

**Goal**: Benign domain control executes for an authorized caller; generic entity control requires a
single-use confirmation.

**Independent Test**: With a fake Home Assistant MCP advertising a benign control and a generic
control, the benign one executes and the generic one returns `confirmation_required`; approval
executes once, rejection/expiry executes nothing.

- [X] T015 [US2] Integration test: benign `write` control auto-executes with `write` permission; generic `intent__HassTurnOn` returns `confirmation_required`; approve executes once; reject/expiry/wrong-caller execute nothing in `tests/integration/home-assistant-control.test.ts`
- [X] T016 [P] [US2] Contract test: `POST /conversation` and `POST /confirm` trace entries for Home Assistant use namespaced names and `sourceId: home_assistant` in `tests/contract/trace.test.ts`
- [X] T017 [P] [US2] Integration test: the Home Assistant token and full tool arguments are absent from logs during a control flow in `tests/integration/log-redaction.test.ts`

**Checkpoint**: User Stories 1 and 2 both work independently — read and safe control.

---

## Phase 5: User Story 3 - Operate Home Assistant as One Reliable Managed Source (Priority: P2)

**Goal**: Home Assistant degrades gracefully and is reported in health without breaking module tools.

**Independent Test**: With Home Assistant unavailable and modules healthy, module requests succeed
and health reports Home Assistant accurately.

- [X] T018 [US3] Integration test: Home Assistant unavailable at startup and mid-session leaves module sources usable, and a later successful reconnect is used, in `tests/integration/home-assistant-resilience.test.ts`
- [X] T019 [US3] Contract test: `GET /health` lists `home_assistant` with state and tool count and no credential or entity details in `tests/contract/health.test.ts`
- [X] T020 [US3] Verify and, if needed, adjust Home Assistant source error mapping (auth rejection, timeout, disconnect) to `degraded`/`unavailable` with bounded retries in `src/mcp/source.ts`

**Checkpoint**: Home Assistant is a reliable managed source; module behavior is unaffected.

---

## Phase 6: User Story 4 - Exercise Home Assistant MCP in OpenCode (Priority: P2)

**Goal**: The OpenCode MCP configuration registers Home Assistant for direct development use with no
committed secret.

**Independent Test**: The config test confirms an enabled remote Home Assistant server with no literal
token; OpenCode lists its tools when the env token is set.

- [X] T021 [US4] Contract test: `opencode.json` contains an enabled `remote` `home-assistant` server pointing at `/api/mcp` with `oauth: false` and no literal secret in `tests/contract/opencode-config.test.ts`
- [X] T022 [US4] Add the `home-assistant` remote MCP entry with `Authorization: Bearer {env:HOME_ASSISTANT_TOKEN}` to `opencode.json`

**Checkpoint**: All user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and full validation across stories.

- [X] T023 [P] Document the Home Assistant MCP source, credential handling, and tool policy in `docs/http-contract.md` and `docs/README.md`
- [X] T024 [P] Update `README.md` capabilities and project status to include Home Assistant as the fifth MCP source
- [X] T025 Run `pnpm format && pnpm lint && pnpm typecheck && pnpm test` and fix any failures
- [X] T026 Run the `specs/002-home-assistant-mcp/quickstart.md` validation scenarios and confirm the checklist

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational.
  - US1 and US2 are both P1; US2 depends on US1's composition-root wiring (T012).
  - US3 and US4 depend on Foundational only.
- **Polish (Phase 7)**: Depends on all targeted user stories.

### Within Each User Story

- Test tasks first; confirm they FAIL before the paired implementation.
- Implementation order: config/client/source → classifier → composition root → story behavior.
- Story complete and independently validated before moving to the next priority.

### Parallel Opportunities

- T003, T004, T005 (foundational tests) touch different test files → parallel.
- T010, T011 (fakes) are independent of T006–T009 and can proceed in parallel once interfaces exist.
- T014 (US1) is independent of T015–T017.
- T016, T017 run in parallel within US2.
- T023, T024 run in parallel within Polish.

---

## Parallel Example: Foundational Tests

```bash
# Launch all failing foundational tests together:
Task: "Config HA source tests in tests/unit/config.test.ts"
Task: "Header propagation test in tests/unit/mcp-client-headers.test.ts"
Task: "HA classifier tests in tests/unit/policy.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Trace contract test for HA in tests/contract/trace.test.ts"
Task: "Log redaction test for HA in tests/integration/log-redaction.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run T013 and T014; confirm a grounded read conversation.
5. Deploy/demo if ready.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Add US1 → validate → demo (MVP: read-only Home Assistant through the agent).
3. Add US2 → validate → demo (safe device control with confirmation).
4. Add US3 → validate → demo (resilient managed source + health).
5. Add US4 → validate → demo (OpenCode direct inspection).
6. Polish → documentation and full quality gates.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. After Foundational: Developer A owns US1 then US2 (shared composition path); Developer B owns US3;
   Developer C owns US4. Integrate and run the full suite at the end.

---

## Notes

- [P] tasks touch different files and have no incomplete dependencies.
- Every behavior task has a paired failing test written first.
- The token is a secret: never commit it, never log it, never return it in responses or health.
- Generic Home Assistant entity control is destructive by design; do not downgrade it to `write`.
- Commit after each task or logical group; stop at any checkpoint to validate a story alone.
- Avoid: vague tasks, editing the same file in parallel [P] tasks, cross-story coupling that breaks
  independent testing.
