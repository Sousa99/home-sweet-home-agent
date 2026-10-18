# Home Sweet Home — Agent Constitution

## Core Principles

### I. One Controlled MCP Host

The agent is the production MCP host for Home Sweet Home clients. It MUST manage persistent module
MCP sessions centrally and MUST prevent clients from bypassing its authorization and safety policy.

### II. Explicit Authorization

Every request MUST resolve to an authenticated household identity and an explicit permission set.
Unknown clients MUST be rejected. Read and write capabilities MUST be independently configurable.

### III. Safe Tool Execution

Destructive or consequential actions MUST require explicit confirmation unless a documented,
independently verified policy permits automatic execution. The agent MUST report the confirmed result
from the underlying tool and MUST NOT claim success on a failed or unavailable call.

### IV. Provider-Agnostic Intelligence

The agent MUST not be coupled to one LLM provider. Local and cloud providers SHOULD be selectable by
configuration. Cloud inference, telemetry, and prompt data egress MUST be opt-in and documented.

### V. Private by Default

MCP endpoints, agent APIs, credentials, prompts, tool arguments, and household data MUST remain on
private networks unless an authenticated encrypted boundary is explicitly configured. Logs MUST use
redaction by default.

### VI. Contract-First Integration

The MCP client contract, agent HTTP contract, Home Assistant adapter, and notification contract MUST
have automated tests. Changes to module tool names, schemas, transport, or session behavior require
contract and integration test updates.

### VII. Test-First Development

Behavior changes MUST begin with a failing test, followed by the smallest implementation and a green
verification run. Unit, contract, integration, and failure-path tests are required according to risk.

## Technology Standards

- Node.js and TypeScript are the default implementation stack.
- The official MCP TypeScript SDK SHOULD be used for MCP client behavior.
- The service MUST support the module servers' streamable HTTP transport.
- HTTP APIs MUST define request, response, authentication, timeout, and error contracts.
- Sessions MUST handle retries, timeouts, unavailable modules, and the procrastinator MCP's
  single-session constraint.
- Secrets MUST be supplied through environment variables or a deployment secret manager.

## Repository Boundaries

- `home-sweet-home-dashboard` owns the TV dashboard and dashboard-specific deployment.
- `home-sweet-home-modules` owns module implementations and published backends.
- `home-sweet-home-home-assistant` owns devices, voice surfaces, speakers, automations, and
  household notification presentation.
- This repository owns centralized MCP access, LLM behavior, authorization, confirmations, and
  client adapters.

## Governance

This constitution governs the agent repository. Material amendments require documentation of the
security, privacy, or operational impact, migration steps, and explicit approval before implementation.
