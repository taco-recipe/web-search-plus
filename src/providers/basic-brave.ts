import { fetchJson } from "../utils.js";
import type { BasicResult } from "../types.js";

const BRAVE_WEB_API = "https://api.search.brave.com/res/v1/web/search";

export async function searchBrave(input: {
  apiKey: string;
  query: string;
  language?: string;
  country?: string;
  safesearch?: "off" | "moderate" | "strict";
  freshness?: string;
  maxResults: number;
  timeoutMs: number;
}): Promise<BasicResult[]> {
  if (!input.apiKey) throw new Error("Missing Brave API key");

  const url = new URL(BRAVE_WEB_API);
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(input.maxResults));
  if (input.language) url.searchParams.set("search_lang", input.language);
  if (input.country) url.searchParams.set("country", input.country);
  if (input.safesearch) url.searchParams.set("safesearch", input.safesearch);
  if (input.freshness) url.searchParams.set("freshness", input.freshness);

  const raw = await fetchJson(
    url.toString(),
    { headers: { Accept: "application/json", "X-Subscription-Token": input.apiKey } },
    input.timeoutMs
  ) as { web?: { results?: Array<Record<string, unknown>> } };
  const rows = Array.isArray(raw.web?.results) ? raw.web?.results : [];

  return rows.map((r) => ({
    title: String(r.title || ""),
    url: String(r.url || ""),
    snippet: String(r.description || ""),
    siteName: r.profile && typeof r.profile === "object" && "name" in r.profile ? String((r.profile as Record<string, unknown>).name || "") : undefined
  })).filter((r) => Boolean(r.title && r.url));
}
