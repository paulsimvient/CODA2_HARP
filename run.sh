#!/usr/bin/env bash
# CODA2 — start Ollama (if needed), ensure model, run Vite dev server.

# If invoked by sh, re-exec under bash for array support.
if [[ -z "${BASH_VERSION:-}" ]]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

OLLAMA_BASE_URL="${VITE_OLLAMA_BASE_URL:-http://localhost:11434}"
OLLAMA_HOST="${OLLAMA_BASE_URL#http://}"
OLLAMA_HOST="${OLLAMA_HOST#https://}"
OLLAMA_PID=""
STARTED_OLLAMA=0
PORT="${PORT:-5173}"
APP_ORIGIN_PRIMARY="http://localhost:${PORT}"
APP_ORIGIN_SECONDARY="http://127.0.0.1:${PORT}"
APP_ORIGIN_FALLBACK_PRIMARY="http://localhost:$((PORT + 1))"
APP_ORIGIN_FALLBACK_SECONDARY="http://127.0.0.1:$((PORT + 1))"
DEFAULT_OLLAMA_ORIGINS="${APP_ORIGIN_PRIMARY},${APP_ORIGIN_SECONDARY},${APP_ORIGIN_FALLBACK_PRIMARY},${APP_ORIGIN_FALLBACK_SECONDARY}"
RESTART_OLLAMA_WITH_ORIGINS="${RESTART_OLLAMA_WITH_ORIGINS:-1}"

# ─── helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[36m→\033[0m %s\n' "$*"; }
ok()    { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

append_origin_if_missing() {
  local list="$1"
  local origin="$2"
  if [[ ",$list," == *",$origin,"* ]]; then
    echo "$list"
  else
    echo "${list},${origin}"
  fi
}

build_default_ollama_origins() {
  local origins="$DEFAULT_OLLAMA_ORIGINS"
  local ip
  while IFS= read -r ip; do
    if [[ -z "$ip" || "$ip" == "127.0.0.1" ]]; then
      continue
    fi
    origins="$(append_origin_if_missing "$origins" "http://${ip}:${PORT}")"
    origins="$(append_origin_if_missing "$origins" "http://${ip}:$((PORT + 1))")"
  done < <(ifconfig | awk '/inet / {print $2}' | sort -u)
  echo "$origins"
}

OLLAMA_ORIGINS="${OLLAMA_ORIGINS:-$(build_default_ollama_origins)}"

cleanup() {
  if [[ "$STARTED_OLLAMA" -eq 1 && -n "$OLLAMA_PID" ]]; then
    info "Stopping Ollama (pid $OLLAMA_PID)…"
    kill "$OLLAMA_PID" 2>/dev/null || true
    wait "$OLLAMA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

ollama_ready() {
  curl -sf "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1
}

wait_for_ollama() {
  for i in $(seq 1 30); do
    if ollama_ready; then
      return 0
    fi
    sleep 1
    if [[ "$i" -eq 30 ]]; then
      return 1
    fi
  done
}

start_ollama_serve() {
  info "Starting Ollama with OLLAMA_ORIGINS=${OLLAMA_ORIGINS}"
  OLLAMA_ORIGINS="${OLLAMA_ORIGINS}" ollama serve >/dev/null 2>&1 &
  OLLAMA_PID=$!
  STARTED_OLLAMA=1
  if ! wait_for_ollama; then
    die "Ollama did not become ready within 30s. Try: OLLAMA_ORIGINS=${OLLAMA_ORIGINS} ollama serve"
  fi
}

ollama_cors_ready() {
  local origin="$1"
  local headers lower origin_lc
  headers="$(curl -sS -D - -o /dev/null -H "Origin: ${origin}" "${OLLAMA_BASE_URL}/api/tags" 2>/dev/null || true)"
  lower="$(printf "%s" "$headers" | tr '[:upper:]' '[:lower:]')"
  origin_lc="$(printf "%s" "$origin" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"access-control-allow-origin: *"* || "$lower" == *"access-control-allow-origin: ${origin_lc}"* ]]
}

ensure_ollama_cors_all() {
  local all_ready=1
  local origin

  IFS=',' read -r -a origins <<< "$OLLAMA_ORIGINS"
  for origin in "${origins[@]}"; do
    origin="$(printf "%s" "$origin" | xargs)"
    if [[ -z "$origin" ]]; then
      continue
    fi
    if ollama_cors_ready "$origin"; then
      ok "Ollama CORS allows ${origin}"
    else
      all_ready=0
      warn "Ollama CORS missing origin ${origin}"
    fi
  done

  if [[ "$all_ready" -eq 1 ]]; then
    return
  fi

  warn "Restarting Ollama with OLLAMA_ORIGINS to fix browser access..."
  pkill -f "ollama serve" >/dev/null 2>&1 || true
  sleep 1
  start_ollama_serve

  all_ready=1
  IFS=',' read -r -a origins <<< "$OLLAMA_ORIGINS"
  for origin in "${origins[@]}"; do
    origin="$(printf "%s" "$origin" | xargs)"
    if [[ -z "$origin" ]]; then
      continue
    fi
    if ! ollama_cors_ready "$origin"; then
      all_ready=0
      warn "CORS still missing origin ${origin}"
    fi
  done

  if [[ "$all_ready" -ne 1 ]]; then
    die "Ollama CORS still incomplete. Run manually: OLLAMA_ORIGINS=${OLLAMA_ORIGINS} ollama serve"
  fi
  ok "Ollama CORS configured for required origins"
}

read_env_model() {
  if [[ -f .env ]]; then
    local line
    line="$(grep -E '^VITE_LLM_MODEL=' .env | tail -1 || true)"
    if [[ -n "$line" ]]; then
      echo "${line#VITE_LLM_MODEL=}" | tr -d '"' | tr -d "'"
      return
    fi
  fi
  echo "llama3.2"
}

model_available() {
  local model="$1"
  curl -sf "${OLLAMA_BASE_URL}/api/tags" | grep -q "\"name\":\"${model}" ||
    curl -sf "${OLLAMA_BASE_URL}/api/tags" | grep -q "\"name\":\"${model}:"
}

# ─── prerequisites ────────────────────────────────────────────────────────────

info "CODA2 startup"

command -v node >/dev/null 2>&1 || die "Node.js not found. Install from https://nodejs.org/"
command -v npm  >/dev/null 2>&1 || die "npm not found."
command -v curl >/dev/null 2>&1 || die "curl not found."
command -v ollama >/dev/null 2>&1 || die "Ollama not found. Install: https://ollama.com/download"

# ─── env file ─────────────────────────────────────────────────────────────────

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    warn ".env missing — copying from .env.example"
    cp .env.example .env
  else
    warn ".env missing — creating default Ollama config"
    cat > .env <<'EOF'
VITE_LLM_PROVIDER=ollama
VITE_OLLAMA_BASE_URL=http://localhost:11434
VITE_LLM_MODEL=llama3.2
EOF
  fi
fi

# Export VITE_* for child processes (Vite reads .env itself; this is for the script)
set -a
# shellcheck disable=SC1091
source <(grep -E '^VITE_' .env | sed 's/\r$//')
set +a

MODEL="$(read_env_model)"
OLLAMA_BASE_URL="${VITE_OLLAMA_BASE_URL:-$OLLAMA_BASE_URL}"

ok "LLM provider: ${VITE_LLM_PROVIDER:-ollama}"
ok "Model: $MODEL"
ok "Ollama URL: $OLLAMA_BASE_URL"
ok "App origin(s): ${APP_ORIGIN_PRIMARY}, ${APP_ORIGIN_SECONDARY}, ${APP_ORIGIN_FALLBACK_PRIMARY}, ${APP_ORIGIN_FALLBACK_SECONDARY}"

# ─── node dependencies ────────────────────────────────────────────────────────

if [[ ! -d node_modules ]]; then
  info "Installing npm dependencies…"
  npm install
else
  ok "node_modules present"
fi

# ─── ollama ───────────────────────────────────────────────────────────────────

if [[ "${VITE_LLM_PROVIDER:-ollama}" == "stub" ]]; then
  warn "VITE_LLM_PROVIDER=stub — skipping Ollama checks"
else
  if ollama_ready; then
    ok "Ollama is running"
    if [[ "$RESTART_OLLAMA_WITH_ORIGINS" == "1" ]]; then
      info "Restarting existing Ollama to apply OLLAMA_ORIGINS..."
      pkill -f "ollama serve" >/dev/null 2>&1 || true
      sleep 1
      start_ollama_serve
      ok "Ollama restarted with configured origins"
    fi
  else
    info "Ollama not responding — starting 'ollama serve'…"
    start_ollama_serve
    ok "Ollama ready (started by this script)"
  fi

  ensure_ollama_cors_all

  if model_available "$MODEL"; then
    ok "Model '$MODEL' is available"
  else
    info "Pulling model '$MODEL' (may take a few minutes)…"
    ollama pull "$MODEL"
    ok "Model '$MODEL' pulled"
  fi

  # Quick smoke test
  info "Verifying model responds…"
  SMOKE="$(curl -sf "${OLLAMA_BASE_URL}/api/chat" \
    -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hi\"}],\"stream\":false}" \
    2>/dev/null || true)"
  if echo "$SMOKE" | grep -q '"done":true'; then
    ok "Model smoke test passed"
  else
    warn "Model smoke test inconclusive — app may still work"
  fi
fi

# ─── dev server ───────────────────────────────────────────────────────────────

info "Starting dev server at http://localhost:${PORT}"
info "Press Ctrl+C to stop"

# If we started Ollama, keep it running but don't kill on EXIT when user stops vite
# User typically wants Ollama to stay up — only kill if we spawned it and script exits immediately
STARTED_OLLAMA=0

HOST_ERR_LOG="$(mktemp)"
if npm run dev -- --port "$PORT" --host 2>"$HOST_ERR_LOG"; then
  rm -f "$HOST_ERR_LOG"
  exit 0
fi

cat "$HOST_ERR_LOG" >&2
if grep -q "uv_interface_addresses returned Unknown system error 1" "$HOST_ERR_LOG"; then
  warn "Dev server hit network interface error with '--host'; retrying without it."
  rm -f "$HOST_ERR_LOG"
  npm run dev -- --port "$PORT"
else
  rm -f "$HOST_ERR_LOG"
  die "Dev server failed with '--host' for an unexpected reason."
fi
