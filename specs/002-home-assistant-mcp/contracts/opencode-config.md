# Contract: OpenCode MCP Configuration

The repository's `opencode.json` registers the Home Assistant MCP Server so a developer or operator
working in this repository can inspect and call its tools directly. This configuration is a
development aid; the agent runtime is configured independently through environment variables.

## Entry

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "home-assistant": {
      "type": "remote",
      "url": "{env:HOME_ASSISTANT_MCP_URL}",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:HOME_ASSISTANT_TOKEN}"
      }
    }
  }
}
```

The four existing module MCP servers remain in the `mcp` object; this feature adds one entry and does
not remove or rename the others.

## Rules

- `type` MUST be `remote`; Home Assistant speaks Streamable HTTP at `/api/mcp` (FR-014).
- The URL MUST come from `HOME_ASSISTANT_MCP_URL`, defaulting in deployment to the official home
  server endpoint `https://home-assistant.<tailnet>.ts.net/api/mcp` and allowing the local
  `http://localhost:8123/api/mcp`.
- `enabled` MUST be `true` so the tools are available to the session (US4 scenario 1).
- `oauth` MUST be `false`; the server uses a bearer token, not an OAuth flow.
- The credential MUST be interpolated from the environment (`{env:HOME_ASSISTANT_TOKEN}`) and a literal
  token MUST NOT appear anywhere in the file (FR-015, SC-007, constitution V).
- The committed file MUST NOT contain a tailnet hostname or other deployment-specific address.
- If `HOME_ASSISTANT_MCP_URL`/`HOME_ASSISTANT_TOKEN` are unset or Home Assistant is unreachable,
  OpenCode MUST still start and the other MCP servers MUST remain usable (US4 scenario 3).

## Verification

- A contract test reads `opencode.json`, asserts the `home-assistant` entry exists, is `remote`,
  enabled, has `oauth: false`, points at the `/api/mcp` endpoint, and contains no literal token (SC-007).
- Manual verification: with `HOME_ASSISTANT_TOKEN` set, `opencode mcp list` (or a session) shows the
  Home Assistant tools; the tools are callable; a wrong or missing token does not break the other
  servers.
