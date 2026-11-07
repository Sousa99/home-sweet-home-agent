# Implementation Plan: Agent Deployment Readiness

**Branch**: `feature/003-agent-deployment-readiness` | **Date**: 2026-11-07 | **Spec**:
[spec.md](./spec.md)

## Summary

Finish the runtime and repository contracts the cluster needs: unauthenticated probes, fail-fast
production configuration, graceful termination, PR CI, and a deployment document. The image build and
GHCR publish pipeline already landed in `c009fcf`.

## Technical Context

- **Stack**: Node.js 24, TypeScript, Hono, Vitest.
- **Runtime**: single process; MCP clients and LLM provider are injected in `src/index.ts`.
- **Auth**: a single bearer middleware currently protects every route (`src/http/app.ts`).
- **Health**: `src/http/routes/health.ts` computes overall status from source states and
  `provider.checkReady()`, which is a local check with no network I/O.
- **Testing**: contract tests build the app through `tests/fakes/harness.ts`.

## Design Decisions

1. **Probe routes are separate from `/health`.** `src/http/routes/probes.ts` serves `/healthz` and
   `/readyz`. `/health` stays authenticated and unchanged.
2. **Auth exemption is explicit.** `createAuthMiddleware` accepts `publicPaths`; only the two probe
   paths are exempt. This keeps the default deny-by-default behavior.
3. **Readiness is provider-based, not source-based.** MCP outages are a supported degraded mode, so
   `/readyz` returns `200` while the provider is ready and the instance is not draining. It reuses
   `provider.checkReady()`, which performs no network calls.
4. **Draining is injected, not global.** `AppDeps.isDraining` defaults to `false`; `src/index.ts`
   owns a mutable flag and flips it on termination, so probe behavior is unit-testable.
5. **Production fail-fast lives in configuration loading.** `loadConfig` reads `NODE_ENV` and throws
   when production has an empty auth-token map. The message names the variable, never a value.
6. **Shutdown order is drain → close → force close.** The server closes normally, with a bounded
   timer that force-closes remaining keep-alive connections.
7. **CI is independent of publish.** `.github/workflows/ci.yml` runs the four quality gates on
   `pull_request` and pushes; `publish-agent.yml` keeps publishing only from `main`.

## Files

| File | Change |
| ---- | ------ |
| `src/http/routes/probes.ts` | New `/healthz` and `/readyz` routes |
| `src/http/app.ts` | Mount probes; pass public paths and drain state |
| `src/http/middleware/auth.ts` | `publicPaths` exemption |
| `src/http/context.ts` | `isDraining` dependency |
| `src/config/config.ts` | `NODE_ENV` and production token fail-fast |
| `src/index.ts` | Drain flag and bounded graceful shutdown |
| `.github/workflows/ci.yml` | PR/push quality gates |
| `docs/deployment.md` | Deployment contract |
| `docs/http-contract.md` | Probe contract and auth exemption |
| `docs/README.md` | Link deployment doc |
| `tests/contract/probes.test.ts` | Probe behavior |
| `tests/contract/ci.test.ts` | CI workflow contract |
| `tests/unit/config.test.ts` | Production fail-fast |
| `tests/fakes/harness.ts` | Drain-state injection |

## Constitution Check

- **Authorization**: only `/healthz` and `/readyz` bypass auth; they expose no household or
  credential data. `/health` and all action endpoints stay authenticated.
- **Safe execution**: no tool or action behavior changes.
- **Private by default**: probe payloads contain only service name, status, source state, and tool
  counts.
- **Test-first**: every behavior change lands with a failing test first.
- **Contract-first**: probe and deployment contracts are documented and tested.

## Verification

```bash
pnpm typecheck && pnpm lint && pnpm format && pnpm test
docker build -t hsh-agent:local .
docker run --rm -p 13400:3400 hsh-agent:local sh -c 'true'
curl -fsS http://127.0.0.1:13400/healthz
```

The container smoke run requires `NODE_ENV=production` auth tokens, so the final manual check uses a
temporary token or `NODE_ENV=development`.
