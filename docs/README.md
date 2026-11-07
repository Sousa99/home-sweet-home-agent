# Agent Documentation

- `http-contract.md` — the agent HTTP API, error codes, tool policy, Home Assistant MCP source, auth
  model, and provider setup.
- `deployment.md` — the image, publish tag format, probes, environment, and required Secrets consumed
  by `home-sweet-lab`.
- `agent.http` — runnable REST-client requests for every endpoint.

Home Assistant is integrated as a fifth managed MCP source (see `http-contract.md`). The Home
Assistant conversation adapter, notification dispatch, and deployment topology are documented here as
those later features land.
