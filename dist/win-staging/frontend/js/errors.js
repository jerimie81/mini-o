/**
 * Robust Error Handling & Diagnostic System for Mini-O
 */

export class AppError extends Error {
  constructor(message, {
    code = 'UNKNOWN_ERROR',
    category = 'request',
    status = 0,
    diagnosticId = null,
    action = 'Retry the operation or inspect diagnostics',
    details = null,
    cause = null,
  } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.category = category;
    this.status = status;
    this.diagnosticId = diagnosticId || generateDiagnosticId();
    this.action = action;
    this.details = details;
    this.timestamp = new Date().toISOString();
    if (cause) this.cause = cause;
  }
}

export function generateDiagnosticId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `diag-${ts}-${rand}`;
}

export const ERROR_CATEGORIES = {
  CONNECTION: 'connection',
  PERMISSION: 'permission',
  FILESYSTEM: 'filesystem',
  MODEL: 'model',
  TOOLS: 'tools',
  TIMEOUT: 'timeout',
  VALIDATION: 'validation',
  STREAM: 'stream',
  REQUEST: 'request',
  INTERNAL: 'internal',
};

const CATEGORY_ACTIONS = {
  [ERROR_CATEGORIES.CONNECTION]: 'Check local server and Ollama connection, then retry',
  [ERROR_CATEGORIES.PERMISSION]: 'Review workspace allowed roots or tool execution policies',
  [ERROR_CATEGORIES.FILESYSTEM]: 'Verify file path, permissions, or resolve concurrent edits',
  [ERROR_CATEGORIES.MODEL]: 'Select an available model or pull the model in Models panel',
  [ERROR_CATEGORIES.TOOLS]: 'Adjust tool approval settings or enable required tool permissions',
  [ERROR_CATEGORIES.TIMEOUT]: 'Operation timed out; retry or reduce the request scope',
  [ERROR_CATEGORIES.VALIDATION]: 'Check input values and syntax before retrying',
  [ERROR_CATEGORIES.STREAM]: 'Stream interrupted; click Retry to resume conversation',
  [ERROR_CATEGORIES.REQUEST]: 'Inspect request parameters or server diagnostics',
  [ERROR_CATEGORIES.INTERNAL]: 'An unexpected error occurred; check diagnostic logs',
};

/**
 * Classify any error (Error instance, API payload, or string) into a structured AppError
 */
export function classifyError(error, defaultCategory = ERROR_CATEGORIES.REQUEST) {
  if (error instanceof AppError) {
    return error;
  }

  const text = String(error?.message || (typeof error === 'string' ? error : JSON.stringify(error)) || 'Unknown error');
  const status = Number(error?.status) || 0;
  let category = defaultCategory;
  let code = error?.code || 'UNCLASSIFIED_ERROR';
  let action = CATEGORY_ACTIONS[defaultCategory];

  // Specific heuristic classifications
  if (error?.name === 'AbortError' || /abort|cancelled|interrupted/i.test(text)) {
    category = ERROR_CATEGORIES.STREAM;
    code = 'REQUEST_ABORTED';
    action = 'Generation was stopped or timed out. You can retry anytime.';
  } else if (!navigator.onLine || /offline|networkerror|failed to fetch|econnrefused|connection refused|dns/i.test(text)) {
    category = ERROR_CATEGORIES.CONNECTION;
    code = 'NETWORK_OFFLINE';
    action = CATEGORY_ACTIONS[ERROR_CATEGORIES.CONNECTION];
  } else if (status === 404 || /not found|enoent/i.test(text)) {
    category = /model/i.test(text) ? ERROR_CATEGORIES.MODEL : ERROR_CATEGORIES.FILESYSTEM;
    code = /model/i.test(text) ? 'MODEL_NOT_FOUND' : 'FILE_NOT_FOUND';
    action = /model/i.test(text) ? 'Install or pull the model in Models panel' : 'Verify the file exists in the workspace';
  } else if (status === 409 || /conflict|mtime|modified concurrently/i.test(text)) {
    category = ERROR_CATEGORIES.FILESYSTEM;
    code = 'CONCURRENCY_CONFLICT';
    action = 'File was modified on disk. Choose to overwrite or reload.';
  } else if (status === 403 || status === 401 || /permission|forbidden|outside allowed|access denied|policy/i.test(text)) {
    category = ERROR_CATEGORIES.PERMISSION;
    code = 'ACCESS_DENIED';
    action = CATEGORY_ACTIONS[ERROR_CATEGORIES.PERMISSION];
  } else if (status === 408 || /timeout|timed out|etimedout/i.test(text)) {
    category = ERROR_CATEGORIES.TIMEOUT;
    code = 'REQUEST_TIMEOUT';
    action = CATEGORY_ACTIONS[ERROR_CATEGORIES.TIMEOUT];
  } else if (status === 400 || status === 422 || /invalid|validation|malformed|syntax/i.test(text)) {
    category = ERROR_CATEGORIES.VALIDATION;
    code = 'VALIDATION_FAILED';
    action = CATEGORY_ACTIONS[ERROR_CATEGORIES.VALIDATION];
  } else if (/tool|policy|approval/i.test(text)) {
    category = ERROR_CATEGORIES.TOOLS;
    code = 'TOOL_POLICY_VIOLATION';
    action = CATEGORY_ACTIONS[ERROR_CATEGORIES.TOOLS];
  }

  const diagId = error?.diagnostic_id || error?.diagnosticId || generateDiagnosticId();

  return new AppError(text, {
    code,
    category,
    status,
    diagnosticId: diagId,
    action: error?.action || action,
    details: error?.details || (error?.stack ? { stack: error.stack } : null),
    cause: error,
  });
}

/**
 * In-memory client diagnostic log buffer
 */
class DiagnosticLogger {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.logs = [];
    this.listeners = new Set();
  }

  log(errorOrMessage, context = {}) {
    const error = errorOrMessage instanceof Error ? classifyError(errorOrMessage) : classifyError(new Error(String(errorOrMessage)));
    const entry = {
      id: error.diagnosticId,
      timestamp: new Date().toISOString(),
      category: error.category,
      code: error.code,
      message: error.message,
      action: error.action,
      status: error.status,
      details: {
        ...context,
        userAgent: navigator.userAgent,
        online: navigator.onLine,
        url: window.location.href,
        stack: error.stack || null,
      },
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxSize) {
      this.logs.pop();
    }

    this.listeners.forEach(fn => {
      try { fn(entry); } catch { /* ignore */ }
    });

    return entry;
  }

  getLogs() {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.listeners.forEach(fn => {
      try { fn(null); } catch { /* ignore */ }
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  exportJson() {
    return {
      format: 'mini-o.diagnostics',
      version: 1,
      exported_at: new Date().toISOString(),
      client_logs: this.logs,
    };
  }
}

export const diagnostics = new DiagnosticLogger();

/**
 * Setup global window error handlers to catch unhandled script errors
 */
export function installGlobalErrorHandlers(onNotify) {
  window.addEventListener('error', event => {
    const error = event.error || new Error(event.message || 'Script error');
    const entry = diagnostics.log(error, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
    if (onNotify) {
      onNotify('error', `Application error (${entry.id}): ${error.message}`);
    }
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(String(reason || 'Unhandled Promise rejection'));
    const entry = diagnostics.log(error, { source: 'unhandledrejection' });
    if (onNotify) {
      onNotify('error', `Async operation error (${entry.id}): ${error.message}`);
    }
  });
}

export function diagnosticId() {
  return generateDiagnosticId();
}
