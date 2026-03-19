#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$STATE_DIR/openclaw.json}"
RESTART_GATEWAY="false"
INSTALL_DEPS="true"
COMPLETED="false"
REQUIRED_OPENCLAW_VERSION="2026.2.2"

for arg in "$@"; do
  case "$arg" in
    --restart)
      RESTART_GATEWAY="true"
      ;;
    --no-install-deps)
      INSTALL_DEPS="false"
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: bash scripts/enable-qmd.sh [--restart] [--no-install-deps]"
      exit 1
      ;;
  esac
done

if ! command -v "$OPENCLAW_BIN" >/dev/null 2>&1; then
  echo "[ERROR] openclaw CLI not found in PATH."
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "[ERROR] Config not found: $CONFIG_PATH"
  exit 1
fi

oc() {
  OPENCLAW_HIDE_BANNER=1 "$OPENCLAW_BIN" "$@"
}

extract_openclaw_version() {
  "$OPENCLAW_BIN" --version 2>/dev/null | grep -Eo '[0-9]{4}\.[0-9]+\.[0-9]+' | head -n 1
}

version_ge() {
  local current required
  current="$1"
  required="$2"
  [[ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n 1)" == "$required" ]]
}

ensure_openclaw_version() {
  local current
  current="$(extract_openclaw_version || true)"
  if [[ -z "$current" ]]; then
    echo "[ERROR] Failed to detect OpenClaw version."
    echo "Please run: openclaw --version"
    exit 1
  fi

  if ! version_ge "$current" "$REQUIRED_OPENCLAW_VERSION"; then
    echo "[ERROR] OpenClaw version $current is lower than required $REQUIRED_OPENCLAW_VERSION."
    echo "Please update first, e.g.: npm install -g openclaw@latest"
    exit 1
  fi

  echo "[OK] OpenClaw version check passed: $current"
}

ensure_bun_installed() {
  if command -v bun >/dev/null 2>&1; then
    echo "[OK] bun found: $(bun --version | head -n 1)"
    return 0
  fi

  echo "[INFO] bun not found; installing via npm i -g bun ..."
  if npm i -g bun >/dev/null 2>&1; then
    hash -r || true
  fi

  if command -v bun >/dev/null 2>&1; then
    echo "[OK] bun installed: $(bun --version | head -n 1)"
    return 0
  fi

  echo "[WARN] Failed to install bun automatically."
  return 1
}

ensure_npm_global_bin_in_path() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "[WARN] npm not found; cannot configure npm global bin PATH."
    return 1
  fi

  local npm_prefix npm_global_bin bashrc_line bashrc_path
  npm_prefix="$(npm config get prefix 2>/dev/null || true)"
  if [[ -z "$npm_prefix" || "$npm_prefix" == "undefined" ]]; then
    echo "[WARN] Unable to resolve npm global prefix."
    return 1
  fi

  npm_global_bin="${npm_prefix}/bin"
  if [[ ! -d "$npm_global_bin" ]]; then
    echo "[WARN] npm global bin directory not found: $npm_global_bin"
    return 1
  fi

  case ":$PATH:" in
    *":$npm_global_bin:"*) ;;
    *) export PATH="$npm_global_bin:$PATH" ;;
  esac

  bashrc_path="$HOME/.bashrc"
  bashrc_line='export PATH="$(npm config get prefix)/bin:$PATH"'
  if [[ -f "$bashrc_path" ]]; then
    if ! grep -Fqx "$bashrc_line" "$bashrc_path"; then
      printf '\n%s\n' "$bashrc_line" >> "$bashrc_path"
      echo "[OK] Added npm global bin PATH export to $bashrc_path"
    fi
  else
    printf '%s\n' "$bashrc_line" > "$bashrc_path"
    echo "[OK] Created $bashrc_path with npm global bin PATH export"
  fi

  echo "[OK] npm global bin is active in current shell: $npm_global_bin"
  return 0
}

ensure_sqlite_installed() {
  if command -v sqlite3 >/dev/null 2>&1; then
    echo "[OK] sqlite3 found: $(sqlite3 --version | head -n 1)"
    return 0
  fi

  local os_name
  os_name="$(uname -s 2>/dev/null || echo unknown)"
  echo "[INFO] sqlite3 not found; attempting install for OS=$os_name"

  if [[ "$os_name" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      brew install sqlite >/dev/null 2>&1 || true
    fi
  elif [[ "$os_name" == "Linux" ]]; then
    if command -v apt >/dev/null 2>&1; then
      sudo apt update >/dev/null 2>&1 || true
      sudo apt install -y sqlite3 libsqlite3-dev >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y sqlite sqlite-devel >/dev/null 2>&1 || true
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -S --noconfirm sqlite >/dev/null 2>&1 || true
    fi
  fi

  if command -v sqlite3 >/dev/null 2>&1; then
    echo "[OK] sqlite3 installed: $(sqlite3 --version | head -n 1)"
    return 0
  fi

  echo "[WARN] sqlite3 is still missing; QMD may not work until SQLite is installed."
  return 1
}

ensure_qmd_installed() {
  ensure_npm_global_bin_in_path || true

  if command -v qmd >/dev/null 2>&1; then
    echo "[OK] qmd found: $(qmd --version 2>/dev/null | head -n 1 || echo 'version unknown')"
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "[WARN] npm missing; skip qmd install."
    return 1
  fi

  echo "[INFO] qmd not found; installing via npm install -g @tobilu/qmd ..."
  npm install -g @tobilu/qmd >/dev/null 2>&1 || true
  hash -r || true
  ensure_npm_global_bin_in_path || true

  if command -v qmd >/dev/null 2>&1; then
    echo "[OK] qmd installed: $(qmd --version 2>/dev/null | head -n 1 || echo 'version unknown')"
    return 0
  fi

  echo "[WARN] Failed to install qmd automatically."
  return 1
}

backup_config() {
  local stamp backup_path
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_path="${CONFIG_PATH}.qmd-backup-${stamp}"
  cp "$CONFIG_PATH" "$backup_path"
  echo "$backup_path"
}

apply_common_memory_optimizations() {
  oc config set commands.nativeSkills true --strict-json >/dev/null
  oc config set hooks.internal.entries.session-memory.enabled true --strict-json >/dev/null
  oc config set plugins.slots.memory memory-core >/dev/null || true

  oc config set agents.defaults.memorySearch.enabled true --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.enabled true --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.vectorWeight 0.7 --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.textWeight 0.3 --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.candidateMultiplier 4 --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.mmr.enabled true --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.mmr.lambda 0.7 --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.temporalDecay.enabled true --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.query.hybrid.temporalDecay.halfLifeDays 30 --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.sync.watch true --strict-json >/dev/null
  oc config set agents.defaults.memorySearch.fallback none >/dev/null
}

create_memory_dirs_for_agents() {
  node - "$CONFIG_PATH" <<'NODE'
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = process.argv[2];
const raw = fs.readFileSync(configPath, 'utf8');
const cfg = JSON.parse(raw);

const expandHome = (p) => {
  if (typeof p !== 'string') return '';
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
};

const dirs = new Set();
const defaultWs = expandHome(cfg?.agents?.defaults?.workspace);
if (defaultWs) dirs.add(defaultWs);

for (const a of (cfg?.agents?.list || [])) {
  const ws = expandHome(a?.workspace);
  if (ws) dirs.add(ws);
}

for (const ws of dirs) {
  fs.mkdirSync(path.join(ws, 'memory'), { recursive: true });
}

console.log(`[OK] ensured memory directory for ${dirs.size} workspace(s)`);
NODE
}

try_enable_qmd() {
  set +e
  local failed=0

  oc config set memory.backend qmd >/dev/null || failed=1
  oc config set memory.qmd.command qmd >/dev/null || failed=1
  oc config set memory.qmd.searchMode search >/dev/null || failed=1
  oc config set memory.qmd.includeDefaultMemory true --strict-json >/dev/null || failed=1
  oc config set memory.qmd.update.onBoot true --strict-json >/dev/null || failed=1
  oc config set memory.qmd.update.interval '"5m"' --strict-json >/dev/null || failed=1
  oc config set memory.qmd.update.embedInterval '"30m"' --strict-json >/dev/null || failed=1
  oc config set memory.qmd.update.waitForBootSync false --strict-json >/dev/null || failed=1
  oc config set memory.qmd.limits.maxResults 8 --strict-json >/dev/null || failed=1
  oc config set memory.qmd.limits.timeoutMs 8000 --strict-json >/dev/null || failed=1

  if ! oc config validate >/dev/null 2>&1; then
    failed=1
  fi

  set -e
  [[ "$failed" -eq 0 ]]
}

fallback_to_builtin_memory_core() {
  oc config unset memory.backend >/dev/null || true
  oc config unset memory.qmd >/dev/null || true
  oc config set plugins.slots.memory memory-core >/dev/null || true
  oc config validate >/dev/null
}

print_memory_status() {
  local output_file
  output_file="$(mktemp)"
  if oc memory status --deep --json > "$output_file" 2>/dev/null; then
    node - "$output_file" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);
for (const item of data) {
  const status = item?.status || {};
  const custom = status.custom || {};
  const backend = status.backend || 'unknown';
  const provider = status.provider || 'unknown';
  const searchMode = custom.searchMode || 'unknown';
  console.log(`[MEMORY] agent=${item.agentId} backend=${backend} provider=${provider} mode=${searchMode}`);
}
NODE
  else
    echo "[WARN] memory status probe failed; run: openclaw memory status --deep"
  fi
  rm -f "$output_file"
}

BACKUP_PATH="$(backup_config)"
echo "[INFO] backup created: $BACKUP_PATH"
trap 'if [[ "$COMPLETED" != "true" ]]; then cp "$BACKUP_PATH" "$CONFIG_PATH"; echo "[ROLLBACK] restored config from $BACKUP_PATH"; fi' ERR

ensure_openclaw_version

if [[ "$INSTALL_DEPS" == "true" ]]; then
  ensure_npm_global_bin_in_path || true
  ensure_sqlite_installed || true
  ensure_qmd_installed || true
fi

apply_common_memory_optimizations
create_memory_dirs_for_agents

if command -v qmd >/dev/null 2>&1 && try_enable_qmd; then
  echo "[OK] QMD backend enabled successfully."
else
  echo "[WARN] QMD enable failed or qmd missing; rolling back to backup and applying memory-core optimization."
  cp "$BACKUP_PATH" "$CONFIG_PATH"
  apply_common_memory_optimizations
  fallback_to_builtin_memory_core
  echo "[OK] fallback applied: memory-core active (QMD not active)."
fi

oc memory index --force >/dev/null || true
print_memory_status

if [[ "$RESTART_GATEWAY" == "true" ]]; then
  if oc gateway restart >/dev/null 2>&1; then
    echo "[OK] gateway restarted."
  else
    echo "[WARN] gateway restart failed; please restart manually: openclaw gateway restart"
  fi
else
  echo "[INFO] If your gateway is already running, you can reload with: openclaw gateway restart"
fi

COMPLETED="true"
echo "[DONE] QMD/vector memory optimization flow complete."
