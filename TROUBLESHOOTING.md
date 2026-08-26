# Troubleshooting

## Ollama is offline

Run `ollama serve`, confirm `OLLAMA_HOST`, and open `/api/health` and
`/api/health/readiness`. Model listing and chat requests fail with bounded
timeouts rather than waiting indefinitely.

## A file is unavailable

Check `WORKSPACE_DIR` and `ALLOWED_ROOTS`. Mini-O rejects traversal, absolute
paths outside approved roots, and symlink escapes. The file metadata endpoint
reports read-only and encoding information.

## A tool is denied

Open the Tools panel or `/api/tools/policies`. Set the specific tool to
`allow`, approve it for the requested scope, or leave it denied. The activity
endpoint explains the decision without storing secret arguments.

## Browser tests do not run

Install the declared dependencies in `tests/frontend`, then run `npm test`.
Python validation uses `.venv/bin/pytest`; do not rely on globally installed
Python or Node packages.
