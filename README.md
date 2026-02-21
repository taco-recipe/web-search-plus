# web-search-plus

OpenClaw plugin for:

- Basic search (`searxng`, `brave`)
- AI search (`tavily`, `perplexity`)
- Auto routing (`basic -> ai` upgrade on intent/quality triggers)

## Provider Presets

Set `router.providerPreset` to control activation strategy:

- `free`: Basic prefers `searxng`, AI prefers `tavily`
- `quality`: Basic prefers `brave`, AI prefers `perplexity`
- `custom`: use exactly the priority arrays you configure

Runtime behavior:

- If a provider key/config is missing, it is automatically excluded.
- If only one provider exists in a tier, that provider is used.
- If no provider is configured in a tier, the tool returns an explicit error.

## Included Tools

- `web_search_basic`
- `web_search_ai`
- `web_search_plus`

## Files

- `openclaw.plugin.json`: plugin manifest + `configSchema`
- `index.ts`: tool registration
- `src/search-service.ts`: routing, fallback, cache, budgets, privacy guard
- `src/providers/*`: provider adapters

## Config

Configure via plugin settings (`configSchema`) or env vars:

- `SEARXNG_BASE_URL`
- `BRAVE_API_KEY`
- `TAVILY_API_KEY`
- `PERPLEXITY_API_KEY`
- `PERPLEXITY_MODEL`

Example config:

```json
{
  "basic": {
    "priority": ["searxng", "brave"],
    "searxng": { "baseUrl": "http://localhost:8888" },
    "brave": { "apiKey": "BRAVE_KEY", "safesearch": "moderate" }
  },
  "ai": {
    "priority": ["tavily", "perplexity"],
    "tavily": { "apiKey": "TAVILY_KEY" },
    "perplexity": { "apiKey": "PPLX_KEY", "model": "sonar-pro" }
  },
  "router": {
    "defaultMode": "auto",
    "providerPreset": "free",
    "minResultsBeforeUpgrade": 3,
    "upgradeKeywords": ["비교", "정리", "근거", "출처", "최신", "요약"],
    "maxBraveCallsPerDay": 50,
    "maxAiCallsPerDay": 30,
    "enablePrivacyGuard": true
  }
}
```

Quality-first preset example:

```json
{
  "router": {
    "providerPreset": "quality"
  }
}
```

Single-provider example (only Tavily in AI):

```json
{
  "ai": {
    "priority": ["tavily", "perplexity"],
    "tavily": { "apiKey": "TAVILY_KEY" },
    "perplexity": { "apiKey": "" }
  }
}
```

## Tool Examples

Basic search:

```json
{
  "query": "openclaw plugin manifest",
  "provider": "auto",
  "maxResults": 5
}
```

AI search:

```json
{
  "query": "OpenClaw plugin system and configSchema 요약해줘",
  "provider": "tavily",
  "searchDepth": "advanced"
}
```

Auto search with trace:

```json
{
  "query": "Brave vs SearXNG 품질 비교와 운영 전략",
  "mode": "auto",
  "debug": true
}
```

## Behavior Summary

- Basic tier first in `auto`
- Upgrade to AI when:
  - query matches upgrade keywords, or
  - basic results are below `minResultsBeforeUpgrade`
- Fallback to Basic if AI fails
- Built-in controls:
  - LRU + TTL cache
  - circuit breaker
  - daily call budgets
  - sensitive query guard for AI

## OpenClaw Setup CLI

`web-search-plus` includes a CLI that updates OpenClaw config to:

- enable plugin entry: `plugins.entries.web-search-plus.enabled = true`
- set plugin preset/config
- set agent allowlist: `tools.allow += ["web-search-plus"]`
- set denylist: `tools.deny += ["web_search"]` (default)

Default OpenClaw config path:

- `~/.openclaw/openclaw.json`

Run with free preset:

```bash
npm run setup:openclaw -- --preset free --agent main --searxng-url http://localhost:8888 --tavily-key YOUR_TAVILY_KEY
```

Same with `sh`:

```bash
sh /Users/taco/web-search-plus/scripts/setup-openclaw.sh --preset free --agent main --searxng-url http://localhost:8888 --tavily-key YOUR_TAVILY_KEY
```

Run with quality preset:

```bash
npm run setup:openclaw -- --preset quality --agent main --brave-key YOUR_BRAVE_KEY --perplexity-key YOUR_PPLX_KEY
```

Preview without writing:

```bash
npm run setup:openclaw -- --preset free --dry-run
```

CLI help:

```bash
node /Users/taco/web-search-plus/scripts/setup-openclaw.mjs --help
```

Uninstall and restore previous wiring:

```bash
npm run setup:openclaw -- --uninstall --agent main
```

Uninstall with `sh`:

```bash
sh /Users/taco/web-search-plus/scripts/setup-openclaw.sh --uninstall --agent main
```

Notes:

- Setup stores pre-change state in `~/.openclaw/web-search-plus.state.json`.
- Uninstall restores from that state when available.
- If state file is missing, uninstall removes:
  - `plugins.entries.web-search-plus`
  - agent `tools.allow` item `web-search-plus`
  - agent `tools.deny` item `web_search`

## One-shot Deploy Script

Use one command to:

- install/link plugin
- optionally start local SearXNG docker
- apply OpenClaw config (allow/deny + provider setup)
- restart gateway
- run doctor checks (config wiring, plugin list, optional SearXNG health)

Interactive:

```bash
cd /Users/taco/web-search-plus
./deploy.sh
```

Non-interactive (free preset):

```bash
cd /Users/taco/web-search-plus
./deploy.sh \
  --non-interactive \
  --preset free \
  --basic-provider searxng \
  --ai-provider tavily \
  --searxng-url http://localhost:8888 \
  --tavily-key YOUR_TAVILY_KEY
```

Non-interactive (quality preset):

```bash
cd /Users/taco/web-search-plus
./deploy.sh \
  --non-interactive \
  --preset quality \
  --basic-provider brave \
  --ai-provider perplexity \
  --brave-key YOUR_BRAVE_KEY \
  --perplexity-key YOUR_PPLX_KEY
```

Uninstall + restore:

```bash
cd /Users/taco/web-search-plus
./deploy.sh --non-interactive --uninstall
```

Skip doctor checks:

```bash
cd /Users/taco/web-search-plus
./deploy.sh --non-interactive --skip-doctor
```

## Run Local SearXNG (Docker)

1. Start local SearXNG:

```bash
docker compose -f /Users/taco/web-search-plus/docker-compose.searxng.yml up -d
```

2. Check it:

```bash
curl "http://localhost:8888/search?q=openclaw&format=json"
```

3. Point plugin config to it:

```json
{
  "basic": {
    "searxng": {
      "baseUrl": "http://localhost:8888"
    }
  },
  "router": {
    "providerPreset": "free"
  }
}
```
