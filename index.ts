import { resolveConfig } from "./src/config.js";
import { SearchService } from "./src/search-service.js";
import type { SearchRequest } from "./src/types.js";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asMode(value: unknown): "auto" | "basic" | "ai" | undefined {
  return value === "auto" || value === "basic" || value === "ai" ? value : undefined;
}

function toRequest(input: unknown): SearchRequest {
  const p = (input || {}) as Record<string, unknown>;
  const req: SearchRequest = {
    query: asString(p.query),
    provider: typeof p.provider === "string" ? p.provider as SearchRequest["provider"] : undefined,
    mode: asMode(p.mode),
    language: asString(p.language),
    country: asString(p.country),
    category: asString(p.category),
    safesearch: p.safesearch === "off" || p.safesearch === "moderate" || p.safesearch === "strict" ? p.safesearch : undefined,
    freshness: asString(p.freshness),
    maxResults: typeof p.maxResults === "number" ? p.maxResults : undefined,
    searchDepth: p.searchDepth === "basic" || p.searchDepth === "advanced" ? p.searchDepth : undefined,
    debug: Boolean(p.debug)
  };
  if (!req.query) throw new Error("query is required");
  return req;
}

export default function createPlugin(api: any) {
  const service = new SearchService(resolveConfig(api));

  api.registerTool({
    id: "web_search_basic",
    description: "Basic tier web search (SearXNG/Brave).",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        provider: { type: "string", enum: ["auto", "searxng", "brave"] },
        language: { type: "string" },
        country: { type: "string" },
        category: { type: "string" },
        freshness: { type: "string" },
        safesearch: { type: "string", enum: ["off", "moderate", "strict"] },
        maxResults: { type: "number", minimum: 1, maximum: 20 },
        debug: { type: "boolean", default: false }
      },
      additionalProperties: false
    },
    execute: async (params: unknown) => {
      const req = toRequest(params);
      return service.webSearchBasic(req);
    }
  });

  api.registerTool({
    id: "web_search_ai",
    description: "AI tier web search (Tavily/Perplexity).",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        provider: { type: "string", enum: ["auto", "tavily", "perplexity"] },
        searchDepth: { type: "string", enum: ["basic", "advanced"], default: "advanced" },
        maxResults: { type: "number", minimum: 1, maximum: 20 },
        debug: { type: "boolean", default: false }
      },
      additionalProperties: false
    },
    execute: async (params: unknown) => {
      const req = toRequest(params);
      return service.webSearchAi(req);
    }
  });

  api.registerTool({
    id: "web_search_plus",
    description: "Auto routed search. Starts with Basic, upgrades to AI when needed.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        mode: { type: "string", enum: ["auto", "basic", "ai"], default: "auto" },
        provider: { type: "string", enum: ["auto", "searxng", "brave", "tavily", "perplexity"] },
        language: { type: "string" },
        country: { type: "string" },
        category: { type: "string" },
        freshness: { type: "string" },
        safesearch: { type: "string", enum: ["off", "moderate", "strict"] },
        searchDepth: { type: "string", enum: ["basic", "advanced"] },
        maxResults: { type: "number", minimum: 1, maximum: 20 },
        debug: { type: "boolean", default: false }
      },
      additionalProperties: false
    },
    execute: async (params: unknown) => {
      const req = toRequest(params);
      return service.webSearchPlus(req);
    }
  });
}
