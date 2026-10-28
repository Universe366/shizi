import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

interface Entry {
  at: number;
  text: string;
}

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 400;
const MAX_AGE = 7 * 86400000;
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function cacheFile(): string {
  try {
    return app?.getPath
      ? path.join(app.getPath('userData'), 'summary-cache.json')
      : '';
  } catch {
    return '';
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const file = cacheFile();
  if (!file || !fs.existsSync(file)) return;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      entries?: Array<[string, Entry]>;
    };
    const cutoff = Date.now() - MAX_AGE;
    for (const [key, entry] of data.entries || []) {
      if (!key || !entry || !Number.isFinite(entry.at) || typeof entry.text !== 'string') {
        continue;
      }
      if (entry.at < cutoff) continue;
      cache.set(key, entry);
    }
  } catch {
    // 缓存损坏不影响总结
  }
}

function persist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const file = cacheFile();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ version: 1, savedAt: Date.now(), entries: [...cache.entries()] })
      );
    } catch {
      // 磁盘不可写时忽略
    }
  }, 300);
  persistTimer.unref?.();
}

export function summaryCacheKey(parts: Array<string | number>): string {
  return crypto
    .createHash('sha1')
    .update(parts.map(String).join('|'))
    .digest('hex');
}

export function getSummaryCache(key: string): string | null {
  load();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > MAX_AGE) {
    cache.delete(key);
    return null;
  }
  return entry.text;
}

export function setSummaryCache(key: string, text: string): void {
  load();
  cache.set(key, { at: Date.now(), text });
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, cache.size - MAX_ENTRIES);
    for (const [oldKey] of oldest) cache.delete(oldKey);
  }
  persist();
}

export function clearSummaryCache(): void {
  cache.clear();
  const file = cacheFile();
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // ignore
  }
}
