import type { Config } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  basic: {
    priority: ["searxng", "brave"],
    searxng: {
      baseUrl: process.env.SEARXNG_BASE_URL || "http://localhost:8888",
      timeoutMs: 8000
    },
    brave: {
      apiKey: process.env.BRAVE_API_KEY || "",
      safesearch: "moderate",
      timeoutMs: 8000
    }
  },
  ai: {
    priority: ["tavily", "perplexity"],
    tavily: {
      apiKey: process.env.TAVILY_API_KEY || "",
      timeoutMs: 12000
    },
    perplexity: {
      apiKey: process.env.PERPLEXITY_API_KEY || "",
      model: process.env.PERPLEXITY_MODEL || "sonar-pro",
      timeoutMs: 15000
    }
  },
  router: {
    defaultMode: "auto",
    providerPreset: "free",
    minResultsBeforeUpgrade: 3,
    upgradeKeywords: ["비교", "정리", "근거", "출처", "최신", "요약", "today", "latest", "compare"],
    maxBraveCallsPerDay: 100,
    maxAiCallsPerDay: 100,
    enablePrivacyGuard: true
  },
  cache: {
    enabled: true,
    maxEntries: 512,
    ttlSecondsBasic: 900,
    ttlSecondsBrave: 1800,
    ttlSecondsAi: 7200
  },
  circuitBreaker: {
    failureThreshold: 3,
    cooldownMs: 10 * 60 * 1000
  }
};

export function mergeConfig(base: Config, input?: Partial<Config>): Config {
  if (!input) return base;

  return {
    ...base,
    ...input,
    basic: {
      ...base.basic,
      ...input.basic,
      searxng: { ...base.basic.searxng, ...input.basic?.searxng },
      brave: { ...base.basic.brave, ...input.basic?.brave },
      priority: input.basic?.priority || base.basic.priority
    },
    ai: {
      ...base.ai,
      ...input.ai,
      tavily: { ...base.ai.tavily, ...input.ai?.tavily },
      perplexity: { ...base.ai.perplexity, ...input.ai?.perplexity },
      priority: input.ai?.priority || base.ai.priority
    },
    router: { ...base.router, ...input.router },
    cache: { ...base.cache, ...input.cache },
    circuitBreaker: { ...base.circuitBreaker, ...input.circuitBreaker }
  };
}

export function resolveConfig(api: unknown): Config {
  const apiObj = api as Record<string, unknown>;
  const maybeGetConfig = apiObj?.getConfig as (() => unknown) | undefined;
  const rawConfig = (typeof maybeGetConfig === "function" ? maybeGetConfig() : apiObj?.config) as Partial<Config> | undefined;
  return mergeConfig(DEFAULT_CONFIG, rawConfig);
}
