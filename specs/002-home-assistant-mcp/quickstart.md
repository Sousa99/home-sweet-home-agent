# Quickstart & Validation: Home Assistant MCP Integration

Runnable scenarios that prove the Home Assistant MCP source works end-to-end. Automated scenarios use
fakes and require no live Home Assistant instance or credentials (FR-017, SC-001, SC-008). Contracts
and entity details live in `contracts/` and `data-model.md`; this file is the validation guide only.

## Prerequisites

- Node.js >= 24 and pnpm (`corepack enable`); `pnpm install` already run.
- For manual runs only: a Home Assistant instance with the **Model Context Protocol Server**
  integration enabled (Settings > System > AI), a long-lived access token, and entities exposed to
  Assist. Set `HOME_ASSISTANT_MCP_URL` and `HOME_ASSISTANT_MCP_TOKEN` in `.env` (never committed).
  Use the official home-server endpoint `https://home-assistant.<tailnet>.ts.net/api/mcp` over
  Tailscale, or `http://localhost:8123/api/mcp` for a local instance.

## 1. Static quality gates

```bash
pnpm format      # prettier --check
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run — unit, contract, integration
```

Expected: all pass with no external services running.

## 2. Unit validation

```bash
pnpm vitest run tests/unit/config.test.ts tests/unit/policy.test.ts tests/unit/mcp-client-headers.test.ts
```

Covers: Home Assistant env parsing and defaults; the credential never appears in `AgentConfig`
serialization or errors; the Home Assistant classifier maps query tools to `read`, benign domain
controls to `write`, and generic intents/unclassified tools to `destructive`; the `Authorization`
header reaches the transport `requestInit`.

Expected: `home_assistant__intent__HassTurnOn` resolves to policy `destructive`; the configured token
is absent from any logged or returned structure.

## 3. Contract validation

```bash
pnpm vitest run tests/contract/opencode-config.test.ts
pnpm vitest run tests/contract
```

Covers: `opencode.json` registers an enabled `remote` `home-assistant` server with `oauth: false` and
no literal secret; the frozen HTTP/trace/health contracts are unchanged for existing sources.

Expected: the OpenCode configuration test passes and finds no literal credential; existing contract
tests stay green.

## 4. Integration validation (fake Home Assistant MCP)

```bash
pnpm vitest run tests/integration/home-assistant-source.test.ts
```

Starts an in-process fake Home Assistant MCP server advertising a query tool, a benign domain control
tool, and a generic control tool, plus the existing module fakes, and drives the agent with
`FakeLLMProvider`. Key scenarios and expected outcomes:

| Scenario | Expected (spec ref) |
| -------- | ------------------- |
| Read question selects a Home Assistant query tool | `completed`; reply contains the real result (US1, SC-001) |
| Home Assistant listed with the four modules at startup | one managed session each; HA tools namespaced (US1 scenario 2) |
| Benign domain control with `write` permission | executed; real result returned (US2 scenario 1) |
| Generic control tool requested | `confirmation_required`; tool NOT executed (SC-002, US2 scenario 2) |
| Approve pending action before expiry | executes exactly once; replay → `confirmation_invalid` (US2 scenario 3) |
| Home Assistant unavailable, request targets a module | module request succeeds; no HA data claimed (US3, SC-004) |
| Home Assistant reachable after retry | reconnected session used within policy (US3 scenario 3) |
| Fake server receives the request | `Authorization: Bearer <token>` header present; token never logged (SC-006) |

## 5. OpenCode configuration smoke (optional, real Home Assistant)

```bash
export HOME_ASSISTANT_TOKEN="<long-lived access token>"
opencode mcp list        # Home Assistant tools appear
```

Expected: the Home Assistant tools are listed and callable; unsetting `HOME_ASSISTANT_TOKEN` still
lets OpenCode start with the module MCP servers usable (US4).

## 6. Agent smoke (optional, real Home Assistant)

```bash
# .env: set HOME_ASSISTANT_MCP_URL, HOME_ASSISTANT_MCP_TOKEN, and the LLM/MCP settings
pnpm dev
pnpm chat -- --token "<the token>" --once "What lights are on right now?"
pnpm chat -- --token "<the token>" --once "Turn off the living room lights"
```

Expected: the first request returns a grounded answer from Home Assistant; the second either executes
a benign write directly or returns a confirmation request for a generic control, and `/health` reports
`home_assistant` alongside the four modules.

## Validation checklist

- [ ] `pnpm format && pnpm lint && pnpm typecheck` pass.
- [ ] `pnpm test` green with no credentials or live Home Assistant.
- [ ] Home Assistant read conversation completes through discovery + execution (SC-001).
- [ ] Every destructive Home Assistant action requires a valid unexpired approval (SC-002).
- [ ] Unknown/unauthorized callers rejected pre-LLM/MCP (SC-003).
- [ ] Home Assistant outage → bounded failure; module sources stay usable (SC-004).
- [ ] `/health` reports Home Assistant within 10s without credential/entity details (SC-005).
- [ ] Log assertions find no token, prompts, full arguments, or locations (SC-006).
- [ ] `opencode.json` registers Home Assistant and contains no literal secret (SC-007).
- [ ] All Home Assistant source behavior covered by automated tests (SC-008).
