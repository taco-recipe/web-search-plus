import type { BasicResult } from "./types.js";

export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 400)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function clampMaxResults(value: number | undefined, fallback = 5): number {
  const v = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(1, Math.min(20, v));
}

export function isSensitiveQuery(query: string): boolean {
  const patterns = [
    /\b(sk|rk)-[A-Za-z0-9]{16,}\b/,
    /\b(?:password|passwd|secret|token|apikey|api_key)\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/
  ];
  return patterns.some((re) => re.test(query));
}

export function shouldUpgradeToAi(query: string, keywords: string[]): boolean {
  const normalized = query.toLowerCase();
  return keywords.some((kw) => normalized.includes(kw.toLowerCase()));
}

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const dropKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"];
    for (const key of dropKeys) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}

export function dedupeResults(results: BasicResult[]): BasicResult[] {
  const seen = new Set<string>();
  const output: BasicResult[] = [];
  for (const item of results) {
    const normalized = normalizeUrl(item.url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push({ ...item, url: normalized });
  }
  return output;
}

export function serializeOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function newDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
