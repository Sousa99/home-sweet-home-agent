# Quickstart & Validation: Centralized MCP Agent Core

Runnable scenarios that prove the feature works end-to-end. All automated scenarios use fakes and
require no live modules, credentials, or external network (FR-021, SC-001, SC-009). Contracts and
entity details live in `contracts/` and `data-model.md`; this file is the validation guide only.

## Prerequisites

- Node.js >= 24 and pnpm (`corepack enable`).
- Dependencies installed: `pnpm install`.
- For manual runs only: copy `.env.example` to `.env` and set `AGENT_AUTH_TOKENS` plus the LLM/provider
  and MCP URLs. Secrets are never committed.

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
pnpm vitest run tests/unit
```

Covers: config schema/defaults, `ToolPolicy` classification table, registry namespacing/lookup,
confirmation store transitions (approve/reject/expire/replay/single-use), provider response mapping,
and logger redaction.

Expected: wire-safe namespaced names like `tasks__task_delete` resolve to `(tasks, task.delete)`; a consumed
confirmation cannot execute twice; redaction assertions find no tokens/prompts/arguments.

## 3. HTTP contract validation

```bash
pnpm vitest run tests/contract
```

Exercises `http/app.ts` via Hono's `app.request()`:

- `GET /health` → overall + per-source + LLM readiness shape (FR-014).
- `POST /conversation` with no/invalid bearer token → `401 unauthorized` and no LLM/MCP call (SC-003).
- `POST /conversation` malformed body → `400 malformed_request`.
- `POST /confirm` with unknown/expired/consumed token → `confirmation_invalid`/`confirmation_expired`.
- `POST /notifications` valid → `202 { accepted: true }`; invalid `type` → `400 malformed_request`.

## 4. Integration validation (fake MCP + fake LLM)

```bash
pnpm vitest run tests/integration
```

Starts in-process fake streamable HTTP MCP servers (healthy, plus one failing and one destructive
tool) and drives the agent with `FakeLLMProvider`. Key scenarios and expected outcomes:

| Scenario | Expected (spec ref) |
| -------- | ------------------- |
| Read-only question selects a bus/weather tool | `completed`; reply contains the real tool result (SC-001, US1) |
| Model returns a message with no tool call | `completed`; no MCP tool executed (US1 scenario 3) |
| Write tool with valid args + `write` permission | tool executed; real result returned (US2 scenario 1) |
| Destructive tool requested | `confirmation_required`; tool NOT executed (SC-002, US2 scenario 2) |
| Approve pending action before expiry | executes exactly once; replay → `confirmation_invalid` (FR-011) |
| Reject / expired / wrong-caller token | no execution; action invalidated (US2 scenario 4) |
| One source unavailable, request targets a healthy source | healthy request succeeds; no data claimed from the down source (US3, SC-005) |
| Source hangs/timeouts | bounded structured failure within 30s; other sources usable (FR-015) |
| Provider unreachable/rejecting | `llm_unavailable`; no tool executed (US4 scenario 3) |
| Tool selected that is not advertised | `tool_not_found` (edge case) |
| Malformed tool arguments | `tool_validation_failed`; no execution (edge case) |
| Same caller/conversation, two confirmations | both pending; tokens disambiguate (edge case) |

## 5. Provider adapter validation

```bash
pnpm vitest run tests/contract/llm-provider.contract.test.ts
```

Runs the OpenAI-compatible adapter against a fake Hono `/chat/completions` endpoint configured with an
OpenCode Go-style base URL and `deepseek-v4.1-flash`, asserting a standards-compatible request body
with discovered tools and correct `tool_calls` parsing (SC-006, FR-017/FR-018).

## 6. Manual smoke (optional, real services)

Easiest path — generate a token, start the agent, and use the local chat CLI:

```bash
cp .env.example .env   # then set LLM_* and *_MCP_URL
pnpm token:generate -- --caller-id you --permissions read,write,destructive --out secrets/tokens.json
# .env already points AGENT_TOKENS_FILE at secrets/tokens.json
pnpm dev
pnpm chat -- --token "<the token>"
pnpm chat -- --token "<the token>" --once "When is the next bus at my stop?"
```

Raw HTTP equivalent (see `docs/agent.http`):

```bash
curl -s localhost:3400/health -H "Authorization: Bearer $TOKEN"
curl -s localhost:3400/conversation -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"When is the next bus at my stop?"}'
```

Expected: `/health` reports each source; the conversation returns a grounded reply sourced from
module tools. A destructive request returns `confirmation_required` with a token; the chat CLI
prompts for approval, and approving executes once.

## Validation checklist

- [ ] `pnpm format && pnpm lint && pnpm typecheck` pass.
- [ ] `pnpm test` green with no credentials/live services.
- [ ] Read conversation completes through discovery + execution (SC-001).
- [ ] Every destructive execution requires a valid unexpired approval (SC-002).
- [ ] Unknown/unauthorized callers rejected pre-LLM/MCP (SC-003).
- [ ] `/health` reports per-source state within 10s (SC-004).
- [ ] Module outage → bounded failure ≤30s, healthy sources stay usable (SC-005).
- [ ] Provider adapter passes against fake OpenAI-compatible endpoint (SC-006).
- [ ] Log assertions find no secrets/prompts/arguments/locations (SC-007).
- [ ] One managed session per source; procrastinator works without competing sessions (SC-008).
- [ ] Restart does not restore or execute in-memory conversations/confirmations (SC-010).
