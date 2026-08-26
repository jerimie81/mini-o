# Release checklist

## Required evidence

- [ ] `.venv/bin/pytest -q -c tests/pytest.ini` passes.
- [ ] Frontend Vitest passes from local `node_modules`.
- [ ] Python compilation, JavaScript syntax, contrast, and security checks pass.
- [ ] Threat model, configuration reference, migration note, and changelog are current.
- [ ] No credentials, workspace data, generated stores, or model files are in the artifact.
- [ ] API version/correlation behavior and backup/restore paths are reviewed.
- [ ] Manual first-run, chat, model, file-edit, tool-denial, and offline workflows are exercised.

## Go/no-go rules

Do not release when a security test fails, an unbounded remote operation exists,
or a checked roadmap item lacks implementation and test evidence. External
identity providers, usability studies, and production artifact signing remain
release inputs rather than local code claims.
