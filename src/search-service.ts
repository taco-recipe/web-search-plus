import { TtlLruCache } from "./cache.js";
import { CircuitBreakerRegistry } from "./circuit-breaker.js";
import { searchBrave } from "./providers/basic-brave.js";
import { searchSearxng } from "./providers/basic-searxng.js";
import { searchPerplexity } from "./providers/ai-perplexity.js";
import { searchTavily } from "./providers/ai-tavily.js";
import { clampMaxResults, dedupeResults, isSensitiveQuery, newDayKey, serializeOutput, shouldUpgradeToAi } from "./utils.js";
import type {
  AiProviderName,
  AiSearchResult,
  BasicProviderName,
  BasicResult,
  Config,
  DebugEvent,
  SearchEnvelope,
  SearchRequest
} from "./types.js";

type DayCounter = {
  day: string;
  braveCalls: number;
  aiCalls: number;
};

type ToolPayload = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
};

export class SearchService {
  private readonly cache: TtlLruCache<unknown>;
  private readonly breaker: CircuitBreakerRegistry;
  private dayCounter: DayCounter;

  constructor(private readonly config: Config) {
    this.cache = new TtlLruCache<unknown>(config.cache.maxEntries);
    this.breaker = new CircuitBreakerRegistry(config.circuitBreaker.failureThreshold, config.circuitBreaker.cooldownMs);
    this.dayCounter = { day: newDayKey(), braveCalls: 0, aiCalls: 0 };
  }

  private resetDailyCounterIfNeeded(): void {
    const today = newDayKey();
    if (this.dayCounter.day === today) return;
    this.dayCounter = { day: today, braveCalls: 0, aiCalls: 0 };
  }

  private buildCacheKey(tier: "basic" | "ai", provider: string, req: SearchRequest): string {
    const parts = [
      tier,
      provider,
      req.query.trim().toLowerCase(),
      req.language || "",
      req.country || "",
      req.freshness || "",
      req.category || "",
      String(clampMaxResults(req.maxResults))
    ];
    return parts.join("|");
  }

  private cacheRead<T>(key: string, trace: DebugEvent[]): T | undefined {
    if (!this.config.cache.enabled) return undefined;
    const cached = this.cache.get(key) as T | undefined;
    if (cached) trace.push({ step: "cache_hit", at: new Date().toISOString(), details: { key } });
    return cached;
  }

  private cacheWrite<T>(key: string, value: T, ttlSeconds: number, trace: DebugEvent[]): void {
    if (!this.config.cache.enabled) return;
    this.cache.set(key, value, ttlSeconds);
    trace.push({ step: "cache_set", at: new Date().toISOString(), details: { key, ttlSeconds } });
  }

  private asToolPayload(data: unknown): ToolPayload {
    return {
      content: [{ type: "text", text: serializeOutput(data) }],
      structuredContent: data
    };
  }

  private pickBasicProvider(req: SearchRequest): BasicProviderName[] {
    const availability: Record<BasicProviderName, boolean> = {
      searxng: Boolean(this.config.basic.searxng.baseUrl),
      brave: Boolean(this.config.basic.brave.apiKey)
    };
    if (req.provider === "searxng" || req.provider === "brave") {
      if (!availability[req.provider]) {
        throw new Error(`Requested basic provider is not configured: ${req.provider}`);
      }
      return [req.provider];
    }

    const preset = this.config.router.providerPreset;
    const order: BasicProviderName[] = preset === "free"
      ? ["searxng", "brave"]
      : preset === "quality"
        ? ["brave", "searxng"]
        : this.config.basic.priority;
    return order.filter((p) => availability[p]);
  }

  private pickAiProvider(req: SearchRequest): AiProviderName[] {
    const availability: Record<AiProviderName, boolean> = {
      tavily: Boolean(this.config.ai.tavily.apiKey),
      perplexity: Boolean(this.config.ai.perplexity.apiKey)
    };
    if (req.provider === "tavily" || req.provider === "perplexity") {
      if (!availability[req.provider]) {
        throw new Error(`Requested AI provider is not configured: ${req.provider}`);
      }
      return [req.provider];
    }

    const preset = this.config.router.providerPreset;
    const order: AiProviderName[] = preset === "free"
      ? ["tavily", "perplexity"]
      : preset === "quality"
        ? ["perplexity", "tavily"]
        : this.config.ai.priority;
    return order.filter((p) => availability[p]);
  }

  private async runBasic(req: SearchRequest, trace: DebugEvent[]): Promise<SearchEnvelope<BasicResult[]>> {
    this.resetDailyCounterIfNeeded();
    const providers = this.pickBasicProvider(req);
    if (providers.length === 0) throw new Error("No basic provider configured");
    const maxResults = clampMaxResults(req.maxResults);

    let lastError: unknown;
    for (const provider of providers) {
      if (!this.breaker.isAvailable(provider)) {
        trace.push({ step: "provider_skipped_circuit_open", at: new Date().toISOString(), details: { provider } });
        continue;
      }
      if (provider === "brave" && this.dayCounter.braveCalls >= this.config.router.maxBraveCallsPerDay) {
        trace.push({ step: "provider_skipped_budget", at: new Date().toISOString(), details: { provider } });
        continue;
      }

      const cacheKey = this.buildCacheKey("basic", provider, req);
      const cached = this.cacheRead<SearchEnvelope<BasicResult[]>>(cacheKey, trace);
      if (cached) return cached;

      try {
        const start = Date.now();
        const results = provider === "searxng"
          ? await searchSearxng({
            baseUrl: this.config.basic.searxng.baseUrl,
            query: req.query,
            language: req.language,
            category: req.category,
            maxResults,
            timeoutMs: this.config.basic.searxng.timeoutMs
          })
          : await searchBrave({
            apiKey: this.config.basic.brave.apiKey,
            query: req.query,
            language: req.language,
            country: req.country,
            freshness: req.freshness,
            safesearch: req.safesearch || this.config.basic.brave.safesearch,
            maxResults,
            timeoutMs: this.config.basic.brave.timeoutMs
          });

        if (provider === "brave") this.dayCounter.braveCalls += 1;
        this.breaker.recordSuccess(provider);

        const envelope: SearchEnvelope<BasicResult[]> = {
          mode: "basic",
          provider,
          query: req.query,
          data: dedupeResults(results),
          debugTrace: [
            ...trace,
            { step: "provider_success", at: new Date().toISOString(), details: { provider, latencyMs: Date.now() - start } }
          ]
        };

        const ttl = provider === "brave" ? this.config.cache.ttlSecondsBrave : this.config.cache.ttlSecondsBasic;
        this.cacheWrite(cacheKey, envelope, ttl, trace);
        return envelope;
      } catch (error) {
        this.breaker.recordFailure(provider);
        lastError = error;
        trace.push({
          step: "provider_error",
          at: new Date().toISOString(),
          details: { provider, message: error instanceof Error ? error.message : String(error) }
        });
      }
    }

    throw new Error(`All basic providers failed: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
  }

  private async runAi(req: SearchRequest, trace: DebugEvent[]): Promise<SearchEnvelope<AiSearchResult>> {
    this.resetDailyCounterIfNeeded();
    if (this.dayCounter.aiCalls >= this.config.router.maxAiCallsPerDay) {
      throw new Error("Daily AI call budget reached");
    }

    const providers = this.pickAiProvider(req);
    if (providers.length === 0) throw new Error("No AI provider configured");
    const maxResults = clampMaxResults(req.maxResults);

    let lastError: unknown;
    for (const provider of providers) {
      if (!this.breaker.isAvailable(provider)) {
        trace.push({ step: "provider_skipped_circuit_open", at: new Date().toISOString(), details: { provider } });
        continue;
      }

      const cacheKey = this.buildCacheKey("ai", provider, req);
      const cached = this.cacheRead<SearchEnvelope<AiSearchResult>>(cacheKey, trace);
      if (cached) return cached;

      try {
        const start = Date.now();
        const aiResult = provider === "tavily"
          ? await searchTavily({
            apiKey: this.config.ai.tavily.apiKey,
            query: req.query,
            maxResults,
            searchDepth: req.searchDepth || "advanced",
            timeoutMs: this.config.ai.tavily.timeoutMs
          })
          : await searchPerplexity({
            apiKey: this.config.ai.perplexity.apiKey,
            model: this.config.ai.perplexity.model,
            query: req.query,
            timeoutMs: this.config.ai.perplexity.timeoutMs
          });

        this.dayCounter.aiCalls += 1;
        this.breaker.recordSuccess(provider);

        const envelope: SearchEnvelope<AiSearchResult> = {
          mode: "ai",
          provider,
          query: req.query,
          data: {
            ...aiResult,
            results: dedupeResults(aiResult.results)
          },
          debugTrace: [
            ...trace,
            { step: "provider_success", at: new Date().toISOString(), details: { provider, latencyMs: Date.now() - start } }
          ]
        };

        this.cacheWrite(cacheKey, envelope, this.config.cache.ttlSecondsAi, trace);
        return envelope;
      } catch (error) {
        this.breaker.recordFailure(provider);
        lastError = error;
        trace.push({
          step: "provider_error",
          at: new Date().toISOString(),
          details: { provider, message: error instanceof Error ? error.message : String(error) }
        });
      }
    }

    throw new Error(`All AI providers failed: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
  }

  async webSearchBasic(req: SearchRequest): Promise<ToolPayload> {
    const trace: DebugEvent[] = [{ step: "start_basic", at: new Date().toISOString() }];
    const envelope = await this.runBasic(req, trace);
    return this.asToolPayload(req.debug ? envelope : { ...envelope, debugTrace: [] });
  }

  async webSearchAi(req: SearchRequest): Promise<ToolPayload> {
    const trace: DebugEvent[] = [{ step: "start_ai", at: new Date().toISOString() }];
    if (this.config.router.enablePrivacyGuard && isSensitiveQuery(req.query)) {
      throw new Error("Privacy guard blocked AI search for potentially sensitive query");
    }
    const envelope = await this.runAi(req, trace);
    return this.asToolPayload(req.debug ? envelope : { ...envelope, debugTrace: [] });
  }

  async webSearchPlus(req: SearchRequest): Promise<ToolPayload> {
    const trace: DebugEvent[] = [{ step: "start_auto", at: new Date().toISOString() }];
    const mode = req.mode || this.config.router.defaultMode;

    if (mode === "basic") return this.webSearchBasic(req);
    if (mode === "ai") return this.webSearchAi(req);

    const basicEnvelope = await this.runBasic(req, trace);
    const basicInsufficient = basicEnvelope.data.length < this.config.router.minResultsBeforeUpgrade;
    const intentRequiresAi = shouldUpgradeToAi(req.query, this.config.router.upgradeKeywords);

    trace.push({
      step: "auto_evaluate_upgrade",
      at: new Date().toISOString(),
      details: { basicResultCount: basicEnvelope.data.length, basicInsufficient, intentRequiresAi }
    });

    if (!basicInsufficient && !intentRequiresAi) {
      return this.asToolPayload(req.debug ? basicEnvelope : { ...basicEnvelope, debugTrace: [] });
    }
    if (this.config.router.enablePrivacyGuard && isSensitiveQuery(req.query)) {
      trace.push({ step: "ai_upgrade_blocked_by_privacy_guard", at: new Date().toISOString() });
      return this.asToolPayload(req.debug ? basicEnvelope : { ...basicEnvelope, debugTrace: [] });
    }

    try {
      const aiEnvelope = await this.runAi(req, trace);
      return this.asToolPayload(req.debug ? aiEnvelope : { ...aiEnvelope, debugTrace: [] });
    } catch (error) {
      trace.push({
        step: "ai_upgrade_failed_fallback_to_basic",
        at: new Date().toISOString(),
        details: { message: error instanceof Error ? error.message : String(error) }
      });
      const fallback = { ...basicEnvelope, debugTrace: trace };
      return this.asToolPayload(req.debug ? fallback : { ...fallback, debugTrace: [] });
    }
  }
}
