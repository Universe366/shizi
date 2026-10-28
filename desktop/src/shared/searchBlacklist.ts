/** 解析 ublacklist 导出：纯文本（一行一条）或 JSON（rules 数组）。 */
export function parseUblacklist(input: string, limit = 5000): string[] {
  const text = String(input || '').replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  let rules: string[] | null = null;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      rules = collectRules(JSON.parse(text));
    } catch {
      rules = null;
    }
  }
  const lines = rules || text.split(/\r?\n/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const value = String(line || '').trim();
    if (!value || value.startsWith('#') || value.startsWith('//')) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function collectRules(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) return value as string[];
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['rules', 'blacklist', 'patterns']) {
    const candidate = record[key];
    if (Array.isArray(candidate) && candidate.every((item) => typeof item === 'string')) {
      return candidate as string[];
    }
  }
  for (const key of ['data', 'settings', 'ublacklist', 'export']) {
    const found = collectRules(record[key]);
    if (found) return found;
  }
  return null;
}
