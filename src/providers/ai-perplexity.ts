import { fetchJson } from "../utils.js";
import type { AiSearchResult } from "../types.js";

const PERPLEXITY_API = "https://api.perplexity.ai/chat/completions";

export async function searchPerplexity(input: {
  apiKey: string;
  model: string;
  query: string;
  timeoutMs: number;
}): Promise<AiSearchResult> {
  if (!input.apiKey) throw new Error("Missing Perplexity API key");

  const raw = await fetchJson(
    PERPLEXITY_API,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: "Provide a concise answer with citations." },
          { role: "user", content: input.query }
        ]
      })
    },
    input.timeoutMs
  ) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
    search_results?: Array<Record<string, unknown>>;
  };

  const answer = raw.choices?.[0]?.message?.content || "";
  const rows = Array.isArray(raw.search_results) ? raw.search_results : [];
  return {
    answer: String(answer),
    citations: Array.isArray(raw.citations) ? raw.citations : [],
    results: rows.map((r) => ({
      title: String(r.title || ""),
      url: String(r.url || ""),
      snippet: String(r.snippet || r.content || "")
    })).filter((r) => Boolean(r.title && r.url))
  };
}
