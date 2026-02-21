#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VALID_PRESETS = new Set(["free", "quality", "custom"]);
const BASIC_PROVIDERS = new Set(["searxng", "brave"]);
const AI_PROVIDERS = new Set(["tavily", "perplexity"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function ensureObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
}

function ensureArrayUnique(arr, value) {
  if (!Array.isArray(arr)) return [value];
  return arr.includes(value) ? arr : [...arr, value];
}

function usage() {
  console.log(`Usage:
  node scripts/setup-openclaw.mjs [options]

Options:
  --config <path>             OpenClaw config path (default: ~/.openclaw/openclaw.json)
  --state <path>              Backup state path (default: ~/.openclaw/web-search-plus.state.json)
  --agent <id>                Agent id to update (default: main)
  --preset <name>             free | quality | custom (default: free)
  --basic-order <csv>         Custom basic priority (ex: searxng,brave)
  --ai-order <csv>            Custom ai priority (ex: tavily,perplexity)
  --uninstall                 Restore previous state (if exists) and remove web-search-plus wiring
  --searxng-url <url>         Example: http://localhost:8888
  --brave-key <key>
  --tavily-key <key>
  --perplexity-key <key>
  --perplexity-model <model>  Default: sonar-pro
  --no-deny-web-search        Do not add deny for built-in web_search
  --dry-run                   Print result without writing file
  --help
`);
}

function normalizeBooleanFlag(args, key, defaultValue) {
  const denyKey = `no-${key}`;
  if (args[denyKey]) return false;
  if (args[key]) return true;
  return defaultValue;
}

function applyPreset(pluginConfig, preset) {
  ensureObject(pluginConfig, "router").providerPreset = preset;
  const basic = ensureObject(pluginConfig, "basic");
  const ai = ensureObject(pluginConfig, "ai");

  if (preset === "free") {
    basic.priority = ["searxng", "brave"];
    ai.priority = ["tavily", "perplexity"];
    return;
  }
  if (preset === "quality") {
    basic.priority = ["brave", "searxng"];
    ai.priority = ["perplexity", "tavily"];
    return;
  }
}

function parseProviderOrder(input, validSet, flagName) {
  if (!input) return null;
  const order = String(input)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (order.length === 0) {
    throw new Error(`${flagName} is empty`);
  }
  for (const provider of order) {
    if (!validSet.has(provider)) {
      throw new Error(`Invalid provider in ${flagName}: ${provider}`);
    }
  }
  return Array.from(new Set(order));
}

function setIfDefined(obj, key, value) {
  if (value === undefined || value === null || value === "") return;
  obj[key] = value;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function removeArrayValue(arr, value) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item) => item !== value);
}

function maybePruneEmptyObject(parent, key) {
  if (!parent || typeof parent !== "object") return;
  const child = parent[key];
  if (!child || typeof child !== "object" || Array.isArray(child)) return;
  if (Object.keys(child).length === 0) {
    delete parent[key];
  }
}

function hasOnlyId(agent) {
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return false;
  const keys = Object.keys(agent);
  return keys.length === 1 && keys[0] === "id";
}

function writeState(statePath, state, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) return null;
  try {
    return readJson(statePath);
  } catch {
    return null;
  }
}

function removeState(statePath, dryRun) {
  if (dryRun) return;
  if (fs.existsSync(statePath)) fs.rmSync(statePath);
}

function printWarnings(pluginConfig, preset) {
  const braveKey = pluginConfig.basic?.brave?.apiKey || process.env.BRAVE_API_KEY;
  const tavilyKey = pluginConfig.ai?.tavily?.apiKey || process.env.TAVILY_API_KEY;
  const perplexityKey = pluginConfig.ai?.perplexity?.apiKey || process.env.PERPLEXITY_API_KEY;
  const searxngUrl = pluginConfig.basic?.searxng?.baseUrl || process.env.SEARXNG_BASE_URL;

  if (preset === "free") {
    if (!searxngUrl) console.log("WARN: free preset uses SearXNG. Set --searxng-url or SEARXNG_BASE_URL.");
    if (!tavilyKey) console.log("WARN: free preset AI uses Tavily. Set --tavily-key or TAVILY_API_KEY.");
  }
  if (preset === "quality") {
    if (!braveKey) console.log("WARN: quality preset Basic uses Brave. Set --brave-key or BRAVE_API_KEY.");
    if (!perplexityKey) console.log("WARN: quality preset AI uses Perplexity. Set --perplexity-key or PERPLEXITY_API_KEY.");
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  const uninstall = Boolean(args.uninstall);
  let preset = String(args.preset || "free");
  if (preset === "balanced") {
    console.log("WARN: preset 'balanced' is deprecated. Using 'free'.");
    preset = "free";
  }
  if (!uninstall && !VALID_PRESETS.has(preset)) {
    console.error(`Invalid --preset: ${preset}`);
    usage();
    process.exit(1);
  }

  const configPath = expandHome(String(args.config || "~/.openclaw/openclaw.json"));
  const statePath = expandHome(String(args.state || "~/.openclaw/web-search-plus.state.json"));
  const agentId = String(args.agent || "main");
  const dryRun = Boolean(args["dry-run"]);
  const denyWebSearch = normalizeBooleanFlag(args, "deny-web-search", true);
  let basicOrder = null;
  let aiOrder = null;
  try {
    basicOrder = parseProviderOrder(args["basic-order"], BASIC_PROVIDERS, "--basic-order");
    aiOrder = parseProviderOrder(args["ai-order"], AI_PROVIDERS, "--ai-order");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const root = readJson(configPath);
  if (uninstall) {
    const saved = readState(statePath);
    const plugins = ensureObject(root, "plugins");
    const entries = ensureObject(plugins, "entries");
    const agents = ensureObject(root, "agents");
    if (!Array.isArray(agents.list)) agents.list = [];

    if (saved && saved.configPath === configPath && saved.agentId === agentId) {
      if (saved.previousPluginEntry === undefined) {
        delete entries["web-search-plus"];
      } else {
        entries["web-search-plus"] = saved.previousPluginEntry;
      }

      let agent = agents.list.find((item) => item && typeof item === "object" && item.id === agentId);
      if (!agent && saved.agentExisted) {
        agent = { id: agentId };
        agents.list.push(agent);
      }
      if (agent) {
        if (saved.previousTools === undefined) {
          delete agent.tools;
        } else {
          agent.tools = saved.previousTools;
        }
      }
      if (!saved.agentExisted) {
        agents.list = agents.list.filter((item) => !(item && typeof item === "object" && item.id === agentId && hasOnlyId(item)));
      }
    } else {
      delete entries["web-search-plus"];
      const agent = agents.list.find((item) => item && typeof item === "object" && item.id === agentId);
      if (agent && agent.tools) {
        agent.tools.allow = removeArrayValue(agent.tools.allow, "web-search-plus");
        agent.tools.deny = removeArrayValue(agent.tools.deny, "web_search");
        if (agent.tools.allow.length === 0) delete agent.tools.allow;
        if (agent.tools.deny.length === 0) delete agent.tools.deny;
        maybePruneEmptyObject(agent, "tools");
      }
      agents.list = agents.list.filter((item) => !(item && typeof item === "object" && item.id === agentId && hasOnlyId(item)));
    }

    maybePruneEmptyObject(plugins, "entries");
    maybePruneEmptyObject(root, "plugins");
    maybePruneEmptyObject(root, "agents");

    const rendered = JSON.stringify(root, null, 2) + "\n";
    if (dryRun) {
      console.log(rendered);
    } else {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, rendered, "utf8");
      removeState(statePath, dryRun);
      console.log(`Updated: ${configPath}`);
      console.log(`Removed state: ${statePath}`);
    }
    console.log(`Uninstalled web-search-plus wiring for agent: ${agentId}`);
    process.exit(0);
  }

  const plugins = ensureObject(root, "plugins");
  const entries = ensureObject(plugins, "entries");
  const previousPluginEntry = deepClone(entries["web-search-plus"]);
  const pluginEntry = ensureObject(entries, "web-search-plus");
  pluginEntry.enabled = true;
  const pluginConfig = ensureObject(pluginEntry, "config");

  applyPreset(pluginConfig, preset);

  const basic = ensureObject(pluginConfig, "basic");
  const searxng = ensureObject(basic, "searxng");
  const brave = ensureObject(basic, "brave");
  const ai = ensureObject(pluginConfig, "ai");
  const tavily = ensureObject(ai, "tavily");
  const perplexity = ensureObject(ai, "perplexity");

  setIfDefined(searxng, "baseUrl", args["searxng-url"]);
  setIfDefined(brave, "apiKey", args["brave-key"]);
  setIfDefined(tavily, "apiKey", args["tavily-key"]);
  setIfDefined(perplexity, "apiKey", args["perplexity-key"]);
  setIfDefined(perplexity, "model", args["perplexity-model"]);
  if (basicOrder) {
    ensureObject(pluginConfig, "router").providerPreset = "custom";
    basic.priority = basicOrder;
  }
  if (aiOrder) {
    ensureObject(pluginConfig, "router").providerPreset = "custom";
    ai.priority = aiOrder;
  }

  const agents = ensureObject(root, "agents");
  if (!Array.isArray(agents.list)) agents.list = [];

  let agent = agents.list.find((item) => item && typeof item === "object" && item.id === agentId);
  const agentExisted = Boolean(agent);
  const previousTools = deepClone(agent?.tools);
  if (!agent) {
    agent = { id: agentId };
    agents.list.push(agent);
  }

  const tools = ensureObject(agent, "tools");
  tools.allow = ensureArrayUnique(tools.allow, "web-search-plus");
  if (denyWebSearch) {
    tools.deny = ensureArrayUnique(tools.deny, "web_search");
  }

  writeState(
    statePath,
    {
      configPath,
      agentId,
      savedAt: new Date().toISOString(),
      previousPluginEntry,
      previousTools,
      agentExisted
    },
    dryRun
  );

  const rendered = JSON.stringify(root, null, 2) + "\n";
  if (dryRun) {
    console.log(rendered);
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, rendered, "utf8");
    console.log(`Updated: ${configPath}`);
  }

  console.log(`Preset: ${preset}`);
  console.log(`Agent: ${agentId}`);
  console.log(`Allow: web-search-plus`);
  if (denyWebSearch) console.log("Deny: web_search");
  console.log(`State: ${statePath}`);
  printWarnings(pluginConfig, preset);
}

main();
