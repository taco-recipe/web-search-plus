import { fetchJson } from "../utils.js";
import type { AiSearchResult } from "../types.js";

const TAVILY_API = "https://api.tavily.com/search";

export async function searchTavily(input: {
  apiKey: string;
  query: string;
  searchDepth?: "basic" | "advanced";
  maxResults: number;
  timeoutMs: number;
}): Promise<AiSearchResult> {
  if (!input.apiKey) throw new Error("Missing Tavily API key");

  const raw = await fetchJson(
    TAVILY_API,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: input.apiKey,
        query: input.query,
        search_depth: input.searchDepth || "advanced",
        max_results: input.maxResults,
        include_answer: true
      })
    },
    input.timeoutMs
  ) as {
    answer?: string;
    results?: Array<Record<string, unknown>>;
  };

  const results = Array.isArray(raw.results) ? raw.results : [];
  return {
    answer: String(raw.answer || ""),
    citations: results.map((r) => String(r.url || "")).filter(Boolean),
    results: results.map((r) => ({
      title: String(r.title || ""),
      url: String(r.url || ""),
      snippet: String(r.content || ""),
      siteName: r.source ? String(r.source) : undefined
    })).filter((r) => Boolean(r.title && r.url))
  };
}
