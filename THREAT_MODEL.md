# Mini-O threat model

## Boundaries

The browser is untrusted input, FastAPI owns authorization and persistence,
the configured workspace is a filesystem boundary, Ollama is a local model
provider, and tools are privileged capabilities. `web_fetch` is the only
intentional outbound network boundary.

## Main threats and controls

| Threat | Control |
| --- | --- |
| Path traversal or symlink escape | `safe_resolve()` checks resolved paths against approved roots. |
| Unsafe model-generated tool execution | Per-tool policy, risk metadata, explicit approval, and activity events. |
| SSRF/private-network access | URL scheme validation, DNS address checks, blocked private/reserved ranges, bounded response size. |
| Browser/API request abuse | Opt-in bearer authentication, request-size limit, correlation IDs, `nosniff` response header. |
| Secret disclosure in diagnostics | Redaction of token/password/key-like fields and message content exclusion. |
| Stale editor overwrite | Optional modification timestamp precondition on writes. |

Mini-O remains intended for trusted local operation by default. Remote use must
enable authentication, restrict hosts/origins, review tool policies, and place
the service behind a separately hardened reverse proxy.
