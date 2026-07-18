---
name: sandbox
description: Creates isolated Linux environments using E2B Sandbox SDK.
metadata:
  provider: E2B
  version: "1.0"
---

# E2B Sandbox Guidance

Use the `e2b` package and `E2B_API_KEY` for sandbox lifecycle operations.

- Persist `sandbox.sandboxId` per workspace; reconnect with `Sandbox.connect()`.
- Create workspaces from `E2B_TEMPLATE_ID` or the `base` template.
- Set `lifecycle.onTimeout` to `pause` so files and process state can resume.
- Use `sandbox.pause()` for a reversible stop and `sandbox.kill()` only for permanent deletion.
- Use `sandbox.commands.run()` for commands, `sandbox.files` for filesystem operations, and `sandbox.getHost(port)` for sandbox services.
- Keep the sandbox server protocol (`/health`, `/stream`, `/approve`) authenticated with the application-owned bearer token.
- Configure a custom E2B template with Node.js and the Claude Agent SDK for production cold-start performance.
- Do not reintroduce the retired provider's SDK, credentials, snapshot APIs, or provider-specific sandbox paths.
