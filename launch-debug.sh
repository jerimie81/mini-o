#!/usr/bin/env bash
# ==============================================================================
# Mini-O Diagnostic & Process Logging Launcher
# ==============================================================================
# Launches Mini-O in an advanced observable environment that logs:
#   - All Node.js stdout / stderr with high-resolution timestamps
#   - Process tree, subprocess forks, CPU, memory, thread counts, FDs
#   - Network sockets, port bindings, and connection states
#   - Periodic HTTP API health & error diagnostics
#   - Full syscall / child-process tracing via strace (optional/flag-based)
#   - Node.js runtime internals (--trace-warnings, --trace-uncaught, NODE_DEBUG)
# ==============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_LOG_DIR="/home/redrum/.gemini/logs/mini-o"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
SESSION_LOG_DIR="${BASE_LOG_DIR}/session_${TIMESTAMP}"
LATEST_LINK="${BASE_LOG_DIR}/latest"

# Default configuration
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
MODE="dev" # 'dev', 'bundle', 'system'
ENABLE_STRACE=0
CHECK_INTERVAL=2
OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
DATA_DIR="${MINI_O_DATA_DIR:-/home/redrum/.gemini/projects/mini-o/data}"
FRONTEND_DIR="${MINI_O_FRONTEND_DIR:-/home/redrum/.gemini/projects/mini-o/frontend}"

# Color codes
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_RED="\033[31m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_BLUE="\033[34m"
C_CYAN="\033[36m"
C_MAGENTA="\033[35m"

print_header() {
    echo -e "${C_CYAN}${C_BOLD}"
    echo "=================================================================="
    echo "       🚀 MINI-O ADVANCED DIAGNOSTIC & LOGGING ENVIRONMENT       "
    echo "=================================================================="
    echo -e "${C_RESET}"
}

usage() {
    echo -e "${C_BOLD}Usage:${C_RESET} $0 [options]"
    echo ""
    echo "Options:"
    echo "  --dev              Run via TypeScript (tsx server.ts) [Default]"
    echo "  --bundle           Run compiled production bundle (dist/server.cjs)"
    echo "  --system           Run system installation (/opt/mini-o/dist/server.cjs)"
    echo "  --strace           Enable strace to trace all system calls and subprocesses"
    echo "  --port <port>      Set custom port (default: 3000)"
    echo "  --host <host>      Set custom host (default: 127.0.0.1)"
    echo "  --data-dir <path>  Set custom workspace data directory"
    echo "  --clean            Clean old log sessions (keep last 5)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Environment Variables recognized:"
    echo "  PORT, HOST, MINI_O_DATA_DIR, MINI_O_FRONTEND_DIR, GEMINI_API_KEY, OLLAMA_HOST"
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev)
            MODE="dev"
            shift
            ;;
        --bundle)
            MODE="bundle"
            shift
            ;;
        --system)
            MODE="system"
            shift
            ;;
        --strace)
            ENABLE_STRACE=1
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --host)
            HOST="$2"
            shift 2
            ;;
        --data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        --clean)
            echo -e "${C_YELLOW}Cleaning old log sessions...${C_RESET}"
            mkdir -p "$BASE_LOG_DIR"
            find "$BASE_LOG_DIR" -maxdepth 1 -type d -name "session_*" | sort -r | tail -n +6 | xargs -r rm -rf
            echo -e "${C_GREEN}Old sessions cleaned.${C_RESET}"
            exit 0
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${C_RED}Unknown option: $1${C_RESET}"
            usage
            ;;
    esac
done

# Initialize session log directory
mkdir -p "$SESSION_LOG_DIR"
mkdir -p "$DATA_DIR"
ln -sfn "$SESSION_LOG_DIR" "$LATEST_LINK"

SERVER_LOG="${SESSION_LOG_DIR}/server.log"
STDOUT_LOG="${SESSION_LOG_DIR}/stdout.log"
STDERR_LOG="${SESSION_LOG_DIR}/stderr.log"
PROCESS_LOG="${SESSION_LOG_DIR}/processes.log"
NETWORK_LOG="${SESSION_LOG_DIR}/network_sockets.log"
STRACE_LOG="${SESSION_LOG_DIR}/strace.log"
HTTP_LOG="${SESSION_LOG_DIR}/http_monitor.log"
ENV_DUMP="${SESSION_LOG_DIR}/environment_snapshot.json"
DIAGNOSTICS_SUMMARY="${SESSION_LOG_DIR}/diagnostics_summary.txt"

print_header
echo -e "${C_BOLD}📁 Session Directory:${C_RESET} ${SESSION_LOG_DIR}"
echo -e "${C_BOLD}🔗 Latest Symlink:   ${C_RESET} ${LATEST_LINK}"
echo ""

# Pre-flight environment check
echo -e "${C_BLUE}==> [1/4] Running pre-flight system diagnostics...${C_RESET}"

# Check for existing port conflict
EXISTING_PID=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
    echo -e "${C_YELLOW}⚠️  Port $PORT is already in use by PID(s): $EXISTING_PID${C_RESET}"
    ps -fp $EXISTING_PID || true
    echo -e "${C_YELLOW}Attempting to free port $PORT...${C_RESET}"
    kill -15 $EXISTING_PID 2>/dev/null || true
    sleep 1
    STILL_ALIVE=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
    if [ -n "$STILL_ALIVE" ]; then
        echo -e "${C_RED}Force killing persistent process on port $PORT...${C_RESET}"
        kill -9 $STILL_ALIVE 2>/dev/null || true
        sleep 0.5
    fi
fi

# Check Ollama service
OLLAMA_STATUS="offline"
if curl -s --max-time 1 "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
    OLLAMA_STATUS="online"
    echo -e "  • Ollama Service (${OLLAMA_HOST}): ${C_GREEN}ONLINE${C_RESET}"
else
    echo -e "  • Ollama Service (${OLLAMA_HOST}): ${C_YELLOW}OFFLINE / UNREACHABLE (local LLM calls may fail)${C_RESET}"
fi

# Check Gemini API Key
if [ -n "${GEMINI_API_KEY:-}" ]; then
    echo -e "  • Gemini API Key: ${C_GREEN}CONFIGURED${C_RESET} (${GEMINI_API_KEY:0:6}...)"
else
    echo -e "  • Gemini API Key: ${C_YELLOW}NOT SET (cloud Gemini calls will fail unless configured)${C_RESET}"
fi

# Check Node version & dependencies
NODE_BIN=$(which node 2>/dev/null || echo "")
NPM_BIN=$(which npm 2>/dev/null || echo "")
STRACE_BIN=$(which strace 2>/dev/null || echo "")

echo -e "  • Node Binary:    ${NODE_BIN:-missing} ($("$NODE_BIN" -v 2>/dev/null || echo 'N/A'))"
echo -e "  • Workspace Dir:  ${DATA_DIR}"
echo -e "  • Frontend Dir:   ${FRONTEND_DIR}"
echo -e "  • Target URL:     http://${HOST}:${PORT}"

# Dump environment snapshot
cat <<EOF > "$ENV_DUMP"
{
  "timestamp": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "node_version": "$("$NODE_BIN" -v 2>/dev/null)",
  "npm_version": "$("$NPM_BIN" -v 2>/dev/null)",
  "mode": "$MODE",
  "port": "$PORT",
  "host": "$HOST",
  "data_dir": "$DATA_DIR",
  "frontend_dir": "$FRONTEND_DIR",
  "ollama_host": "$OLLAMA_HOST",
  "ollama_status": "$OLLAMA_STATUS",
  "has_gemini_api_key": $([ -n "${GEMINI_API_KEY:-}" ] && echo "true" || echo "false"),
  "strace_enabled": $([ "$ENABLE_STRACE" -eq 1 ] && echo "true" || echo "false"),
  "user": "$(whoami)",
  "os": "$(uname -a)",
  "cwd": "$(pwd)"
}
EOF

# Setup background process tracking variables
SERVER_PID=""
MONITOR_PID=""
HTTP_POLL_PID=""

cleanup() {
    echo ""
    echo -e "${C_MAGENTA}==> Stopping Mini-O logging environment and sub-processes...${C_RESET}"
    
    # Terminate background monitors
    if [ -n "$MONITOR_PID" ] && kill -0 "$MONITOR_PID" 2>/dev/null; then
        kill "$MONITOR_PID" 2>/dev/null || true
    fi
    if [ -n "$HTTP_POLL_PID" ] && kill -0 "$HTTP_POLL_PID" 2>/dev/null; then
        kill "$HTTP_POLL_PID" 2>/dev/null || true
    fi

    # Terminate Mini-O server process tree
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "${C_YELLOW}Terminating Mini-O process tree (PID: $SERVER_PID)...${C_RESET}"
        # Kill child processes first
        pkill -P "$SERVER_PID" 2>/dev/null || true
        kill -15 "$SERVER_PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$SERVER_PID" 2>/dev/null; then
            kill -9 "$SERVER_PID" 2>/dev/null || true
        fi
    fi

    # Generate summary report
    echo "==================================================================" >> "$DIAGNOSTICS_SUMMARY"
    echo "Mini-O Run Session Summary: $(date)" >> "$DIAGNOSTICS_SUMMARY"
    echo "Mode: $MODE | Port: $PORT | Data Dir: $DATA_DIR" >> "$DIAGNOSTICS_SUMMARY"
    echo "Server Log: $SERVER_LOG" >> "$DIAGNOSTICS_SUMMARY"
    echo "Stderr Log: $STDERR_LOG" >> "$DIAGNOSTICS_SUMMARY"
    echo "Process Log: $PROCESS_LOG" >> "$DIAGNOSTICS_SUMMARY"
    echo "Network Log: $NETWORK_LOG" >> "$DIAGNOSTICS_SUMMARY"
    if [ "$ENABLE_STRACE" -eq 1 ]; then
        echo "Strace Log: $STRACE_LOG" >> "$DIAGNOSTICS_SUMMARY"
    fi
    echo "==================================================================" >> "$DIAGNOSTICS_SUMMARY"

    echo -e "${C_GREEN}✓ Environment shutdown cleanly.${C_RESET}"
    echo -e "${C_CYAN}📄 Log artifacts generated at:${C_RESET} ${SESSION_LOG_DIR}"
    echo -e "   ├── ${C_BOLD}server.log${C_RESET}             (Combined timestamped output)"
    echo -e "   ├── ${C_BOLD}stdout.log${C_RESET}             (Standard output stream)"
    echo -e "   ├── ${C_BOLD}stderr.log${C_RESET}             (Standard error stream)"
    echo -e "   ├── ${C_BOLD}processes.log${C_RESET}          (Subprocess tree & resource usage)"
    echo -e "   ├── ${C_BOLD}network_sockets.log${C_RESET}    (TCP ports & socket states)"
    echo -e "   ├── ${C_BOLD}http_monitor.log${C_RESET}       (API probe responses & latency)"
    if [ "$ENABLE_STRACE" -eq 1 ]; then
        echo -e "   ├── ${C_BOLD}strace.log${C_RESET}             (Detailed system call trace)"
    fi
    echo -e "   └── ${C_BOLD}environment_snapshot.json${C_RESET}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Start process & resource monitor loop in background
start_process_monitor() {
    local target_pid="$1"
    echo -e "${C_BLUE}==> [2/4] Initializing process and network telemetry watcher...${C_RESET}"
    (
        echo "=== PROCESS MONITOR STARTED AT $(date) (TARGET ROOT PID: $target_pid) ===" >> "$PROCESS_LOG"
        echo "=== NETWORK SOCKET MONITOR STARTED AT $(date) ===" >> "$NETWORK_LOG"
        
        while kill -0 "$target_pid" 2>/dev/null; do
            CURRENT_TS="$(date +'%Y-%m-%d %H:%M:%S.%3N')"
            
            # Log full process tree for this session
            echo "--- [$CURRENT_TS] Process Tree & Subprocesses ---" >> "$PROCESS_LOG"
            ps --forest -o pid,ppid,pgid,user,stat,%cpu,%mem,vsz,rss,comm,args -g $(ps -o pgid= -p "$target_pid" 2>/dev/null | tr -d ' ') 2>/dev/null >> "$PROCESS_LOG" || \
            ps -ef | grep -E "(mini-o|tsx|node|server.ts|server.cjs)" | grep -v grep >> "$PROCESS_LOG" 2>/dev/null || true
            
            # Check file descriptors for target pid
            if [ -d "/proc/$target_pid/fd" ]; then
                FD_COUNT=$(ls -1 "/proc/$target_pid/fd" 2>/dev/null | wc -l)
                echo "Open FDs for PID $target_pid: $FD_COUNT" >> "$PROCESS_LOG"
            fi

            # Check network sockets and active ports
            echo "--- [$CURRENT_TS] Network Socket State ---" >> "$NETWORK_LOG"
            (ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null || lsof -i :"$PORT" 2>/dev/null) | grep -E "($PORT|11434|node|tsx|mini-o)" >> "$NETWORK_LOG" 2>/dev/null || true

            sleep "$CHECK_INTERVAL"
        done
        echo "=== PROCESS MONITOR STOPPED AT $(date) ===" >> "$PROCESS_LOG"
    ) &
    MONITOR_PID=$!
}

# Start background HTTP health & diagnostics probe
start_http_probe() {
    (
        echo "=== HTTP MONITOR STARTED AT $(date) ===" >> "$HTTP_LOG"
        # Wait for server to become responsive
        sleep 2
        while true; do
            TS="$(date +'%Y-%m-%d %H:%M:%S')"
            HEALTH_RESP=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}s" --max-time 3 "http://${HOST}:${PORT}/api/health" 2>&1 || echo "ERROR: connection failed")
            ERRORS_RESP=$(curl -s --max-time 3 "http://${HOST}:${PORT}/api/diagnostics/errors" 2>&1 || echo "[]")
            
            echo "[$TS] GET /api/health => $HEALTH_RESP" >> "$HTTP_LOG"
            if [ "$ERRORS_RESP" != "[]" ] && [ -n "$ERRORS_RESP" ] && [[ "$ERRORS_RESP" != *"ERROR:"* ]]; then
                echo "[$TS] SERVER ERROR LOGS => $ERRORS_RESP" >> "$HTTP_LOG"
            fi
            sleep 5
        done
    ) &
    HTTP_POLL_PID=$!
}

# Set debugging environment flags for Node.js
export PORT="$PORT"
export HOST="$HOST"
export MINI_O_DATA_DIR="$DATA_DIR"
export MINI_O_FRONTEND_DIR="$FRONTEND_DIR"
export NODE_ENV="${NODE_ENV:-development}"
export DEBUG="${DEBUG:-*}"
export NODE_DEBUG="${NODE_DEBUG:-http,net,stream,fs,child_process,tls,module}"
export NODE_OPTIONS="${NODE_OPTIONS:-} --trace-warnings --trace-uncaught --trace-sigint --unhandled-rejections=strict"

echo -e "${C_BLUE}==> [3/4] Launching Mini-O in mode: ${C_BOLD}${MODE}${C_RESET}..."
echo -e "    NODE_OPTIONS: ${NODE_OPTIONS}"
echo -e "    NODE_DEBUG:   ${NODE_DEBUG}"
echo ""

# Determine launch command based on selected mode
LAUNCH_CMD=()
CWD_DIR="$SCRIPT_DIR"

if [ "$MODE" = "dev" ]; then
    CWD_DIR="/home/redrum/.gemini/projects/mini-o"
    if [ -f "${CWD_DIR}/node_modules/.bin/tsx" ]; then
        LAUNCH_CMD=("${CWD_DIR}/node_modules/.bin/tsx" "server.ts")
    else
        LAUNCH_CMD=("npx" "tsx" "server.ts")
    fi
elif [ "$MODE" = "bundle" ]; then
    CWD_DIR="/home/redrum/.gemini/projects/mini-o"
    if [ ! -f "${CWD_DIR}/dist/server.cjs" ]; then
        echo -e "${C_YELLOW}dist/server.cjs not found. Building bundle...${C_RESET}"
        npm --prefix "$CWD_DIR" run build
    fi
    LAUNCH_CMD=("$NODE_BIN" "dist/server.cjs")
elif [ "$MODE" = "system" ]; then
    if [ -f "/opt/mini-o/dist/server.cjs" ]; then
        CWD_DIR="/opt/mini-o"
        LAUNCH_CMD=("$NODE_BIN" "/opt/mini-o/dist/server.cjs")
    elif [ -x "/bin/mini-o" ]; then
        LAUNCH_CMD=("/bin/mini-o" "run")
    else
        echo -e "${C_RED}Error: System Mini-O installation not found in /opt/mini-o or /bin/mini-o${C_RESET}"
        exit 1
    fi
fi

# Wrap launch command with strace if enabled
if [ "$ENABLE_STRACE" -eq 1 ]; then
    if [ -z "$STRACE_BIN" ]; then
        echo -e "${C_RED}Warning: strace binary not found. Skipping strace.${C_RESET}"
    else
        echo -e "${C_YELLOW}⚡ strace enabled: Tracing subprocesses, file operations, signals, and network calls.${C_RESET}"
        LAUNCH_CMD=("$STRACE_BIN" "-f" "-tt" "-T" "-e" "trace=process,network,file,desc,signal" "-o" "$STRACE_LOG" "${LAUNCH_CMD[@]}")
    fi
fi

echo -e "${C_BLUE}==> [4/4] Executing: ${C_RESET}${C_BOLD}${LAUNCH_CMD[*]}${C_RESET} in ${CWD_DIR}"
echo -e "${C_GREEN}------------------------------------------------------------------${C_RESET}"
echo -e "${C_GREEN} Mini-O output is streamed below and piped into: ${SERVER_LOG}${C_RESET}"
echo -e "${C_GREEN} Press Ctrl+C at any time to cleanly stop and inspect logs.${C_RESET}"
echo -e "${C_GREEN}------------------------------------------------------------------${C_RESET}"

cd "$CWD_DIR"

# Launch application with line-buffered timestamps and tee output to individual & unified log files
# Use a custom FIFO / subshell pipeline to preserve PID tracking
mkfifo "${SESSION_LOG_DIR}/out.pipe" 2>/dev/null || true
mkfifo "${SESSION_LOG_DIR}/err.pipe" 2>/dev/null || true

# Process stdout stream
(
    while IFS= read -r line || [ -n "$line" ]; do
        TS="$(date +'%Y-%m-%d %H:%M:%S.%3N')"
        echo "[$TS] [STDOUT] $line" >> "$SERVER_LOG"
        echo "$line" >> "$STDOUT_LOG"
        echo -e "${C_CYAN}[$TS]${C_RESET} $line"
    done < "${SESSION_LOG_DIR}/out.pipe"
) &
OUT_LOGGER_PID=$!

# Process stderr stream
(
    while IFS= read -r line || [ -n "$line" ]; do
        TS="$(date +'%Y-%m-%d %H:%M:%S.%3N')"
        echo "[$TS] [STDERR] $line" >> "$SERVER_LOG"
        echo "$line" >> "$STDERR_LOG"
        echo -e "${C_RED}[$TS] [ERR]${C_RESET} ${C_YELLOW}$line${C_RESET}" >&2
    done < "${SESSION_LOG_DIR}/err.pipe"
) &
ERR_LOGGER_PID=$!

# Execute the application
"${LAUNCH_CMD[@]}" > "${SESSION_LOG_DIR}/out.pipe" 2> "${SESSION_LOG_DIR}/err.pipe" &
SERVER_PID=$!

# Start telemetry observers
start_process_monitor "$SERVER_PID"
start_http_probe

# Wait for server process to finish
wait "$SERVER_PID" 2>/dev/null || true
EXIT_CODE=$?

echo -e "${C_YELLOW}Mini-O process (PID $SERVER_PID) exited with code: ${EXIT_CODE}${C_RESET}"

# Cleanup pipes
rm -f "${SESSION_LOG_DIR}/out.pipe" "${SESSION_LOG_DIR}/err.pipe" 2>/dev/null || true

wait "$OUT_LOGGER_PID" 2>/dev/null || true
wait "$ERR_LOGGER_PID" 2>/dev/null || true

exit $EXIT_CODE
