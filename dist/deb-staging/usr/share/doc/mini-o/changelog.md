# Changelog

## Unreleased

- Added structured tool risk metadata, per-tool policies, approval events, and
  redacted local activity records.
- Added request correlation IDs, bounded request bodies, opt-in bearer auth,
  readiness, metrics, diagnostics, network-policy, plugin, and capability APIs.
- Added workspace search previews and research source export contracts.
- Added threat model, security checklist, and reproducible CI commands.

## 0.1.0

- Added the production-preview WebUI workspace, configuration, tool policy, and
  Integrations surfaces.
- Added MCP JSON-RPC initialization, capability negotiation, tools/resources,
  context envelopes, HTTP/stdio transports, and client targets for CLI, VS Code,
  JetBrains, and Android Studio.
- Added release-scope documentation and regression coverage for the MCP and
  plugin foundations.
- Hardened policy persistence so updating one tool cannot discard other
  configured policies, and capped client context envelopes at the advertised
  server limit.

## 1.0.0

- Initial local-first Mini-O WebUI release line.

Release tags use semantic versioning (`vMAJOR.MINOR.PATCH`). Add a matching
changelog heading before running `scripts/release.sh`.
