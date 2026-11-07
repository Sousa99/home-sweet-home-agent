# Tasks: Agent Deployment Readiness

**Input**: Design documents from `/specs/003-agent-deployment-readiness/`

**Prerequisites**: `spec.md`, `plan.md`, `contracts/probes.md`

**Tests**: Required by the constitution; every behavior task is preceded by a failing test.

**Organization**: Grouped by user story so each slice is independently verifiable.

## Phase 1: Setup

- [X] T001 Write the feature specification in `specs/003-agent-deployment-readiness/spec.md`
- [X] T002 Write the implementation plan in `specs/003-agent-deployment-readiness/plan.md`
- [X] T003 Write the probe contract in `specs/003-agent-deployment-readiness/contracts/probes.md`
- [X] T004 Point `.specify/feature.json` at `specs/003-agent-deployment-readiness`

---

## Phase 2: Foundational

- [X] T005 Deliver the reproducible non-root image and GHCR publish workflow (`Dockerfile`,
  `.github/workflows/publish-agent.yml`, `tests/contract/container.test.ts`) — landed in `c009fcf`

**Checkpoint**: Image builds, runs as uid 1000, and publishes from `main`.

---

## Phase 3: User Story 1 - Orchestrator Health Probes (Priority: P1) 🎯 MVP

**Goal**: Unauthenticated liveness and readiness endpoints with no network I/O and no secrets.

**Independent Test**: Call `/healthz` and `/readyz` without credentials and verify status codes for
ready, not-ready, and draining states, while `/health` remains `401`.

### Tests

- [X] T006 [P] [US1] Write failing probe contract tests in `tests/contract/probes.test.ts`
- [X] T007 [P] [US1] Extend `tests/fakes/harness.ts` to inject drain state and public-path behavior

### Implementation

- [X] T008 [US1] Add `src/http/routes/probes.ts` with `/healthz` and `/readyz`
- [X] T009 [US1] Add `publicPaths` support to `src/http/middleware/auth.ts`
- [X] T010 [US1] Add `isDraining` to `src/http/context.ts` and mount probes in `src/http/app.ts`

**Checkpoint**: Probes work without auth; detailed `/health` is unchanged.

---

## Phase 4: User Story 2 - Safe Production Startup and Shutdown (Priority: P1)

**Goal**: Fail fast on an unconfigured production instance and drain before closing.

**Independent Test**: `loadConfig({ NODE_ENV: 'production' })` throws; the same call with
`NODE_ENV: 'development'` succeeds. Drain state flips `/readyz` to `503`.

### Tests

- [X] T011 [P] [US2] Write failing production fail-fast tests in `tests/unit/config.test.ts`
- [X] T012 [P] [US2] Add the draining assertion to `tests/contract/probes.test.ts`

### Implementation

- [X] T013 [US2] Read `NODE_ENV` and reject an empty token map in production in
  `src/config/config.ts`
- [X] T014 [US2] Add drain-on-signal and bounded force-close shutdown in `src/index.ts`

**Checkpoint**: Misconfigured production refuses to start; termination drains before exit.

---

## Phase 5: User Story 3 - CI Gates on Every Change (Priority: P2)

**Goal**: Run the full quality gate on pull requests and pushes.

**Independent Test**: Inspect `tests/contract/ci.test.ts` and confirm the workflow triggers and
steps.

### Tests

- [X] T015 [P] [US3] Write the failing CI workflow contract test in `tests/contract/ci.test.ts`

### Implementation

- [X] T016 [US3] Add `.github/workflows/ci.yml` for `pull_request` and pushes

**Checkpoint**: No unverified commit can reach `main`.

---

## Phase 6: User Story 4 - Deployment Contract (Priority: P2)

**Goal**: Document the image, environment, Secrets, and probes for `home-sweet-lab`.

**Independent Test**: Read `docs/deployment.md` and confirm every startup variable is listed.

### Tests

- [X] T017 [P] [US4] Add a doc-contract assertion for required variable names and secret markers

### Implementation

- [X] T018 [US4] Write `docs/deployment.md`
- [X] T019 [US4] Document the probes and auth boundary in `docs/http-contract.md`
- [X] T020 [US4] Link the deployment document from `docs/README.md`

**Checkpoint**: The lab can write manifests from the document alone.

---

## Phase 7: Polish

- [X] T021 Update `.env.example` with `NODE_ENV` and probe notes
- [X] T022 Run `pnpm typecheck`, `pnpm lint`, `pnpm format`, and `pnpm test`
- [X] T023 Rebuild the image and smoke-test `/healthz` and `/readyz` as non-root with no dev deps

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phases 3/5/6 can proceed in parallel; Phase 4 shares the probe test file with
  Phase 3 and must follow T006/T007.
- Tests are written and observed failing before each implementation task.
- Phase 7 runs after every selected story is complete.

## Notes

- Do not change `/health`, tool policy, confirmation behavior, or MCP handling.
- Keep probe payloads free of URLs, keys, prompts, tool arguments, and household locations.
