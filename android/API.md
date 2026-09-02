# Mini-O REST & SSE API Contract

Version: 1.0.0

## Authentication
Requests to all `/api/*` endpoints support an optional Bearer Token header:
```
Authorization: Bearer <TOKEN>
```

---

## 1. Health & Platform Endpoints

### GET `/api/health`
Returns the server status and uptime metrics.

**Response (200 OK):**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "platform": "linux",
  "host": "my-pc",
  "uptime": 14205.2
}
```

### GET `/api/platform`
Returns detailed platform host information.

**Response (200 OK):**
```json
{
  "platform": "linux",
  "arch": "x64",
  "nodeVersion": "v20.11.0",
  "isWindows": false,
  "isLinux": true,
  "isDarwin": false,
  "workspaceDir": "/home/user/workspace"
}
```

### GET `/api/diagnostics`
Returns system activity and error log counts.

**Response (200 OK):**
```json
{
  "version": "1.0.0",
  "uptime": 14205.2,
  "workspaceDir": "/home/user/workspace",
  "logCount": 42,
  "errorCount": 0,
  "activeConnections": 1
}
```

### GET `/api/models`
Lists available AI models.

**Response (200 OK):**
```json
[
  {
    "name": "minimax-m3:cloud",
    "size": 7000000000,
    "parameterSize": "7B",
    "family": "llama"
  }
]
```

---

## 2. Workspace File Endpoints

### GET `/api/files`
Query parameters: `path` (relative directory), `q` (filter query).

**Response (200 OK):**
```json
[
  {
    "name": "AGENT.md",
    "path": "AGENT.md",
    "isDirectory": false,
    "size": 1024,
    "modified": 1725280000.0
  }
]
```

### GET `/api/files/content`
Query parameter: `path` (file path).

**Response (200 OK):**
```json
{
  "content": "# Workspace Rules",
  "modified": 1725280000.0,
  "size": 1024,
  "path": "AGENT.md"
}
```

### POST `/api/files/content`
Payload:
```json
{
  "path": "test.txt",
  "content": "Hello World",
  "expected_modified": 1725280000.0
}
```

### POST `/api/files/operation`
Payload:
```json
{
  "operation": "rename", // or "delete"
  "path": "old.txt",
  "target": "new.txt"
}
```

---

## 3. Streaming Chat SSE Endpoint

### POST `/api/chat`
Payload:
```json
{
  "model": "minimax-m3:cloud",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "conversationId": "thread-123",
  "useTools": true
}
```

**SSE Events:**
- `data: {"type": "token", "data": "Hello"}`
- `data: {"type": "tool_call", "name": "read_file", "data": "path=..."}`
- `data: {"type": "tool_result", "name": "read_file", "data": "content..."}`
- `data: {"type": "done"}`
