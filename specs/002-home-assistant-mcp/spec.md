# Feature Specification: Home Assistant MCP Integration

**Feature Branch**: `feature/002-home-assistant-mcp`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "i want now to integrate with home assistant mcp, this both on the opencode config for mcps and the agent integration itself."

## Scope

This feature connects Home Assistant's MCP Server to the Home Sweet Home agent as a fifth managed MCP
source, and registers the same Home Assistant MCP server in the repository's OpenCode MCP
configuration for development and debugging.

It builds on the agent core (feature `001-agent-core`), reusing the existing MCP source management,
tool namespacing, authorization, tool policy, confirmation, health, and redacted-logging behavior.
Home Assistant devices, entities, and automations remain owned by the `home-sweet-home-home-assistant`
repository; this feature only gives the agent a controlled way to read state and request actions.

The Home Assistant **conversation adapter** (Home Assistant calling the agent as its conversation
agent, over the Home Assistant conversation API) is a separate integration and is out of scope here.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Ask About Household Devices (Priority: P1)

As an authenticated household client, I want to ask the agent about my home through natural language
(for example, whether a door is open, what the temperature is, or which lights are on) and receive an
answer grounded in the current Home Assistant state.

**Why this priority**: Reading live household state is the minimum useful Home Assistant capability
and validates the complete path from a client through the agent and LLM to the Home Assistant MCP
source.

**Independent Test**: Run the agent against a fake Home Assistant MCP server that advertises a small
set of query tools, send a read request, and verify that the agent discovers the tool, calls it, and
returns a response grounded in the tool result rather than invented data.

**Acceptance Scenarios**:

1. **Given** the caller is authorized and the Home Assistant MCP source is healthy, **when** the
   caller asks about a device or entity state, **then** the agent invokes the corresponding Home
   Assistant tool and returns the current state.
2. **Given** the Home Assistant MCP source is configured alongside the four module sources, **when**
   the agent starts, **then** it manages one connection to Home Assistant and namespaces its tools so
   they cannot be confused with module tools.
3. **Given** the LLM selects a Home Assistant tool that does not exist or whose arguments are
   invalid, **when** the agent validates the call, **then** it returns a labeled failure and does not
   fabricate a device state.

---

### User Story 2 - Control Devices Safely (Priority: P1)

As an authorized household client, I want the agent to perform household actions through Home
Assistant (for example, turning on a light) while consequential actions (for example, unlocking a
door or disarming an alarm) require my explicit confirmation.

**Why this priority**: Home Assistant exposes actions with real-world consequences. The agent's
existing safety model must apply to Home Assistant actions before any control capability is enabled.

**Independent Test**: Present the agent with a fake Home Assistant MCP that advertises a
benign control action and a consequential one, then verify that the benign action executes for an
authorized caller while the consequential action returns a confirmation request and executes only
after approval.

**Acceptance Scenarios**:

1. **Given** an authorized caller requests a benign household action, **when** the tool is classified
   as a write, **then** the agent executes it and reports the real tool result.
2. **Given** an authorized caller requests a consequential household action, **when** the tool is
   classified as destructive, **then** the agent returns a confirmation request without performing the
   action.
3. **Given** a pending Home Assistant confirmation, **when** the caller approves it before expiry,
   **then** the agent executes exactly the presented action once; **when** the caller rejects it,
   submits an invalid token, or the token has expired, **then** no action is performed.

---

### User Story 3 - Operate Home Assistant as One Reliable Managed Source (Priority: P2)

As a system operator, I want Home Assistant to be a centrally managed MCP source that degrades
gracefully so its availability never breaks the module tools or hangs a request.

**Why this priority**: The agent is the single controlled MCP host; adding a fifth, less predictable
source must not reduce reliability or leak connection handling to clients.

**Independent Test**: Start fakes for the four modules plus Home Assistant, make Home Assistant
unavailable while the others stay healthy, and verify that module requests still succeed and health
reports Home Assistant accurately.

**Acceptance Scenarios**:

1. **Given** Home Assistant is unavailable at startup, **when** the agent starts, **then** the other
   sources connect normally and health reports Home Assistant as unavailable.
2. **Given** Home Assistant becomes unreachable mid-session, **when** a request targets another
   source, **then** that request still succeeds and the response does not claim Home Assistant data.
3. **Given** Home Assistant reconnects, **when** a subsequent request targets it, **then** the agent
   uses the reconnected session within the configured retry and timeout policy.
4. **Given** an operator requests health, **when** Home Assistant is included, **then** the response
   reports its state and a tool count without exposing credentials or entity details.

---

### User Story 4 - Exercise Home Assistant MCP in OpenCode (Priority: P2)

As a developer or operator working in this repository, I want the OpenCode MCP configuration to
include the Home Assistant MCP server, so I can inspect and call its tools directly while building and
debugging the integration.

**Why this priority**: Direct inspection shortens integration work, but it is a development
convenience rather than a runtime capability.

**Independent Test**: Launch OpenCode in this repository with the Home Assistant MCP configured and
verify that the Home Assistant tools are listed and callable with a valid deployment credential, and
that the configuration contains no committed secret.

**Acceptance Scenarios**:

1. **Given** the OpenCode MCP configuration includes Home Assistant, **when** OpenCode starts, **then**
   the Home Assistant MCP server is enabled and its tools are available to the session.
2. **Given** the Home Assistant MCP requires a credential, **when** the configuration is inspected,
   **then** the credential is referenced from a non-committed source rather than embedded in the
   configuration file.
3. **Given** the Home Assistant MCP is unreachable, **when** OpenCode starts, **then** the remaining
   module MCP servers remain usable.

### Edge Cases

- The Home Assistant credential is missing, expired, or rejected by Home Assistant.
- Home Assistant advertises many entities or tools, producing a large tool set or large results.
- A Home Assistant tool name collides with a module tool name after namespacing.
- A Home Assistant action is long-running or exceeds the configured timeout.
- Home Assistant restarts or drops the MCP session mid-request.
- A requested entity or service does not exist, or a service call is missing required parameters.
- A consequential action is requested indirectly through an ambiguous natural-language instruction.
- Home Assistant's MCP transport differs from the transport used by the existing module sources.
- The OpenCode configuration references a credential that is not present in the local environment.
- Two confirmations for different Home Assistant actions exist for the same caller.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The agent MUST support Home Assistant's MCP Server as a configured MCP source alongside
  the existing module sources, through the agent's existing source configuration mechanism.
- **FR-002**: The agent MUST maintain one managed MCP session to the Home Assistant source and MUST
  prevent clients from reaching Home Assistant directly through the agent.
- **FR-003**: The agent MUST discover the tools advertised by the Home Assistant MCP Server and MUST
  namespace them by source so they cannot be selected ambiguously against module tools.
- **FR-004**: The agent MUST authenticate to Home Assistant using a credential supplied only through
  configuration or a deployment secret, and MUST NOT commit that credential to the repository.
- **FR-005**: The agent MUST execute Home Assistant read (state query) tools for callers with read
  permission and MUST return the underlying result or a clearly labeled failure.
- **FR-006**: The agent MUST classify Home Assistant actions into read, write, and destructive
  policies, and MUST treat consequential or security-relevant actions as destructive when they cannot
  be safely classified as read or write.
- **FR-007**: The agent MUST require an explicit, unexpired, single-use confirmation before executing
  a Home Assistant destructive action, and MUST NOT execute it otherwise.
- **FR-008**: The agent MUST reject unknown callers and unauthorized tool categories before invoking
  the LLM or any Home Assistant tool.
- **FR-009**: The agent MUST bound every Home Assistant connection, discovery, and tool call with the
  configured timeout and MUST return a structured failure instead of hanging.
- **FR-010**: The agent MUST mark the Home Assistant source degraded or unavailable on failure, keep
  other sources usable, and apply bounded retries consistent with existing sources.
- **FR-011**: The agent MUST report the Home Assistant source in health output with its state and a
  tool count, without exposing credentials, prompts, or entity details.
- **FR-012**: The agent MUST redact Home Assistant credentials, full tool arguments, prompts, and
  household locations from logs by default, consistent with existing redaction behavior.
- **FR-013**: The agent MUST include Home Assistant tool calls in the existing per-request tool trace
  and audit logging.
- **FR-014**: The repository's OpenCode MCP configuration MUST register the Home Assistant MCP server
  as an enabled source for development use.
- **FR-015**: The OpenCode MCP configuration MUST NOT contain committed Home Assistant credentials.
- **FR-016**: The agent MUST support the transport exposed by the Home Assistant MCP Server, including
  any session or streaming behavior it requires.
- **FR-017**: The agent MUST provide deterministic fake Home Assistant MCP test doubles so all
  behavior can be tested without a live Home Assistant instance or credentials.
- **FR-018**: The agent MUST document the Home Assistant MCP source, its credential handling, and the
  policy applied to its actions.

### Key Entities _(include if feature involves data)_

- **Home Assistant MCP Source**: The configured Home Assistant MCP endpoint, its credential
  reference, transport, connection state, discovered tool set, and health status.
- **Home Assistant Tool Descriptor**: A namespaced Home Assistant MCP tool with source id,
  description, input schema, and read/write/destructive safety classification.
- **Household Action**: A Home Assistant service invocation requested through the agent, with
  associated arguments and either direct execution or a pending confirmation.
- **Home Assistant Credential**: A secret authorizing the agent to the Home Assistant MCP Server,
  supplied only through configuration and never represented in logs or API responses.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A fake-Home-Assistant-MCP integration test completes a read conversation through tool
  discovery, execution, and response generation with no live Home Assistant instance and no
  credentials.
- **SC-002**: 100% of destructive Home Assistant actions in the test suite require a valid, unexpired,
  caller-approved confirmation token before execution.
- **SC-003**: 100% of requests from unknown or unauthorized callers are rejected before any Home
  Assistant tool invocation.
- **SC-004**: When Home Assistant is unavailable, 100% of requests targeting the four module sources
  still succeed and the agent returns a bounded structured failure for Home Assistant within the
  configured timeout.
- **SC-005**: Health output identifies Home Assistant as healthy, degraded, or unavailable within 10
  seconds of the check beginning, without exposing credentials or entity details.
- **SC-006**: Automated log assertions show that Home Assistant credentials, prompts, full tool
  arguments, and household locations are absent from default operational logs.
- **SC-007**: OpenCode started in this repository lists the Home Assistant MCP tools, and the
  committed configuration contains no Home Assistant credential.
- **SC-008**: All Home Assistant source behavior, authorization, policy, confirmation, and failure
  paths are covered by automated tests before the feature is considered complete.

## Assumptions

- Home Assistant exposes a built-in MCP Server reachable on the private deployment network, as deferred
  by feature `001-agent-core`.
- A long-lived credential or equivalent authorization for the Home Assistant MCP Server is available
  to the operator and stored outside Git.
- Home Assistant's device, entity, and automation configuration is owned by the
  `home-sweet-home-home-assistant` repository; this feature does not configure Home Assistant itself.
- The agent's existing namespacing, policy, confirmation, timeout, health, and redaction behavior is
  reused rather than reimplemented.
- Home Assistant tool names and schemas may change between Home Assistant releases and are treated as
  discovered rather than hard-coded.
- The OpenCode MCP configuration is a development aid and is not required for the agent runtime to
  function.
- The Home Assistant conversation adapter and voice pipelines are separate features and are not
  required to validate this feature.

## Out of Scope

- The Home Assistant conversation adapter (Home Assistant calling the agent as its conversation agent).
- Home Assistant device, entity, area, speaker, or automation configuration.
- Voice pipelines, wake words, or speech synthesis.
- Proactive or scheduled Home Assistant notifications.
- Durable storage for conversations, confirmations, or Home Assistant state.
- Public internet exposure of the agent or Home Assistant MCP server.
