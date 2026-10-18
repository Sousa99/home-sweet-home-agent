# Feature Specification: Centralized MCP Agent Core

**Feature Branch**: `feature/001-agent-core`
**Created**: 2026-10-18
**Status**: Draft
**Input**: User description: "Build the centralized Home Sweet Home agent that can receive requests, use the module MCP servers, and later integrate with Home Assistant as a fifth MCP source and voice surface. Use a configurable LLM, ideally OpenCode Go with a cheap DeepSeek model."

## Scope

This feature establishes the standalone agent core in `home-sweet-home-agent`. It receives an
authenticated request, uses the four existing Home Sweet Home module MCP servers as tools, and
returns a grounded response. It is the single production owner of module MCP sessions.

Home Assistant integration is intentionally prepared but not implemented in this feature. A later
feature will connect Home Assistant's built-in MCP Server as a fifth MCP source and add the
Home Assistant conversation adapter. Text transports, proactive scheduling, and persistent storage
are also later features.

## User Scenarios & Testing

### User Story 1 - Ask About Home Sweet Home Data (Priority: P1)

As an authenticated household client, I want to ask a natural-language question about buses,
flights, weather, or tasks and receive an answer grounded in the current module data.

**Why this priority**: This is the minimum useful agent capability and validates the complete path
from an external client through the LLM and MCP servers.

**Independent Test**: Send a request to `/conversation` using a fake LLM and fake MCP server, then
verify that the agent discovers the appropriate tool, executes it, and returns a response containing
the tool result.

**Acceptance Scenarios**:

1. **Given** the caller is authorized and the bus MCP is healthy, **when** the caller asks for the
   next bus at a configured stop, **then** the agent invokes the bus tool and returns the current
   departure information.
2. **Given** the caller is authorized and the LLM selects a weather or flight tool, **when** the tool
   returns successfully, **then** the response identifies the result as coming from the corresponding
   module rather than inventing unavailable data.
3. **Given** the LLM does not select a tool, **when** the request is answerable without module data,
   **then** the agent returns the model response without executing an MCP tool.

---

### User Story 2 - Perform a Confirmed Household Change (Priority: P1)

As an authorized household client, I want the agent to create or update a task while preventing
accidental destructive actions.

**Why this priority**: The module MCPs include write operations. A useful agent must support writes,
but household data must not be changed solely because an ambiguous model response suggested it.

**Independent Test**: Use a fake LLM that requests a write and a destructive tool, verify that the
write policy allows the appropriate action, destructive execution pauses for confirmation, and only
an approved non-expired confirmation executes the tool.

**Acceptance Scenarios**:

1. **Given** an authorized caller requests creation of a task, **when** the LLM produces valid tool
   arguments, **then** the agent executes the task creation and reports the confirmed tool result.
2. **Given** an authorized caller requests deletion or completion of a task, **when** the tool policy
   classifies the operation as destructive, **then** the agent returns a confirmation request without
   executing the tool.
3. **Given** a pending confirmation, **when** the caller approves it before expiry, **then** the
   agent executes exactly the presented tool and arguments once.
4. **Given** a pending confirmation, **when** the caller rejects it, submits an invalid token, or
   submits it after expiry, **then** the tool is not executed and the pending action is invalidated.

---

### User Story 3 - Operate Through One Reliable MCP Host (Priority: P1)

As a system operator, I want one agent process to own the module MCP connections so clients do not
compete for sessions or need to know individual module endpoints.

**Why this priority**: The procrastinator MCP is single-session, and central ownership is the reason
for this repository. It also gives every future client the same permissions and safety behavior.

**Independent Test**: Start fake streamable HTTP MCP servers for all four modules, connect one agent,
restart one fake server, and verify that the other sources remain usable while health reports the
failed source accurately.

**Acceptance Scenarios**:

1. **Given** all configured MCP sources are available, **when** the agent starts, **then** it creates
   one managed connection per source and discovers namespaced tools.
2. **Given** one MCP source is unavailable, **when** a request targets another healthy source, **then**
   the healthy request still works and the response does not claim data from the unavailable source.
3. **Given** an MCP connection times out or disconnects, **when** the agent retries according to its
   policy, **then** the agent reports a bounded failure and does not hang the HTTP request indefinitely.
4. **Given** the agent exposes health, **when** an operator requests `GET /health`, **then** the
   response reports overall status, each MCP source, and LLM provider readiness.

---

### User Story 4 - Use a Configurable, Affordable LLM Provider (Priority: P2)

As an operator, I want to select the LLM provider and model through deployment configuration so I
can use OpenCode Go with DeepSeek V4.1 Flash, a free OpenCode model, Ollama, or another compatible
provider without changing agent code.

**Why this priority**: Model cost, availability, privacy, and tool-calling quality may change. The
agent must not be coupled to one provider.

**Independent Test**: Run the same conversation-loop tests against a fake provider and an
OpenAI-compatible provider configured with a test endpoint, verifying that base URL, model, and key
are supplied through configuration.

**Acceptance Scenarios**:

1. **Given** an OpenAI-compatible base URL, model id, and API key are configured, **when** the agent
   handles a request, **then** it sends a standards-compatible chat-completions request with the
   discovered tools.
2. **Given** the provider is configured for OpenCode Go, **when** the agent starts, **then** it uses
   the configured Go endpoint and model without requiring OpenCode to run as a separate process.
3. **Given** the provider is unavailable or rejects a request, **when** a caller submits a request,
   **then** the agent returns a clear unavailable response and does not execute an unrequested tool.

---

### User Story 5 - Inspect Safe Operational Behavior (Priority: P2)

As an operator, I want the agent's contracts and failure behavior to be testable without using a
real LLM or modifying household data.

**Why this priority**: The agent handles private household information and can perform writes. A
deterministic test harness is required before connecting Home Assistant or an external chat surface.

**Independent Test**: Run the unit, HTTP contract, and fake-MCP integration suites with no external
credentials or live services.

**Acceptance Scenarios**:

1. **Given** no provider or module credentials are present, **when** the test suite runs, **then** it
   can validate the conversation, policy, confirmation, and error contracts using fakes.
2. **Given** a request includes credentials, prompts, tool arguments, or household locations, **when**
   the agent logs an event, **then** the sensitive values are redacted by default.
3. **Given** an unknown caller or invalid bearer token submits a request, **when** the agent receives
   it, **then** it rejects the request before invoking the LLM or any MCP tool.

### Edge Cases

- The LLM requests a tool that is not currently advertised by any connected MCP source.
- The LLM supplies malformed arguments or arguments that do not satisfy the tool schema.
- Two confirmation requests exist for the same caller and conversation.
- A confirmation token is replayed after a successful execution.
- An MCP tool returns an error, malformed output, or a result too large for the configured context.
- The LLM emits text and a tool call in the same response.
- The caller disconnects while a tool call is running.
- The caller asks for information from a module that is offline.
- The OpenCode Go subscription or model quota is exhausted.
- The configured LLM provider is cloud-hosted while the request contains sensitive household data.
- The process restarts while in-memory conversations or pending confirmations exist.
- A module exposes tools with names that collide with another module.

## Requirements

### Functional Requirements

- **FR-001**: The agent MUST expose a documented `POST /conversation` endpoint for authenticated
  callers.
- **FR-002**: The conversation endpoint MUST accept a caller identity, request text, and optional
  conversation identifier, and MUST return either a response or a structured confirmation request.
- **FR-003**: The agent MUST connect to each configured module MCP server using streamable HTTP and
  MUST discover its available tools.
- **FR-004**: The agent MUST maintain one managed MCP client session per configured module source and
  MUST prevent downstream clients from connecting directly through the agent.
- **FR-005**: The agent MUST namespace discovered tools by module so tools with identical names cannot
  be selected ambiguously.
- **FR-006**: The agent MUST validate every model-selected tool name and argument object against the
  currently discovered tool schema before execution.
- **FR-007**: The agent MUST execute read tools for authorized callers and MUST return the underlying
  tool result or a clearly labeled failure.
- **FR-008**: The agent MUST classify tool operations into read, write, and destructive policies.
- **FR-009**: The agent MUST require explicit confirmation before executing destructive operations.
- **FR-010**: The agent MUST expose `POST /confirm` to approve or reject a pending action, and MUST
  expire and invalidate pending confirmation tokens after a configured short duration.
- **FR-011**: The agent MUST execute an approved pending action at most once.
- **FR-012**: The agent MUST authenticate HTTP requests with a configured bearer-token mechanism and
  MUST map authenticated callers to explicit permissions.
- **FR-013**: The agent MUST reject unknown callers and unauthorized tool categories before invoking
  the LLM or any MCP tool.
- **FR-014**: The agent MUST expose `GET /health` with overall status, per-MCP status, and LLM
  provider readiness.
- **FR-015**: The agent MUST bound MCP and LLM request duration with configured timeouts and MUST
  return structured errors for timeout, unavailable, unauthorized, malformed, and provider failures.
- **FR-016**: The agent MUST expose a documented `POST /notifications` contract for a later
  Home Assistant notification adapter, but this feature MUST NOT implement event scheduling.
- **FR-017**: The agent MUST support an OpenAI-compatible LLM provider configured with a base URL,
  model id, and API key.
- **FR-018**: The default deployment example SHOULD support OpenCode Go's
  `https://opencode.ai/inference/go/openai/v1` endpoint with `deepseek-v4.1-flash`, while allowing the
  OpenCode free model and local Ollama through configuration.
- **FR-019**: The agent MUST keep conversation and pending-confirmation state in memory for this
  feature and MUST document that state is lost on restart.
- **FR-020**: The agent MUST redact credentials, prompts, full tool arguments, private identifiers,
  and household locations from logs by default.
- **FR-021**: The agent MUST provide deterministic fake LLM and fake MCP test doubles so the required
  behavior can be tested without external services or credentials.
- **FR-022**: The agent MUST document that OpenCode Go and other cloud providers are opt-in data
  egress paths and MUST document the provider's retention/privacy assumptions.
- **FR-023**: The agent MUST return a per-request tool trace (namespaced tool name, source id, policy,
  outcome, duration) from `POST /conversation` and `POST /confirm`, and MUST emit one `info`-level
  audit event per tool call, without including prompts, tool arguments, tokens, or household
  locations.

### HTTP Contract

- `POST /conversation` MUST return a stable conversation identifier and one of `completed`,
  `confirmation_required`, or a structured failure status.
- `POST /confirm` MUST accept a confirmation token and an explicit approve/reject decision.
- `POST /notifications` MUST validate an event type and payload, even if the initial implementation
  only acknowledges or records the event for a future adapter.
- `GET /health` MUST be safe to call without exposing credentials, prompts, or tool arguments.
- All error responses MUST include a stable machine-readable code and a safe human-readable message.

### Key Entities

- **MCP Source**: A configured module endpoint with a stable source id, connection state, tool set,
  timeout policy, and health status.
- **Tool Descriptor**: A namespaced MCP tool name, source id, description, input schema, and safety
  classification.
- **Conversation**: An in-memory interaction identified by caller and conversation id, containing the
  current request lifecycle and bounded context.
- **Caller Identity**: An authenticated client identity mapped to read/write/destructive permissions.
- **Pending Confirmation**: A short-lived, single-use token bound to one caller, conversation, tool,
  and exact validated arguments.
- **LLM Provider Configuration**: Provider kind, base URL, model id, timeout, and secret reference;
  secrets are never represented in logs or API responses.
- **Notification Event**: A validated future outbound event with type, severity, payload, and target
  adapter metadata.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A fake-MCP/fake-LLM integration test completes a read-only conversation through tool
  discovery, tool execution, and response generation with no external credentials.
- **SC-002**: 100% of destructive tool executions in the test suite require a valid, unexpired,
  caller-approved confirmation token.
- **SC-003**: 100% of requests from unknown or unauthorized callers are rejected before any LLM or MCP
  invocation.
- **SC-004**: `GET /health` identifies each configured MCP source as healthy, degraded, or unavailable
  within 10 seconds of the check beginning.
- **SC-005**: A module timeout or outage returns a bounded structured failure within 30 seconds and
  leaves unrelated healthy module tools usable.
- **SC-006**: The same provider adapter test passes against a fake OpenAI-compatible endpoint with
  OpenCode Go-style base URL and model configuration.
- **SC-007**: Automated log assertions show that credentials, prompts, full tool arguments, and
  household locations are absent from default operational logs.
- **SC-008**: The agent can maintain one active MCP session for each of the four module sources and
  can use the procrastinator source without opening competing client sessions.
- **SC-009**: All HTTP contracts, authorization rules, confirmation behavior, tool policy, and failure
  paths are covered by automated tests before the feature is considered complete.
- **SC-010**: Restart behavior is documented and tests confirm that in-memory conversations and
  pending confirmations are not falsely restored or executed after restart.

## Assumptions

- The four module MCP servers already expose streamable HTTP endpoints and stable tool schemas.
- The agent and module MCP servers run on a private home network or private deployment network.
- Home Assistant will later expose its built-in MCP Server as a fifth MCP source; that integration is
  not part of this feature.
- Home Assistant will later call the agent through a custom conversation integration owned by the
  Home Assistant repository.
- A household operator can provide an OpenCode API key or configure another compatible provider.
- OpenCode Go's model availability, quotas, pricing, and endpoint behavior may change and must not be
  treated as an immutable application contract.
- In-memory state is acceptable for the first feature because persistence and restart recovery are
  explicitly deferred.
- External text and voice adapters are not required to validate the agent core.

## Out of Scope

- Home Assistant device discovery, automations, speakers, or voice pipelines.
- Home Assistant MCP Server configuration and entity exposure.
- The Home Assistant custom conversation integration.
- Telegram, WhatsApp, Signal, PWA, or other client adapters.
- Proactive event scheduling and recurring notification triggers.
- Durable conversation, user, or confirmation storage.
- Public internet exposure, account signup, or household multi-tenant support.
