#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SETUP_SH="$ROOT_DIR/scripts/setup-openclaw.sh"
COMPOSE_FILE="$ROOT_DIR/docker-compose.searxng.yml"

CONFIG_PATH="${HOME}/.openclaw/openclaw.json"
STATE_PATH="${HOME}/.openclaw/web-search-plus.state.json"
AGENT_ID="main"
PRESET="free"
BASIC_PROVIDER=""
AI_PROVIDER=""
BASIC_ORDER=""
AI_ORDER=""
APPLY_CUSTOM_ORDER=0
SEARXNG_URL="http://localhost:8888"
BRAVE_KEY=""
TAVILY_KEY=""
PERPLEXITY_KEY=""
PERPLEXITY_MODEL="sonar-pro"
DRY_RUN=0
UNINSTALL=0
INTERACTIVE=1
SKIP_SEARXNG_UP=0
SKIP_GATEWAY_RESTART=0
SKIP_PLUGIN_INSTALL=0
SKIP_DOCTOR=0
DENY_WEB_SEARCH=1

if [[ -t 1 ]]; then
  C_RESET="$(printf '\033[0m')"
  C_BOLD="$(printf '\033[1m')"
  C_DIM="$(printf '\033[2m')"
  C_CYAN="$(printf '\033[36m')"
  C_GREEN="$(printf '\033[32m')"
  C_YELLOW="$(printf '\033[33m')"
else
  C_RESET=""
  C_BOLD=""
  C_DIM=""
  C_CYAN=""
  C_GREEN=""
  C_YELLOW=""
fi

usage() {
  cat <<EOF
Usage:
  $0 [options]

Options:
  --agent <id>                    Agent id (default: main)
  --preset <name>                 free | quality | custom (default: free)
  --basic-provider <value>        searxng | brave | both
  --ai-provider <value>           tavily | perplexity | both | none
  --searxng-url <url>             Default: http://localhost:8888
  --brave-key <key>
  --tavily-key <key>
  --perplexity-key <key>
  --perplexity-model <model>      Default: sonar-pro
  --config <path>                 OpenClaw config path
  --state <path>                  Backup state path
  --no-deny-web-search            Do not deny built-in web_search
  --skip-searxng-up               Do not run docker compose up for SearXNG
  --skip-gateway-restart          Do not restart OpenClaw gateway
  --skip-plugin-install           Do not run openclaw plugins install
  --skip-doctor                   Skip post-deploy verification checks
  --interactive                   Force prompts
  --non-interactive               Disable prompts
  --uninstall                     Restore previous wiring and remove plugin setup
  --dry-run
  --help
EOF
}

print_header() {
  echo "${C_BOLD}${C_CYAN}web-search-plus deploy${C_RESET}"
  echo "${C_DIM}Interactive installer for OpenClaw plugin + provider routing${C_RESET}"
  echo
}

print_section() {
  echo
  echo "${C_BOLD}$1${C_RESET}"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --agent) AGENT_ID="${2:?}"; shift 2 ;;
      --preset) PRESET="${2:?}"; shift 2 ;;
      --basic-provider) BASIC_PROVIDER="${2:?}"; shift 2 ;;
      --ai-provider) AI_PROVIDER="${2:?}"; shift 2 ;;
      --searxng-url) SEARXNG_URL="${2:?}"; shift 2 ;;
      --brave-key) BRAVE_KEY="${2:?}"; shift 2 ;;
      --tavily-key) TAVILY_KEY="${2:?}"; shift 2 ;;
      --perplexity-key) PERPLEXITY_KEY="${2:?}"; shift 2 ;;
      --perplexity-model) PERPLEXITY_MODEL="${2:?}"; shift 2 ;;
      --config) CONFIG_PATH="${2:?}"; shift 2 ;;
      --state) STATE_PATH="${2:?}"; shift 2 ;;
      --no-deny-web-search) DENY_WEB_SEARCH=0; shift ;;
      --skip-searxng-up) SKIP_SEARXNG_UP=1; shift ;;
      --skip-gateway-restart) SKIP_GATEWAY_RESTART=1; shift ;;
      --skip-plugin-install) SKIP_PLUGIN_INSTALL=1; shift ;;
      --skip-doctor) SKIP_DOCTOR=1; shift ;;
      --interactive) INTERACTIVE=1; shift ;;
      --non-interactive) INTERACTIVE=0; shift ;;
      --uninstall) UNINSTALL=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
  done
  if [[ "$PRESET" == "balanced" ]]; then
    echo "WARN: preset 'balanced' is deprecated. Using 'free'." >&2
    PRESET="free"
  fi
}

prompt_choice() {
  local prompt="$1"
  local default_index="$2"
  shift 2
  local options=("$@")
  local i=1
  echo "${C_BOLD}$prompt${C_RESET}" >&2
  for option in "${options[@]}"; do
    local label="${option%%|*}"
    local desc="${option#*|}"
    if [[ "$label" == "$desc" ]]; then
      desc=""
    fi
    if [[ -n "$desc" ]]; then
      echo "  $i) ${C_GREEN}${label}${C_RESET} ${C_DIM}- ${desc}${C_RESET}" >&2
    else
      echo "  $i) ${C_GREEN}${label}${C_RESET}" >&2
    fi
    i=$((i + 1))
  done
  echo "${C_DIM}Press Enter for default: ${default_index}${C_RESET}" >&2
  while true; do
    read -r -p "Select number: " choice
    if [[ -z "$choice" ]]; then
      choice="$default_index"
    fi
    if [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= ${#options[@]})); then
      local selected="${options[$((choice - 1))]}"
      echo "${selected%%|*}"
      return
    fi
    echo "${C_YELLOW}Invalid choice${C_RESET}" >&2
  done
}

prompt_input() {
  local prompt="$1"
  local default="${2:-}"
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " value
    echo "${value:-$default}"
  else
    read -r -p "$prompt: " value
    echo "$value"
  fi
}

prompt_agent_id() {
  local config_path="$1"
  local default_agent="$2"
  local agents_raw=""
  if [[ -f "$config_path" ]]; then
    agents_raw="$(node -e '
      const fs = require("fs");
      const p = process.argv[1];
      try {
        const raw = fs.readFileSync(p, "utf8");
        const j = JSON.parse(raw);
        const list = Array.isArray(j?.agents?.list) ? j.agents.list : [];
        const ids = list
          .filter((x) => x && typeof x === "object" && typeof x.id === "string" && x.id.trim())
          .map((x) => x.id);
        process.stdout.write(ids.join("\n"));
      } catch (_) {}
    ' "$config_path" || true)"
  fi

  if [[ -z "$agents_raw" ]]; then
    prompt_input "Agent id" "$default_agent"
    return
  fi

  echo "${C_DIM}Detected agents from ${config_path}${C_RESET}" >&2
  local options=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && options+=("$line|Detected in config")
  done <<<"$agents_raw"
  options+=("manual|Type agent id manually")

  local selected
  selected="$(prompt_choice "Choose agent target" "1" "${options[@]}")"
  if [[ "$selected" == "manual" ]]; then
    prompt_input "Agent id" "$default_agent"
    return
  fi
  echo "$selected"
}

prompt_provider_order() {
  local tier="$1"
  local selected=""
  if [[ "$tier" == "basic" ]]; then
    local first second
    first="$(prompt_choice "Custom Basic order: choose first provider" "1" \
      "searxng|Local and free" \
      "brave|API-based quality")"
    if [[ "$first" == "searxng" ]]; then
      second="brave"
    else
      second="searxng"
    fi
    selected="${first},${second}"
  else
    local mode first second
    mode="$(prompt_choice "Custom AI order: choose scope" "3" \
      "tavily-only|Use Tavily only" \
      "perplexity-only|Use Perplexity only" \
      "both|Use both with fallback")"
    case "$mode" in
      tavily-only) selected="tavily" ;;
      perplexity-only) selected="perplexity" ;;
      both)
        first="$(prompt_choice "Custom AI order: choose first provider" "1" \
          "tavily|Research-focused" \
          "perplexity|Answer quality focused")"
        if [[ "$first" == "tavily" ]]; then
          second="perplexity"
        else
          second="tavily"
        fi
        selected="${first},${second}"
        ;;
    esac
  fi
  echo "$selected"
}

collect_interactive() {
  [[ "$UNINSTALL" -eq 1 ]] && return

  print_header
  print_section "1) Routing preset"
  PRESET="$(prompt_choice "Choose preset" "1" \
    "free|Low-cost: Basic prefers SearXNG, AI prefers Tavily (recommended)" \
    "quality|Best quality: Basic prefers Brave, AI prefers Perplexity" \
    "custom|You choose exact provider order manually")"

  if [[ "$PRESET" == "custom" ]]; then
    print_section "2) Custom provider order"
    BASIC_ORDER="$(prompt_provider_order "basic")"
    AI_ORDER="$(prompt_provider_order "ai")"
    BASIC_PROVIDER="both"
    AI_PROVIDER="both"
  else
    if [[ "$PRESET" == "free" ]]; then
      BASIC_PROVIDER="searxng"
      AI_PROVIDER="tavily"
      echo "${C_DIM}Preset fixed: basic=searxng, ai=tavily (use custom for manual override)${C_RESET}"
    elif [[ "$PRESET" == "quality" ]]; then
      BASIC_PROVIDER="brave"
      AI_PROVIDER="perplexity"
      echo "${C_DIM}Preset fixed: basic=brave, ai=perplexity (use custom for manual override)${C_RESET}"
    fi
  fi

  print_section "2) OpenClaw target"
  CONFIG_PATH="$(prompt_input "OpenClaw config path" "$CONFIG_PATH")"
  AGENT_ID="$(prompt_agent_id "$CONFIG_PATH" "$AGENT_ID")"
  STATE_PATH="$(prompt_input "State backup path" "$STATE_PATH")"

  print_section "3) Provider credentials"
  if [[ "$BASIC_PROVIDER" == "searxng" || "$BASIC_PROVIDER" == "both" ]]; then
    SEARXNG_URL="$(prompt_input "SearXNG URL" "$SEARXNG_URL")"
  fi
  if [[ "$BASIC_PROVIDER" == "brave" || "$BASIC_PROVIDER" == "both" || "$PRESET" == "quality" ]]; then
    BRAVE_KEY="$(prompt_input "Brave API key (empty to skip)")"
  fi
  if [[ "$AI_PROVIDER" == "tavily" || "$AI_PROVIDER" == "both" || "$PRESET" == "free" ]]; then
    TAVILY_KEY="$(prompt_input "Tavily API key (empty to skip)")"
  fi
  if [[ "$AI_PROVIDER" == "perplexity" || "$AI_PROVIDER" == "both" || "$PRESET" == "quality" ]]; then
    PERPLEXITY_KEY="$(prompt_input "Perplexity API key (empty to skip)")"
    PERPLEXITY_MODEL="$(prompt_input "Perplexity model" "$PERPLEXITY_MODEL")"
  fi

  print_section "4) Apply actions"
  local searxng_up
  searxng_up="$(prompt_choice "Bring up local SearXNG docker now?" "1" \
    "yes|Runs docker compose up -d for local SearXNG" \
    "no|Skip docker step")"
  [[ "$searxng_up" == "yes" ]] || SKIP_SEARXNG_UP=1

  local restart
  restart="$(prompt_choice "Restart OpenClaw gateway after config?" "1" \
    "yes|Apply changes immediately (recommended)" \
    "no|I will restart manually later")"
  [[ "$restart" == "yes" ]] || SKIP_GATEWAY_RESTART=1

  echo
  echo "${C_BOLD}Summary${C_RESET}"
  echo "  preset: ${PRESET}"
  echo "  basic: ${BASIC_PROVIDER}"
  echo "  ai: ${AI_PROVIDER}"
  echo "  agent: ${AGENT_ID}"
  echo "  config: ${CONFIG_PATH}"
  echo "  deny built-in web_search: $([[ "$DENY_WEB_SEARCH" -eq 1 ]] && echo yes || echo no)"

  local confirm
  confirm="$(prompt_choice "Proceed with this setup?" "1" \
    "yes|Run install + configure + restart" \
    "no|Exit without changes")"
  if [[ "$confirm" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
}

build_orders() {
  if [[ -n "${BASIC_ORDER:-}" || -n "${AI_ORDER:-}" ]]; then
    APPLY_CUSTOM_ORDER=1
    return
  fi

  if [[ -z "$BASIC_PROVIDER" ]]; then
    case "$PRESET" in
      free) BASIC_PROVIDER="searxng" ;;
      quality) BASIC_PROVIDER="brave" ;;
      custom) BASIC_PROVIDER="both" ;;
    esac
  fi
  if [[ -z "$AI_PROVIDER" ]]; then
    case "$PRESET" in
      free) AI_PROVIDER="tavily" ;;
      quality) AI_PROVIDER="perplexity" ;;
      custom) AI_PROVIDER="both" ;;
    esac
  fi

  BASIC_ORDER=""
  AI_ORDER=""
  APPLY_CUSTOM_ORDER=0

  local expected_basic="both"
  local expected_ai="both"
  case "$PRESET" in
    free)
      expected_basic="searxng"
      expected_ai="tavily"
      ;;
    quality)
      expected_basic="brave"
      expected_ai="perplexity"
      ;;
    custom)
      expected_basic="both"
      expected_ai="both"
      ;;
  esac

  if [[ "$PRESET" == "custom" || "$BASIC_PROVIDER" != "$expected_basic" || "$AI_PROVIDER" != "$expected_ai" ]]; then
    APPLY_CUSTOM_ORDER=1
  fi

  case "$BASIC_PROVIDER" in
    searxng) BASIC_ORDER="searxng" ;;
    brave) BASIC_ORDER="brave" ;;
    both|"")
      if [[ "$PRESET" == "quality" ]]; then
        BASIC_ORDER="brave,searxng"
      else
        BASIC_ORDER="searxng,brave"
      fi
      ;;
    *) echo "Invalid --basic-provider: $BASIC_PROVIDER" >&2; exit 1 ;;
  esac

  case "$AI_PROVIDER" in
    tavily) AI_ORDER="tavily" ;;
    perplexity) AI_ORDER="perplexity" ;;
    both|"")
      if [[ "$PRESET" == "quality" ]]; then
        AI_ORDER="perplexity,tavily"
      else
        AI_ORDER="tavily,perplexity"
      fi
      ;;
    none)
      AI_ORDER="tavily"
      ;;
    *) echo "Invalid --ai-provider: $AI_PROVIDER" >&2; exit 1 ;;
  esac
}

install_plugin() {
  [[ "$SKIP_PLUGIN_INSTALL" -eq 1 ]] && return
  require_cmd openclaw
  echo "[2/5] Installing plugin link"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: openclaw plugins install -l \"$ROOT_DIR\""
  else
    openclaw plugins install -l "$ROOT_DIR"
  fi
}

setup_searxng() {
  [[ "$UNINSTALL" -eq 1 ]] && return
  if [[ "$BASIC_PROVIDER" != "searxng" && "$BASIC_PROVIDER" != "both" ]]; then
    return
  fi
  [[ "$SKIP_SEARXNG_UP" -eq 1 ]] && return

  require_cmd docker
  echo "[1/5] Starting SearXNG docker"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: docker compose -f \"$COMPOSE_FILE\" up -d"
  else
    docker compose -f "$COMPOSE_FILE" up -d
  fi
}

apply_openclaw_config() {
  echo "[3/5] Applying OpenClaw config"
  local cmd=(sh "$SETUP_SH" --config "$CONFIG_PATH" --state "$STATE_PATH" --agent "$AGENT_ID")

  if [[ "$UNINSTALL" -eq 1 ]]; then
    cmd+=(--uninstall)
  else
    build_orders
    cmd+=(--preset "$PRESET")
    if [[ "$APPLY_CUSTOM_ORDER" -eq 1 ]]; then
      cmd+=(--basic-order "$BASIC_ORDER" --ai-order "$AI_ORDER")
    fi
    [[ -n "$SEARXNG_URL" ]] && cmd+=(--searxng-url "$SEARXNG_URL")
    [[ -n "$BRAVE_KEY" ]] && cmd+=(--brave-key "$BRAVE_KEY")
    [[ -n "$TAVILY_KEY" ]] && cmd+=(--tavily-key "$TAVILY_KEY")
    [[ -n "$PERPLEXITY_KEY" ]] && cmd+=(--perplexity-key "$PERPLEXITY_KEY")
    [[ -n "$PERPLEXITY_MODEL" ]] && cmd+=(--perplexity-model "$PERPLEXITY_MODEL")
    [[ "$DENY_WEB_SEARCH" -eq 0 ]] && cmd+=(--no-deny-web-search)
  fi
  [[ "$DRY_RUN" -eq 1 ]] && cmd+=(--dry-run)

  "${cmd[@]}"
}

restart_gateway() {
  [[ "$SKIP_GATEWAY_RESTART" -eq 1 ]] && return
  echo "[4/5] Restarting OpenClaw gateway"

  if ! command -v openclaw >/dev/null 2>&1; then
    echo "WARN: openclaw CLI not found. Restart gateway manually." >&2
    return
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: openclaw gateway restart"
    return
  fi

  if openclaw gateway restart >/dev/null 2>&1; then
    echo "Gateway restarted: openclaw gateway restart"
    return
  fi
  if openclaw gateway stop >/dev/null 2>&1 && openclaw gateway start >/dev/null 2>&1; then
    echo "Gateway restarted: stop/start fallback"
    return
  fi
  echo "WARN: Failed to restart gateway automatically. Restart it manually." >&2
}

doctor_checks() {
  [[ "$SKIP_DOCTOR" -eq 1 ]] && return
  echo "[5/5] Running post-deploy checks"

  local ok_count=0
  local warn_count=0

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: doctor checks skipped"
    return
  fi

  if [[ -f "$CONFIG_PATH" ]]; then
    local verify_json
    verify_json="$(node -e '
      const fs = require("fs");
      const configPath = process.argv[1];
      const agentId = process.argv[2];
      const uninstall = process.argv[3] === "1";
      let result = { ok: false, msg: "unknown", details: {} };
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        const j = JSON.parse(raw);
        const plugin = j?.plugins?.entries?.["web-search-plus"];
        const agents = Array.isArray(j?.agents?.list) ? j.agents.list : [];
        const agent = agents.find((x) => x && typeof x === "object" && x.id === agentId);
        const allow = Array.isArray(agent?.tools?.allow) ? agent.tools.allow : [];
        const deny = Array.isArray(agent?.tools?.deny) ? agent.tools.deny : [];
        if (uninstall) {
          const pluginRemoved = plugin === undefined;
          const allowRemoved = !allow.includes("web-search-plus");
          result = {
            ok: pluginRemoved && allowRemoved,
            msg: pluginRemoved && allowRemoved ? "uninstall config looks clean" : "uninstall left config entries",
            details: { pluginRemoved, allowRemoved, denyHasWebSearch: deny.includes("web_search") }
          };
        } else {
          const pluginEnabled = Boolean(plugin?.enabled);
          const allowOk = allow.includes("web-search-plus");
          result = {
            ok: pluginEnabled && allowOk,
            msg: pluginEnabled && allowOk ? "plugin wiring present" : "plugin wiring incomplete",
            details: { pluginEnabled, allowOk, denyHasWebSearch: deny.includes("web_search") }
          };
        }
      } catch (err) {
        result = { ok: false, msg: "failed to parse config", details: { error: String(err && err.message ? err.message : err) } };
      }
      process.stdout.write(JSON.stringify(result));
    ' "$CONFIG_PATH" "$AGENT_ID" "$UNINSTALL")"

    local config_ok config_msg
    config_ok="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(String(Boolean(o.ok)));' "$verify_json")"
    config_msg="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(String(o.msg||""));' "$verify_json")"
    if [[ "$config_ok" == "true" ]]; then
      echo "  [OK] Config check: $config_msg"
      ok_count=$((ok_count + 1))
    else
      echo "  [WARN] Config check: $config_msg"
      warn_count=$((warn_count + 1))
    fi
  else
    echo "  [WARN] Config file not found: $CONFIG_PATH"
    warn_count=$((warn_count + 1))
  fi

  if command -v openclaw >/dev/null 2>&1; then
    if openclaw plugins list 2>/dev/null | grep -q "web-search-plus"; then
      echo "  [OK] OpenClaw plugin listed: web-search-plus"
      ok_count=$((ok_count + 1))
    else
      if [[ "$UNINSTALL" -eq 1 ]]; then
        echo "  [OK] Plugin not listed after uninstall"
        ok_count=$((ok_count + 1))
      else
        echo "  [WARN] Plugin not listed in openclaw plugins list"
        warn_count=$((warn_count + 1))
      fi
    fi
  else
    echo "  [WARN] openclaw CLI not found, skipped plugin list check"
    warn_count=$((warn_count + 1))
  fi

  if [[ "$UNINSTALL" -eq 0 ]] && [[ "$BASIC_PROVIDER" == "searxng" || "$BASIC_PROVIDER" == "both" ]]; then
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "${SEARXNG_URL%/}/search?q=healthcheck&format=json" >/dev/null 2>&1; then
        echo "  [OK] SearXNG responds: ${SEARXNG_URL}"
        ok_count=$((ok_count + 1))
      else
        echo "  [WARN] SearXNG not responding at ${SEARXNG_URL}"
        warn_count=$((warn_count + 1))
      fi
    else
      echo "  [WARN] curl not found, skipped SearXNG check"
      warn_count=$((warn_count + 1))
    fi
  fi

  echo "Doctor summary: ok=${ok_count}, warn=${warn_count}"
  if [[ "$warn_count" -gt 0 ]]; then
    echo "Some checks need attention. You can rerun with --dry-run or inspect $CONFIG_PATH."
  fi
}

main() {
  parse_args "$@"
  require_cmd sh
  require_cmd node

  if [[ "$INTERACTIVE" -eq 1 && "$#" -eq 0 ]]; then
    collect_interactive
  fi

  setup_searxng
  install_plugin
  apply_openclaw_config
  restart_gateway
  doctor_checks

  echo "Done."
}

main "$@"
