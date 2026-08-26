# Mini-O product foundation

## Product promise

Mini-O is a local-first workspace for chatting with Ollama models and making
deliberate changes to local files. The browser is the interface; the FastAPI
server owns persistence, workspace boundaries, and tool execution.

## Primary journeys

1. **Start a chat:** confirm Ollama is reachable, choose an installed model,
   write a prompt, stream the answer, and retry or stop if generation fails.
2. **Work in a workspace:** browse approved files, open a text file, edit,
   save, and attach selected file contents to a prompt.
3. **Manage models:** refresh the model list, distinguish connection failure
   from an empty model list, and select a model before sending.
4. **Use tools deliberately:** enable tools, inspect their descriptions, and
   explicitly confirm side-effecting tools before execution.

## Personas and privacy assumptions

- **Local builder:** wants a practical coding companion without uploading
  workspace contents by default.
- **Careful operator:** needs visible model/connection state and clear tool
  side effects before allowing writes, shell, Python, or network access.
- **New Ollama user:** needs a short first-run path explaining installation,
  server startup, model selection, and the local storage boundary.

Mini-O assumes the server is operated on a trusted machine unless an explicit
remote deployment hardening layer is added. Conversations and workspace files
are local. The web tool is the intentional network boundary; tool calls can
execute code or write files and therefore require confirmation by default.

## Terminology

Model = an Ollama model selected for generation. Chat = one persisted
conversation. Workspace = the approved filesystem root. Attachment = a file
whose text is copied into the current prompt. Tool = a server-side capability.
Agent instructions = scoped `AGENT.md` text supplied by the workspace.

## Page/component inventory

The single application shell contains: conversation navigation, model picker,
connection status, message stream, composer, workspace drawer, Files/Tools/
Configure tabs, file editor, onboarding dialog, and About dialog.

## Responsive navigation rules

Desktop shows all three columns. Tablet keeps conversations and the main chat
visible while the workspace becomes a drawer. Narrow screens make both side
panels modal drawers behind one scrim; Escape and the close buttons dismiss
them, while the main composer remains visible.

## Product decisions and release criteria

- Local data is the default; no remote provider is implied by the UI.
- No model means sending is disabled with an actionable explanation.
- Streaming status is announced without replacing the full response on every
  token.
- User feedback uses one notice model: success for completed writes, warning
  for recoverable interruptions, error for failed requests, and confirmation
  dialogs for destructive or state-resetting actions.
- Theme contrast was reviewed against WCAG AA targets for normal text. The
  muted text token is intentionally used only for secondary text; controls,
  status labels, borders, and focus indicators use stronger tokens.
- Release requires Python compilation, deterministic backend tests, frontend
  tests, keyboard smoke coverage, safe rendering tests, and a documented
  accessibility/security review.
