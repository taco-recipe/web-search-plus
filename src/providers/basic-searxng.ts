import { fetchJson } from "../utils.js";
import type { BasicResult } from "../types.js";

export async function searchSearxng(input: {
  baseUrl: string;
  query: string;
  language?: string;
  category?: string;
  maxResults: number;
  timeoutMs: number;
}): Promise<BasicResult[]> {
  const url = new URL("/search", input.baseUrl);
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");
  if (input.language) url.searchParams.set("language", input.language);
  if (input.category) url.searchParams.set("categories", input.category);

  const raw = await fetchJson(url.toString(), {}, input.timeoutMs) as { results?: Array<Record<string, unknown>> };
  const rows = Array.isArray(raw.results) ? raw.results : [];

  return rows.slice(0, input.maxResults).map((r) => ({
    title: String(r.title || ""),
    url: String(r.url || ""),
    snippet: String(r.content || r.snippet || ""),
    siteName: r.engine ? String(r.engine) : undefined
  })).filter((r) => Boolean(r.title && r.url));
}
