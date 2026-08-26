# Security checklist

Before exposing Mini-O beyond localhost:

1. Set a strong `REMOTE_AUTH_TOKEN` and restrict `CORS_ORIGINS`.
2. Keep `ALLOWED_ROOTS` narrow and never point it at a home directory.
3. Leave confirmation-required tools in `confirm` or `deny` mode.
4. Review `/api/tools/activity`, `/api/diagnostics`, and request correlation IDs.
5. Keep Ollama on a protected interface and use a firewall/reverse proxy.
6. Do not place credentials in `.env` committed files, workspace files, prompts,
   `AGENT.md`, or diagnostic bundles.
7. Run the security and path traversal tests before every release.

Report security issues privately to the project owner; do not include secrets,
conversation contents, or private workspace files in reports.
