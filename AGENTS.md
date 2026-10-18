# Agent Repository Guidance

This repository implements the centralized Home Sweet Home MCP host and conversation gateway.

## Rules

- Read `.specify/memory/constitution.md` before making changes.
- Follow test-first development for all behavior changes.
- Keep module MCP endpoints private and credentials outside Git.
- Treat all LLM output as untrusted intent; validate tool names and arguments.
- Require confirmation for destructive or consequential operations.
- Redact prompts, tool arguments, tokens, phone identifiers, and household locations from logs.
- Keep Home Assistant device and automation configuration in `home-sweet-home-home-assistant`.
- Keep dashboard UI and module implementation changes in their owning repositories.

## Change workflow

1. Define or update the service/MCP contract.
2. Write a failing unit, contract, or integration test.
3. Implement the smallest safe change.
4. Test success, timeout, unavailable-service, malformed-tool, and authorization failures.
5. Run formatting, linting, typechecking, and the full test suite.

## Boundary rule

Home Assistant and text clients call the agent. They should not each implement their own MCP client,
LLM prompt, permission model, or confirmation workflow.
