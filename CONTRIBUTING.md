# Contributing to Mini-O

## Development setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r tests/requirements-test.txt
```

Run the application locally with:

```bash
.venv/bin/uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

## Before opening a pull request

Run the project checks that apply to your change:

```bash
bash scripts/check.sh
for file in frontend/js/*.js; do node --check "$file"; done
bash scripts/security-check.sh
```

Keep runtime state, credentials, model files, local conversations, and generated
archives out of commits. Changes that expand network access, filesystem access,
or tool execution require a corresponding security review.

## Pull requests

Describe the user-visible behavior, validation performed, and any remaining
limitations. Keep commits focused and avoid mixing generated files with source
changes.

