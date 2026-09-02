# Mini-O Android — Path to Production-Grade

Reviewed against the current `android/app/src/main/java/com/minio/mobile` tree
(MainActivity, MiniOViewModel, MiniOApiClient, VoiceAssistantManager,
ChatScreen, WorkspaceScreen, ConnectScreen, DiagnosticsScreen,
FileEditorScreen, SettingsScreen, Theme, Models, build.gradle.kts).

Current state: solid Compose skeleton, working chat/voice/file flows against
a single hardcoded server. Not yet a shippable product — no persistence, no
reconnect/retry, light theme is defined but dead code, no tests, no release
build config, no error/empty-state coverage, README claims "no file upload,
remote shell" but `performFileOperation`/`saveFileContent` already allow
write+delete, so docs and scope are out of sync with the code.

---

## 1. Architecture & Testability

1. [x] Extract an `ApiClient` interface from `MiniOApiClient` so the ViewModel depends on an abstraction, not a concrete OkHttp class.
2. Introduce a `Repository` layer between `MiniOViewModel` and `MiniOApiClient` to isolate networking from UI state.
3. Add a DI graph (Hilt or manual factory) instead of `viewModel()` default construction — `MiniOViewModel` currently can't be unit-tested without a real network.
4. Move `EncryptedSharedPreferences` connection storage out of `MainActivity`/`MiniOMainApp` composable into a dedicated `ConnectionStore` class.
5. Split `MiniOViewModel` (currently one 400-line god-object covering connection, chat, files, editor) into `ChatViewModel`, `WorkspaceViewModel`, `ConnectionViewModel` sharing a scoped store.
6. [x] Replace raw `JSONObject`/`JSONArray` parsing in `MiniOApiClient` with `kotlinx.serialization` or Moshi data classes to remove manual `optString`/`optDouble` boilerplate and silent type-coercion bugs.
7. Add sealed-class `ApiError` types (network, auth, server, parse) instead of stringly-typed `Exception(message)` — screens currently just show raw exception text.
8. Introduce a `Dispatchers` provider (test dispatcher injection) so coroutine-heavy VM logic is unit-testable.
9. Add explicit `Result`-based cancellation handling in `streamChat` — a caller cancel doesn't currently close the OkHttp stream/socket.
10. Version and namespace the REST contract (`/api/v1/...`) so client and server can evolve independently — endpoints are currently unversioned free strings.

## 2. Networking Reliability

11. [x] Add automatic retry with exponential backoff for `checkHealth`, `getPlatform`, `getModels`, `getDiagnostics` — a single transient failure currently just drops the value.
12. Add a global network-reachability observer (`ConnectivityManager.NetworkCallback`) and surface an offline banner across all screens.
13. Auto-reconnect the session when the app returns to foreground after being backgrounded with a live connection.
14. Add configurable request timeouts in Settings instead of the hardcoded 10s/60s/30s in `MiniOApiClient`.
15. Replace the blocking `client.newCall(req).execute()` calls with proper coroutine-cancellation-aware calls (`suspendCancellableCoroutine` + `Call.enqueue`) so leaving a screen actually cancels in-flight requests.
16. Handle HTTP 401/403 globally — right now an expired/invalid token just bubbles up as a generic "(401)" string instead of returning to `ConnectScreen`.
17. Add a heartbeat/poll (or WebSocket) to detect the server going away mid-session instead of only checking health at connect time.
18. Make `streamChat`'s SSE parser resilient to partial/split `data:` lines across TCP reads (current line-based reader assumes clean line boundaries).
19. Add a max-retry circuit breaker so a persistently failing server doesn't cause infinite background retry loops once auto-reconnect (item 13) is added.
20. Log and surface distinguishable errors for DNS failure vs connection refused vs TLS failure vs timeout — currently all collapse into the OkHttp exception message.

## 3. Security

21. Wire up the `network_security_config.xml` cleartext policy to be togglable per-connection instead of a single static config (LAN HTTP vs WAN HTTPS need different trust rules).
22. Add certificate pinning for HTTPS connections when the user opts into a "trusted server" profile.
23. Add biometric/device-credential gate (`BiometricPrompt`) before revealing the stored server token in Settings or before app resume, since the token unlocks full file read/write/delete on the host.
24. Redact the bearer token in any logs — confirm no `Log.d`/stack trace path ever prints `connection.token`.
25. Add token expiry/rotation support instead of storing a single indefinite token in `EncryptedSharedPreferences`.
26. [x] Validate/sanitize file paths client-side before sending to `/api/files/*` to fail fast on path traversal attempts (`..`), even though the server should also enforce this.
27. Add a "Forget this server" action that wipes `EncryptedSharedPreferences` and any cached files/chat history, not just in-memory state.
28. Warn the user in-app when connecting over plain `http://` to a non-LAN address (currently only documented in the README, not enforced or warned about in the UI).
29. Disable screenshots/screen recording on the `ConnectScreen` and `SettingsScreen` (`FLAG_SECURE`) since token entry happens there.
30. [x] Add root/debugger detection warning (soft, non-blocking) given the app handles a credential with full filesystem-adjacent access.

## 4. Connection Management

31. [x] Support multiple saved server profiles (home PC, laptop, etc.) with a picker, not just one `url`/`token` pair.
32. Add a QR-code "scan to connect" flow that encodes URL+token, generated server-side, to avoid manual typing on mobile.
33. Show a persistent connection-status indicator (latency, last-seen) somewhere visible across all four tabs, not just implicitly via `vm.isConnected`.
34. [x] Add a manual "Disconnect" action in Settings — `vm.disconnect()` exists in the ViewModel but no UI currently calls it.
35. Validate the URL format more thoroughly in `connect()` (currently only checks `http(s)://` prefix — no host/port sanity check, no trailing-path handling beyond `removeSuffix("/")`).
36. [x] Add a connection test/"ping" button on `ConnectScreen` that doesn't require completing a full connect.
37. Persist and show the last successful connection time.
38. Handle the case where `getModels()`/`getPlatform()` succeed but return empty/malformed data without silently leaving `platform`/`availableModels` in a stale state.
39. Add pull-to-refresh on `ConnectScreen`'s recent-connections list (once item 31 exists).
40. Show a clear distinguishing error for "wrong token" vs "server unreachable" vs "server returned unexpected response" during connect.

## 5. Chat — Core Functionality

41. Persist chat history locally (Room/SQLite) so conversations survive process death and app restarts — currently `chatMessages` resets to the welcome message every launch.
42. Support multiple named conversations/threads instead of a single implicit session (`conversationId` is already passed as `null` to `streamChat` — wire it up).
43. Add "regenerate response" for the last assistant message.
44. Add "edit and resend" for the last user message.
45. Add per-message retry when a message fails mid-stream instead of only appending an inline error string.
46. Add message-level delete (swipe or long-press) instead of only whole-conversation clear.
47. Persist `selectedModel` choice across sessions in preferences instead of resetting to the first available model on every connect.
48. Add a "copy full conversation" / export-to-file action.
49. Add a share-sheet action to send a single message or the whole thread via Android's share intent.
50. Show token/response timing metadata (tokens/sec, elapsed time) surfaced from the stream if the server provides it.
51. Add a proper stop-reason indicator (user-stopped vs server-completed vs errored) instead of only a generic "isStreaming=false".
52. Debounce/guard rapid repeated taps on Send beyond the current `isChatStreaming` check (double-tap race before state updates).
53. Add auto-scroll opt-out — currently `listState.animateScrollToItem` always jumps to bottom even if the user manually scrolled up to read history.
54. Add unread-message indicator if the user is scrolled up when a new token arrives.
55. Add multi-line input keyboard shortcuts (hardware keyboard "Enter to send", "Shift+Enter for newline") for tablet/Chromebook use.

## 6. Chat — Rendering & Rich Content

56. Add real code-block syntax highlighting inside `SimpleMarkdownView` instead of (presumably) plain monospace text — verify current fidelity against fenced code blocks with language tags.
57. Add a per-code-block "copy code" button distinct from the whole-message copy button.
58. Render tables, task lists, and blockquotes correctly in `SimpleMarkdownView` if not already covered.
59. Render inline images/diagrams if the server ever returns markdown image links (currently no image pipeline in `ChatMessage` at all).
60. Add tool-call/tool-result messages as distinct, collapsible chat bubbles instead of only a transient `activeToolNotification` banner that disappears after the fact — there's no permanent record of which tools ran once the notification clears.
61. Add syntax-aware diff rendering when the assistant proposes file edits.
62. Add a "view raw" toggle per message to see unrendered markdown source (useful for debugging prompts).
63. Handle extremely long single messages with lazy/virtualized rendering instead of one giant `Text`/`Column`.
64. Add link-tap handling (open in browser / in-app custom tab) for markdown links — confirm `SimpleMarkdownView` links are currently tappable at all.
65. Add LaTeX/math rendering support if the model ever emits math notation (or explicitly strip/escape it cleanly if unsupported).

## 7. Voice Assistant

66. Add a continuous "conversation mode" that keeps listening/responding without requiring a manual mic tap each turn.
67. Add configurable STT language (currently hardcoded to `Locale.getDefault()` with no override for bilingual use).
68. Add TTS voice/engine selection in Settings instead of always using the system default voice.
69. Add TTS speaking-rate and pitch controls exposed to the user (currently hardcoded `1.05f`/`1.0f` in `VoiceAssistantManager`).
70. Add an on-device offline STT fallback path (or explicit messaging) since `SpeechRecognizer` here relies on Google's online recognition service.
71. Surface partial (interim) transcription results live in the UI — `onPartialResults` is currently a no-op.
72. Add a visible waveform/RMS meter using the already-tracked `voiceRmsDb` (confirm it's actually rendered somewhere, not just stored).
73. Handle `ERROR_RECOGNIZER_BUSY` with an automatic short retry instead of surfacing it as a raw error.
74. Add a push-to-talk hardware-button binding option (volume key) for one-handed use.
75. Gracefully degrade the whole voice tab when the device has no microphone or STT engine installed, instead of only handling it at click-time via `isRecognitionAvailable`.
76. Add haptic feedback on state transitions (listening start/stop, response ready).
77. Cap and truncate extremely long TTS utterances sensibly instead of feeding the entire cleaned response to `speak()` in one call.
78. Fix the deprecated `onError(utteranceId: String?)` override in `VoiceAssistantManager` — both the deprecated and non-deprecated overloads are implemented, which is redundant and confusing; drop the deprecated one.
79. Add a persistent mute/voice-disabled state that also disables the `RECORD_AUDIO` permission prompt entirely for users who never want voice.
80. Add automatic language detection or explicit language switch UI feeding into `cleanMarkdownForSpeech`/TTS locale.

## 8. Workspace / File Browser

81. Add pagination or lazy loading for `listFiles` — currently loads the entire directory listing in one call with no limit.
82. Add pull-to-refresh on `WorkspaceScreen`.
83. Add multi-select mode for batch delete/move operations instead of only single-item `deleteFile`.
84. Add rename support in the UI — `performFileOperation` already accepts a `"rename"`/`dstPath` shape server-side conceptually, but no screen exposes it.
85. Add move/copy-to-folder UI using the same `performFileOperation` primitive.
86. Add a confirmation dialog before destructive delete — verify `deleteFile` isn't currently a one-tap irreversible action.
87. Add sort options (name, size, modified date) beyond the fixed directories-first/alphabetical sort in `listFiles`.
88. Debounce `fileSearchQuery` input before firing `loadFolder`/`listFiles` on every keystroke.
89. Add empty-state UI ("This folder is empty") distinct from the loading and error states.
90. Add a dedicated error-state UI for `filesError` beyond whatever currently renders it (confirm there's a retry button, not just static text).
91. Add file/folder icons by type (image, code, markdown, binary) instead of a generic file icon.
92. Add file size and last-modified display formatting (human-readable, e.g. "2.3 KB", "3 hours ago") — confirm `FileItem.size`/`modified` are actually rendered.
93. Add a "new folder" action alongside the existing "new file" flow.
94. Add breadcrumb tap-to-navigate for every path segment, not just an "up one level" action.
95. Add drag-to-reorder or context-menu (long-press) actions for common file operations instead of requiring a separate screen/dialog for every action.
96. Cache the last-viewed folder listing so returning to the Workspace tab doesn't always show a loading spinner.
97. Add a global file search across the whole workspace, not just filtering within the current folder.
98. Handle very large directories (thousands of entries) without janking the LazyColumn — verify keys are stable and stable `key = { it.path }` is used.
99. Show a workspace-root indicator so users always know which host/project they're browsing (relevant once item 31 multi-server support lands).
100. Add "recently opened files" quick-access list on the Workspace tab.

## 9. File Editor

101. Implement conflict resolution UI for the `expected_modified` optimistic-concurrency check — right now `saveFileContent` sends it, but there's no visible "file changed on disk, reload or overwrite?" prompt if the server rejects the save.
102. Add autosave (debounced) or at least an unsaved-changes indicator/dirty flag beyond comparing `editorText != editorOriginalContent` at save-time only.
103. Add a confirmation dialog when closing the editor with unsaved changes (`closeEditor` currently discards silently).
104. Add syntax highlighting keyed off file extension (`.kt`, `.py`, `.md`, `.json`, etc.).
105. Add line numbers in the editor gutter.
106. Add find/replace within the open file.
107. Add undo/redo stack beyond the single-level `revertEditorChanges` (which only reverts to the originally-loaded content).
108. Handle binary files gracefully — attempting to open a binary file through `getFileContent`/`FileContentResponse` currently has no explicit binary-detection or "can't display this file type" path.
109. Add a read-only mode toggle that's actually exposed in the UI (`isEditorReadOnly` exists on the ViewModel but confirm no screen currently lets the user set it).
110. Add word-wrap toggle for long lines.
111. Add font-size adjustment for the code editor, independent of system font scale.
112. Add a loading skeleton instead of a blank screen while `isEditorLoading` is true.
113. Handle extremely large files (multi-MB logs) without loading the entire content into a single Compose `TextField` state, which will jank on large strings.
114. Add "Save As" to a new path instead of only overwrite-in-place.
115. Show file metadata (size, last modified, path) in the editor header, not just the filename.

## 10. Diagnostics Screen

116. Add auto-refresh with a configurable interval instead of only refreshing on tab entry / manual trigger.
117. Add historical charts (uptime, error count over time) instead of only current-snapshot numbers.
118. Add a drill-down log viewer if the server can stream/paginate logs, rather than only the summary `log_count`/`error_count`.
119. Add per-model resource stats (memory, active requests) if the host API exposes them, beyond the flat `ModelInfo` list.
120. Add a "copy diagnostics report" action useful for bug reports/support requests.
121. Visually distinguish healthy/degraded/unreachable server states with color-coded status, not just raw numbers.
122. Add network-latency measurement (round-trip to `/api/health`) displayed alongside uptime.
123. Surface `PlatformInfo` (OS, arch, workspace dir) more prominently — confirm it's actually rendered somewhere, since it's fetched but easy to miss in a diagnostics-dense screen.

## 11. Settings Screen

124. Wire up an actual working light/dark theme switch — `LightColorScheme` is fully defined in `Theme.kt` but `MiniOTheme` hardcodes `if (darkTheme) DarkColorScheme else DarkColorScheme`, so light mode is currently dead code.
125. Add a "system default / always dark / always light" three-way theme preference, persisted.
126. Add Material You dynamic color support (Android 12+) as an opt-in theme mode.
127. Add app version, build number, and changelog link in an "About" section.
128. Add a "Clear local data" action (chat history once persisted, cached files, connection list) distinct from disconnecting.
129. Add default-model preference separate from per-session `selectedModel` override.
130. Add configurable request timeout, retry count, and streaming buffer settings for power users (ties to items 11/14).
131. Add notification preferences once background notifications (item 172) exist.
132. Add accessibility settings shortcut (font scale preview, high-contrast toggle) directly in-app.
133. Add a privacy-policy / data-handling disclosure link, especially given the app stores tokens and can read/write/delete arbitrary workspace files.
134. Add an explicit voice settings section grouping items 67–79 instead of scattering voice controls elsewhere.

## 12. UI/UX Polish & Design System

135. Extract all hardcoded color/dimension literals scattered through screen composables into the existing `Theme.kt` tokens instead of ad-hoc `Color(0xFF...)` and `.dp` values inline in `MainActivity`/`ChatScreen`.
136. Add consistent loading skeletons across all screens instead of ad-hoc `CircularProgressIndicator` usage.
137. Add consistent empty-state illustrations/copy across Chat, Workspace, Diagnostics.
138. Add consistent error-state components (icon + message + retry button) as one shared composable in `CommonComponents.kt`, reused everywhere instead of bespoke per-screen error text.
139. Add subtle enter/exit transitions between the four bottom-nav tabs instead of an instant `when` swap.
140. Add a proper landscape layout audit — verify `ChatScreen`, `WorkspaceScreen`, `FileEditorScreen` don't clip or misbehave in landscape, especially with the soft keyboard open.
141. Add tablet/large-screen adaptive layout (list-detail split for Workspace+FileEditor side-by-side) instead of the current phone-only single-pane navigation.
142. Add foldable-device support (verify no crash/misrender across the hinge posture change).
143. Polish the `CenterVoiceNavButton` touch target — confirm it meets the 48dp minimum touch target guideline at its current 46dp `Column` sizing.
144. Add consistent haptic feedback on primary actions (send, save, delete, connect).
145. Add a proper splash screen using the Android 12+ SplashScreen API instead of a blank cold-start frame.
146. Polish `NavigationBar` label truncation behavior on smaller screens/larger font scales — "Diagnostics"→"System" abbreviation suggests this was already a problem; verify no clipping at 130% font scale.
147. Add snackbar-style dismissible actions (e.g. "Undo delete") instead of the current auto-dismissing toast-only notification system.
148. Ensure the global notification toast (`vm.notificationMessage`) queues multiple rapid messages instead of the newest silently overwriting the previous one before its 3s timer completes.
149. Add pull-down-to-dismiss or swipe-to-dismiss on the notification toast for user control instead of a fixed 3-second timer only.
150. Review contrast ratios of `TextMuted` (`#8090A6`) on `SurfacePanel`/`InkBackground` against WCAG AA — likely borderline for body text.

## 13. Accessibility

151. Audit every `IconButton` for `contentDescription` completeness — several exist (good), but verify `CenterVoiceNavButton`, `SuggestionChip`s, and the model-selector dropdown all have equivalent semantics for TalkBack.
152. Add `Modifier.semantics` custom actions for swipe/long-press gestures once added (items 46, 83, 95) so they're accessible without gesture dexterity.
153. Test and fix layout at 200% system font scale across all five screens.
154. Add a high-contrast theme variant beyond the standard light/dark pair.
155. Ensure minimum 48dp touch targets on all icon buttons — several are declared at 36dp/38dp (`Modifier.size(36.dp)` in ChatScreen header icons) which is below the recommended minimum.
156. Add focus-order verification for TalkBack navigation through the chat list, especially with dynamically streaming content.
157. Announce streaming chat updates via `liveRegion`/accessibility announcements so screen-reader users know a response is arriving, not just visually via the pulsing cursor block.
158. Add reduced-motion support to disable the pulsing voice-button animation and streaming cursor block for users with motion sensitivity.

## 14. Internationalization

159. Extract all hardcoded UI strings ("Ask Mini-O or request a task...", "Listening", "Voice reply enabled", etc.) into `strings.xml` resources instead of inline Kotlin string literals — there is currently no `res/values/strings.xml` at all in the tree.
160. Add a `res/values-*` translation structure and at least one additional locale as a pilot.
161. Verify RTL layout correctness now that `android:supportsRtl="true"` is declared but likely untested, given the manual `Row`/`Alignment.End` usage that doesn't auto-mirror in Compose without `LayoutDirection` awareness.
162. Localize date/time/size formatting (item 92) via `java.text` locale-aware formatters instead of hardcoded formats.

## 15. Testing

163. Add unit tests for `MiniOApiClient` response parsing (health, platform, models, files) using MockWebServer.
164. Add unit tests for `MiniOViewModel` state transitions (connect/disconnect/chat streaming/file open-save) using a fake `ApiClient`.
165. Add unit tests for `VoiceAssistantManager.cleanMarkdownForSpeech` regex pipeline — it's pure and easily testable but has zero test coverage today.
166. Add Compose UI tests for the four main screens (`ChatScreen`, `WorkspaceScreen`, `ConnectScreen`, `SettingsScreen`) covering critical user flows.
167. Add an instrumented end-to-end test for connect → send message → receive stream → disconnect against a local mock server.
168. Add a `build.gradle.kts` test-dependency block — currently there are zero test dependencies declared (no JUnit, no Compose UI testing, no MockWebServer, no Turbine for coroutine flow testing).
169. Add screenshot/regression tests for the design system (dark/light themes, once item 124 ships) to catch visual regressions.
170. Add a minimum code-coverage gate (e.g. 60%+ on ViewModel/API layers) enforced in CI.

## 16. Build, Release & CI/CD

171. Add a release build type with `isMinifyEnabled = true`, R8/ProGuard rules, and resource shrinking — `build.gradle.kts` currently defines no build types beyond the implicit debug default.
172. Add a `signingConfig` for release builds with a keystore managed via CI secrets, not committed to the repo.
173. Add ProGuard keep-rules for OkHttp, org.json, and the Compose runtime reflection paths used by `MasterKey`/`EncryptedSharedPreferences`.
174. Set up a GitHub Actions workflow (`.github/workflows/android.yml`) to run `./gradlew test lint assembleRelease` on every PR.
175. Add `lint.xml`/Android Lint baseline and fail CI on new lint errors.
176. Add automatic `versionCode`/`versionName` bumping tied to git tags instead of the static `versionCode = 1; versionName = "1.0"`.
177. Add a `CHANGELOG.md` under `android/` (the repo root already has one; the Android client needs its own release notes since it versions independently).
178. Add Play Store metadata (listing description, screenshots, privacy policy URL, data-safety form) — required before any public release.
179. Add an internal-testing/beta distribution track (Firebase App Distribution or Play internal track) for pre-release builds.
180. Add dependency-vulnerability scanning (Gradle `dependencyCheck` or Dependabot) for the OkHttp/Compose/security-crypto dependency set.
181. Pin exact dependency versions (already mostly done) and add a Renovate/Dependabot config to keep them current automatically.
182. Add a reproducible-build check or at least a documented release checklist in `android/README.md` (the root `RELEASE_CHECKLIST.md` doesn't currently cover the Android client at all).

## 17. Observability

183. Add crash reporting (Firebase Crashlytics or a self-hosted equivalent) — currently a crash on any screen produces zero telemetry.
184. Add structured logging with log levels, redacting secrets (ties to item 24), instead of ad-hoc `Log.d`/silent `catch (_: Exception) {}` blocks scattered through `VoiceAssistantManager`.
185. Add opt-in, privacy-respecting usage analytics (screen views, feature usage) to prioritize future roadmap work, clearly disclosed per item 133.
186. Add non-fatal error reporting for the many currently-swallowed `catch (_: Exception) {}` blocks (e.g. `speechRecognizer?.stopListening()`, `speechRecognizer?.cancel()`) so silent failures are at least visible in aggregate telemetry.

## 18. Performance

187. Profile Compose recomposition counts on `ChatScreen` during active streaming — appending one character at a time to `chatMessages` via full-list `.map` on every token (`sendChatMessage`'s `onToken` handler) likely triggers more recomposition than necessary; consider a mutable per-message `StateFlow`/`snapshotStateOf` instead of replacing the whole list each token.
188. Batch/throttle token updates (e.g. flush every 30–50ms) instead of recomposing on every single SSE token for very fast models.
189. Verify `LazyColumn` item keys are set (`key = { it.id }`) in `ChatScreen`'s message list to avoid unnecessary recomposition/animation glitches when messages are appended.
190. Audit APK size (currently pulls in the full `material-icons-extended`, which is large) — consider trimming to only the icons actually used.
191. Add baseline profiles (`androidx.profileinstaller`) to improve cold-start and jank metrics.
192. Move JSON parsing off the main thread consistently — confirm all `MiniOApiClient` parsing happens under `Dispatchers.IO` (it does via `withContext`, but double-check the SSE per-line parsing loop, which runs inline in the same IO coroutine and could still block token delivery on slow devices during heavy regex use in item 187's fix).

## 19. Documentation & Scope Alignment

193. Reconcile `android/README.md`'s claim of "no file upload, remote shell, or model-management controls" with the actual implemented `deleteFile`/`createNewFile`/`saveFileContent`/`performFileOperation` capabilities — either restrict the client to true read-only as documented, or update the README and `SECURITY.md`/`THREAT_MODEL.md` to reflect real write/delete capability.
194. Add inline KDoc on `MiniOApiClient` and `MiniOViewModel` public methods, especially around the SSE event contract (`token`/`tool_call`/`tool_result`/`error`/`done`/`end`) since it's currently only discoverable by reading the parser.
195. Document the full REST/SSE API contract in a single `API.md` (endpoints, request/response shapes, auth header, error format) shared between server and Android client so they can't silently drift.
196. Add architecture diagram / module overview to `android/README.md` once the repository/DI refactor (items 1–5) lands.
197. Add a CONTRIBUTING section specific to the Android client (Kotlin style, Compose conventions, PR checklist) distinct from the root `CONTRIBUTING.md`.
198. Document the `network_security_config.xml` cleartext-traffic tradeoffs explicitly for contributors, not just end users.
199. Add in-app "Help / Getting Started" screen covering how to configure `MINI_O_HOST`/`ALLOWED_HOSTS` on the server side, so first-run doesn't require reading the root README.
200. Add a versioned data-migration plan for `EncryptedSharedPreferences` schema changes (e.g. moving from single-connection to multi-profile storage in item 31) so existing users don't lose their saved connection on upgrade.

---

**Suggested sequencing:** 1–20 (architecture/networking) and 41 (chat persistence) unblock the most other work — do those first. 171–182 (release engineering) can run in parallel from day one. Testing (163–170) should land alongside each feature batch, not at the end.
