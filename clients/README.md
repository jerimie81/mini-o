# Mini-O MCP clients

All clients use the same MCP JSON-RPC contract at `/api/mcp` or the local
stdio transport (`python -m backend.mcp_stdio`). They must initialize before
calling tools or resources and must preserve Mini-O's server-side policy,
approval, workspace, and redaction boundaries.

- `cli/mini_o_mcp.py` — dependency-free working CLI for initialize, tools,
  resources, calls, and context submission.
- `vscode/` — installable VS Code extension source with tool listing and
  selection-context commands.
- `jetbrains/` — JetBrains client library ready to wire into an IntelliJ
  Platform action.
- `android-studio/` — Android Studio client library ready to wire into an
  IntelliJ Platform action.

The JetBrains and Android Studio directories are host-plugin client slices,
not yet signed marketplace distributions. Their next required work is host
UI wiring, consent prompts, JSON parsing/error handling, reconnect behavior,
and integration tests.
