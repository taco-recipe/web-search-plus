export type BasicProviderName = "searxng" | "brave";
export type AiProviderName = "tavily" | "perplexity";
export type SearchMode = "auto" | "basic" | "ai";
export type ProviderPreset = "free" | "quality" | "custom";

export type BasicResult = {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
};

export type AiSearchResult = {
  answer: string;
  citations: string[];
  results: BasicResult[];
};

export type SearchRequest = {
  query: string;
  provider?: "auto" | BasicProviderName | AiProviderName;
  mode?: SearchMode;
  language?: string;
  country?: string;
  category?: string;
  safesearch?: "off" | "moderate" | "strict";
  freshness?: string;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  debug?: boolean;
};

export type Config = {
  basic: {
    priority: BasicProviderName[];
    searxng: {
      baseUrl: string;
      timeoutMs: number;
    };
    brave: {
      apiKey: string;
      safesearch: "off" | "moderate" | "strict";
      timeoutMs: number;
    };
  };
  ai: {
    priority: AiProviderName[];
    tavily: {
      apiKey: string;
      timeoutMs: number;
    };
    perplexity: {
      apiKey: string;
      model: string;
      timeoutMs: number;
    };
  };
  router: {
    defaultMode: SearchMode;
    providerPreset: ProviderPreset;
    minResultsBeforeUpgrade: number;
    upgradeKeywords: string[];
    maxBraveCallsPerDay: number;
    maxAiCallsPerDay: number;
    enablePrivacyGuard: boolean;
  };
  cache: {
    enabled: boolean;
    maxEntries: number;
    ttlSecondsBasic: number;
    ttlSecondsBrave: number;
    ttlSecondsAi: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    cooldownMs: number;
  };
};

export type DebugEvent = {
  step: string;
  at: string;
  details?: Record<string, unknown>;
};

export type SearchEnvelope<T> = {
  mode: "basic" | "ai";
  provider: string;
  query: string;
  data: T;
  debugTrace: DebugEvent[];
};
