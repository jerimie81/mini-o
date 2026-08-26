# Platform launch notes

## Linux

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## macOS

Use the same commands in Terminal. Install Ollama for macOS, run `ollama serve`
if it is not started by the desktop application, and keep Mini-O bound to
`127.0.0.1`.

## Windows PowerShell

```powershell
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Use Windows paths in `WORKSPACE_DIR` and `ALLOWED_ROOTS`; do not grant a whole
profile or drive unless the tool policy has been reviewed.
