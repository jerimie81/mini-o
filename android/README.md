# Mini-O Android Companion

A native Jetpack Compose mobile client for connecting to a Mini-O local AI workspace host from an Android device.

## Core Capabilities

- **Secure Pairing:** Encrypted storage of server profiles and bearer tokens via `EncryptedSharedPreferences` (AES-256 GCM).
- **Multi-Profile Connection:** Save, switch, and test ping latency for home, office, or remote server profiles.
- **AI Chat & Tools:** Real-time streaming chat with model selection (`minimax-m3:cloud`, etc.), thread history persistence, tool execution notifications, response regeneration, and voice input/output.
- **Workspace File Management:** Browse folders, search files, create new files, rename, and delete items with path-traversal protection.
- **File Editor:** Full code and text editing with dirty-state dirty flag tracking, unsaved changes confirmation, and revert capabilities.
- **System Diagnostics:** Monitor host uptime, OS platform info, active connection metrics, and health status.
- **Network Resilience:** Auto-reconnect flow, exponential backoff retries, and offline reachability observer.

## Setup & Execution

Open the `android/` directory in Android Studio and run the `app` configuration. The project targets API 26+ (Android 8.0+).

For a local Wi-Fi connection, configure the server `.env`:

```dotenv
MINI_O_HOST=0.0.0.0
REMOTE_AUTH_TOKEN=your-secure-random-token
ALLOWED_HOSTS=["192.168.1.50","10.0.2.2","localhost"]
```

## Security & Architecture

- **Encrypted Storage:** All credentials and server tokens are saved in Android Keystore backed `EncryptedSharedPreferences`.
- **Window Protection:** `FLAG_SECURE` is enabled on connection screens to prevent screenshot leaks of auth tokens.
- **Path Sanitization:** Client-side traversal checks prevent relative path traversal (`..`).
- **Architecture:** `MiniOMainApp` -> `MiniOViewModel` -> `MiniORepository` -> `MiniOApiClient` / `ConnectionStore` / `ChatStorage`.
