# Upgrading Mini-O

Conversation records use a versioned portable export format:
`mini-o.conversations` version 1. Export before upgrades when changing the
workspace or storage location. Preferences remain browser-local and can be
backed up through the browser profile. Never copy the `store/` or `data/`
directories between trust boundaries without reviewing their contents.

The API keeps `/api` as the compatibility path and exposes the versioned
contract under `/api/v1`; clients should send and record `x-correlation-id` for
supportable stream diagnostics.
