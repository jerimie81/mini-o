# Performance budgets and profiling checklist

The local development budgets are intentionally modest and repeatable:

| Measurement | Budget |
| --- | ---: |
| Python import/startup | 2 seconds |
| API metadata request | 250 ms without Ollama |
| First visible stream event | provider-dependent; record separately |
| Composer interaction | 16 ms frame budget |
| Conversation list render | 100 ms for 200 records |

Run `scripts/benchmark.py` for a local storage/API baseline. Record hardware,
Python version, model, and whether Ollama is warm. Treat network/model latency
as separate from Mini-O UI and storage latency.
