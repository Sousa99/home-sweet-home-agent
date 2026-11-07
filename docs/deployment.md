# Agent deployment contract

This document is the contract `home-sweet-lab` consumes to deploy the agent. It is owned here; the
Kubernetes manifests, Flux resources, and Secrets are owned by `home-sweet-lab`.

## Image

| Item | Value |
| ---- | ----- |
| Registry | `ghcr.io/sousa99/home-sweet-home-agent` |
| Tag format | `main-YYYYMMDDHHMMSS-<7-char-sha>` |
| Publisher | `.github/workflows/publish-agent.yml` on pushes to `main` |
| Port | `3400/tcp` |
| User | `node` (uid/gid `1000`), non-root |
| Root filesystem | No runtime writes; read-only root filesystem is supported |
| Dev dependencies | Not present in the runtime image |

The GHCR package can be made public (matching the other lab images) or pulled with a
`kubernetes.io/dockerconfigjson` Secret referenced as `imagePullSecrets`. The token is never committed.

## Probes

The agent exposes two unauthenticated probe endpoints. See `docs/http-contract.md` for payloads.

| Path | Type | Success | Failure |
| ---- | ---- | ------- | ------- |
| `/healthz` | liveness | `200` while the process is alive | process not running |
| `/readyz` | readiness | `200` when the provider is ready and not draining | `503` when not ready or draining |

Probes perform no network I/O. They are safe for a 5–10 second period.

## Environment

All variables are read from the process environment at startup. Secrets must come from a Kubernetes
Secret; non-secret values may come from a ConfigMap.

### Non-secret configuration

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `NODE_ENV` | unset | Set to `production` in the cluster. Enables fail-fast auth validation. |
| `AGENT_HOST` | `127.0.0.1` | Must be `0.0.0.0` in a container. |
| `AGENT_PORT` | `3400` | Container listens here. |
| `BUS_MCP_URL` | `http://localhost:3200/mcp` | Use the in-cluster Service in Kubernetes. |
| `FLIGHTS_MCP_URL` | `http://localhost:3201/mcp` | Use the in-cluster Service in Kubernetes. |
| `TASKS_MCP_URL` | `http://localhost:3202/mcp` | Use the in-cluster Service in Kubernetes. |
| `WEATHER_MCP_URL` | `http://localhost:3203/mcp` | Use the in-cluster Service in Kubernetes. |
| `HOME_ASSISTANT_MCP_URL` | `http://localhost:8123/api/mcp` | Use the in-cluster Service in Kubernetes. |
| `MCP_TIMEOUT_MS` | `10000` | Per-call MCP timeout. |
| `LLM_PROVIDER` | `openai-compatible` | Only supported provider. |
| `LLM_BASE_URL` | `https://opencode.ai/inference/go/openai/v1` | OpenAI-compatible endpoint. |
| `LLM_MODEL` | `deepseek-v4.1-flash` | Model name. |
| `LLM_TIMEOUT_MS` | `30000` | Per-request LLM timeout. |
| `CONFIRMATION_TTL_MS` | `120000` | Confirmation token lifetime. |
| `AGENT_MAX_TOOL_ITERATIONS` | `4` | Bounds the tool loop. |
| `AGENT_MAX_TOOL_RESULT_CHARS` | `8000` | Caps tool output returned to the model. |
| `AGENT_UNKNOWN_TOOL_POLICY` | `destructive` | Policy for unclassified tools. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `LOG_REDACT` | `true` | Keep enabled outside development. |

In-cluster examples:

```text
BUS_MCP_URL=http://bus-catcher-mcp.dashboard.svc.cluster.local:3001/mcp
FLIGHTS_MCP_URL=http://fly-over-tracker-mcp.dashboard.svc.cluster.local:3001/mcp
TASKS_MCP_URL=http://procrastinator-tracker-mcp.dashboard.svc.cluster.local:3001/mcp
WEATHER_MCP_URL=http://weather-psychic-mcp.dashboard.svc.cluster.local:3001/mcp
HOME_ASSISTANT_MCP_URL=http://home-assistant.home-assistant.svc.cluster.local:8123/api/mcp
AGENT_HOST=0.0.0.0
```

### Required Secrets

| Secret | Keys | Purpose |
| ------ | ---- | ------- |
| Agent auth tokens | `AGENT_AUTH_TOKENS` (inline JSON) or a mounted `tokens.json` read through `AGENT_TOKENS_FILE` | Authenticates every caller. Contains only SHA-256 hashes of bearer tokens. |
| LLM credential | `LLM_API_KEY` | Set on the configured provider. Required for remote endpoints. |
| Home Assistant | `HOME_ASSISTANT_MCP_TOKEN` | Home Assistant long-lived access token for the MCP source. Leave unset to report the source `unavailable`. |
| Registry pull (optional) | `.dockerconfigjson` | Only if the GHCR package is private. |

Generate the auth token map outside the cluster and place only the hash map in the Secret:

```bash
pnpm token:generate -- --caller-id home-assistant --permissions read,write,destructive --out tokens.json
```

The plaintext bearer token is handed to the caller (for example the Home Assistant adapter). The
cluster stores only the hash. Never commit the token file or paste credentials into manifests.

`NODE_ENV=production` with an empty token map fails startup with an error naming
`AGENT_AUTH_TOKENS`; no secret value is printed.

## Authentication boundary

`/healthz` and `/readyz` are unauthenticated. Every other endpoint requires
`Authorization: Bearer <token>`; unknown callers are rejected with `401`.

## Shutdown

On `SIGTERM` or `SIGINT` the agent marks itself not ready, stops accepting connections, closes MCP
sessions, and bounds forced connection closure to five seconds. Set
`terminationGracePeriodSeconds` above that window.

## Local verification

```bash
docker build -t hsh-agent:local .
docker run --rm --network host -e NODE_ENV=development hsh-agent:local
curl -fsS http://127.0.0.1:3400/healthz
curl -fsS http://127.0.0.1:3400/readyz
```

`/health` remains authenticated and returns the detailed source and provider report.
