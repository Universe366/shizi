import { session } from 'electron';
import type { SkillIndexEntry } from '../shared/types';

/** 拉取远程技能索引：支持数组、{skills: []}、{items: []}。 */
export async function fetchSkillIndex(input: string): Promise<SkillIndexEntry[]> {
  const url = String(input || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('请填写 http(s) 索引地址');
  const response = await session.defaultSession.fetch(url, {
    headers: { accept: 'application/json, text/plain, */*' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`索引下载失败（HTTP ${response.status}）`);
  const text = await response.text();
  if (text.length > 512_000) throw new Error('索引太大（超过 512KB）');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('索引不是合法 JSON');
  }
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { skills?: unknown })?.skills)
      ? ((raw as { skills: unknown[] }).skills)
      : Array.isArray((raw as { items?: unknown })?.items)
        ? ((raw as { items: unknown[] }).items)
        : [];
  if (!rows.length) throw new Error('索引里没有技能条目');
  const entries: SkillIndexEntry[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const name = String(item.name || '').trim();
    const skillUrl = String(item.url || item.sourceUrl || '').trim();
    if (!name || !/^https?:\/\//i.test(skillUrl)) continue;
    entries.push({
      id: String(item.id || `index-${index}`),
      name: name.slice(0, 80),
      description: String(item.description || '').slice(0, 200),
      icon: item.icon ? String(item.icon).slice(0, 8) : '✨',
      category: item.category ? String(item.category).slice(0, 40) : undefined,
      version: item.version ? String(item.version).slice(0, 20) : undefined,
      author: item.author ? String(item.author).slice(0, 60) : undefined,
      url: skillUrl
    });
    if (entries.length >= 100) break;
  }
  if (!entries.length) throw new Error('索引条目缺少 name/url');
  return entries;
}
