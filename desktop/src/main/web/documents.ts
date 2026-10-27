const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 120;

interface CachedDocument {
  text: string;
  at: number;
}

const cache = new Map<string, CachedDocument>();

export function cachedDocument(url: string): string | undefined {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(url);
    return undefined;
  }
  return hit.text;
}

export function rememberDocument(url: string, text: string): void {
  if (!url || !text) return;
  cache.set(url, { text, at: Date.now() });
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - MAX_ENTRIES);
  for (const [key] of oldest) cache.delete(key);
}

export function documentCacheSize(): number {
  return cache.size;
}

export function clearDocumentCache(): number {
  const size = cache.size;
  cache.clear();
  return size;
}
