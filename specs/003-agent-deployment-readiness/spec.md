# Feature Specification: Agent Deployment Readiness

**Feature Branch**: `feature/003-agent-deployment-readiness`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Containerize the agent and make it production-ready so `home-sweet-lab`
can deploy it as a Flux-managed workload: a publishable image, orchestrator probes, safe production
startup and shutdown, PR CI, and a deployment contract."

## Scope

This feature completes everything the agent repository owes the deployment in `home-sweet-lab`:
a reproducible non-root image published to GHCR, unauthenticated liveness and readiness probes,
fail-fast production configuration, graceful termination, CI gates on every change, and a written
deployment contract.

It does **not** create the Kubernetes manifests, Secrets, or Flux resources. Those are owned by
`home-sweet-lab` and are specified there.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Orchestrator Health Probes (Priority: P1)

As the cluster operator, I want the agent to expose unauthenticated liveness and readiness endpoints
so Kubernetes can start, route to, and stop the pod without holding a caller bearer token.

**Why this priority**: Without unauthenticated probes the deployment can only use TCP checks and
cannot distinguish a live process from a usable service.

**Independent Test**: Start the app with fakes, call `/healthz` and `/readyz` with no
`Authorization` header, and verify liveness always succeeds while readiness reflects provider state
and draining without exposing secrets.

**Acceptance Scenarios**:

1. **Given** the process is running, **when** `/healthz` is called without credentials, **then** it
   returns `200` with no sensitive data.
2. **Given** the LLM provider is ready and the instance is not draining, **when** `/readyz` is called
   without credentials, **then** it returns `200`.
3. **Given** the LLM provider is not ready or the instance is draining, **when** `/readyz` is called,
   **then** it returns `503`.
4. **Given** probes are called repeatedly, **when** they run, **then** they perform no network calls
   and do not touch the LLM provider.
5. **Given** the detailed `/health` endpoint, **when** it is called without credentials, **then** it
   still returns `401`.

---

### User Story 2 - Safe Production Startup and Shutdown (Priority: P1)

As the cluster operator, I want a misconfigured production instance to fail fast and a terminating
instance to stop receiving traffic first, so the deployment never serves a half-configured or
half-shut-down agent.

**Why this priority**: An instance with no configured callers silently 401s every request, and a pod
that disappears mid-conversation loses work.

**Independent Test**: Load configuration with `NODE_ENV=production` and no tokens and verify startup
is rejected; toggle draining and verify readiness reports `503` before shutdown completes.

**Acceptance Scenarios**:

1. **Given** `NODE_ENV=production` and no auth tokens, **when** configuration loads, **then** startup
   fails with a clear message that contains no secret values.
2. **Given** non-production development, **when** no tokens are configured, **then** the agent still
   starts so local inspection remains possible.
3. **Given** a running instance, **when** it receives `SIGTERM`, **then** it marks itself not ready
   before closing the server and bounds forced connection closure.

---

### User Story 3 - CI Gates on Every Change (Priority: P2)

As a maintainer, I want pull requests and `main` pushes to run typechecking, linting, formatting,
and tests so the published image cannot come from an unverified commit.

**Why this priority**: The publish workflow only runs on `main`; without PR gates a broken change is
already merged before it is caught.

**Independent Test**: Inspect `.github/workflows/ci.yml` and verify it runs the full quality gate on
`pull_request` and on pushes, independent of the publish workflow.

**Acceptance Scenarios**:

1. **Given** a pull request, **when** CI runs, **then** typecheck, lint, format, and tests execute.
2. **Given** a push to `main`, **when** CI runs, **then** the same gates execute before publish.

---

### User Story 4 - Deployment Contract (Priority: P2)

As the operator of `home-sweet-lab`, I want a single document describing the image, ports, probes,
required environment, and required Secrets so I can write correct manifests without reading source.

**Why this priority**: The lab repository should consume a contract, not reverse-engineer runtime
configuration.

**Independent Test**: Read `docs/deployment.md` and confirm every variable the agent reads at startup
is listed with whether it is secret, plus the image and probe contract.

**Acceptance Scenarios**:

1. **Given** the deployment document, **when** an operator prepares manifests, **then** image tag
   format, port, probes, non-secret environment, and required Secrets are all specified.
2. **Given** the document, **when** it is reviewed, **then** it contains no credential values or real
   tailnet identifiers.

---

### Edge Cases

- All MCP sources unavailable while the LLM is ready: readiness stays `200` (graceful degradation).
- LLM key missing for a remote endpoint: readiness returns `503`.
- `/readyz` called during the shutdown grace window: returns `503` immediately.
- Missing auth tokens in production: startup fails before binding the port.
- Container filesystem is read-only: the agent writes nothing at runtime.
- Probes are hit at high frequency: no LLM or MCP calls are made.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The image MUST build reproducibly from the lockfile, run as a non-root user, contain no
  development dependencies, and publish to GHCR with `main-YYYYMMDDHHMMSS-<sha>` tags. *(Delivered.)*
- **FR-002**: `GET /healthz` MUST be unauthenticated and return `200` whenever the process is alive.
- **FR-003**: `GET /readyz` MUST be unauthenticated and return `200` only when the provider is ready
  and the instance is not draining; otherwise `503`.
- **FR-004**: Probes MUST NOT perform network I/O or call the LLM provider.
- **FR-005**: Probe responses MUST NOT include credentials, provider keys, MCP URLs, prompts, tool
  arguments, or household locations.
- **FR-006**: `GET /health` MUST remain authenticated and keep its detailed source and provider
  report.
- **FR-007**: In production (`NODE_ENV=production`), startup MUST fail when no auth tokens are
  configured; development startup MUST remain permissive.
- **FR-008**: The startup error MUST NOT contain token values.
- **FR-009**: On `SIGTERM`/`SIGINT`, the agent MUST mark itself not ready before closing the server
  and MUST bound forced connection closure.
- **FR-010**: CI MUST run typecheck, lint, format, and tests on pull requests and pushes.
- **FR-011**: `docs/deployment.md` MUST document the image, tag convention, port, probes, non-secret
  environment, required Secrets, and registry visibility.
- **FR-012**: `docs/http-contract.md` MUST document the unauthenticated probes and the remaining
  authenticated surface.
- **FR-013**: Automated tests MUST cover probe authentication exemption, readiness semantics,
  production fail-fast, CI configuration, and the existing image contract.

### Key Entities

- **Probe State**: Liveness (process alive) and readiness (provider ready, not draining).
- **Drain State**: Runtime flag set on termination before the HTTP server closes.
- **Deployment Contract**: The documented image, configuration, and Secret surface consumed by
  `home-sweet-lab`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of `/healthz` and `/readyz` calls succeed without an `Authorization` header.
- **SC-002**: `/readyz` returns `503` in 100% of draining or provider-not-ready test cases.
- **SC-003**: 100% of production startup tests with an empty token map fail before listening.
- **SC-004**: `/health` still returns `401` without credentials in 100% of tests.
- **SC-005**: CI configuration covers every quality gate the publish workflow depends on.
- **SC-006**: Every startup variable and required Secret appears in `docs/deployment.md`.

## Assumptions

- `home-sweet-lab` switches the agent pod to HTTP probes once `/healthz` and `/readyz` exist.
- The cluster may make the GHCR package public, matching existing lab images, or supply a pull Secret.
- The agent remains a single replica; conversation and confirmation state stay in memory.
- Readiness reflects the agent's ability to serve, not the availability of every MCP source, because
  source outage is an explicitly supported degraded mode.

## Out of Scope

- Kubernetes manifests, Secrets, Flux resources, and Tailscale ingress (owned by `home-sweet-lab`).
- The Home Assistant conversation adapter, proactive triggers, metrics, autoscaling, and durable state.
- Changing the existing authenticated `/health` payload.
