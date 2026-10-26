import fs from 'node:fs';
import { session } from 'electron';
import type { AppSettings, SkillItem } from '../shared/types';

function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source.trim() };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[kv[1]] = value;
  }
  return { data, body: source.slice(match[0].length).trim() };
}

export function parseSkillMarkdown(text: string, fallbackName = '导入技能'): SkillItem {
  const { data, body } = parseFrontmatter(text);
  if (!body.trim()) throw new Error('SKILL.md 没有正文');
  return {
    id: `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(data.name || fallbackName).trim() || fallbackName,
    description: String(data.description || '').trim().slice(0, 200),
    icon: String(data.icon || '✨').trim().slice(0, 8) || '✨',
    body: body.trim(),
    enabled: true,
    source: 'file'
  };
}

export function readSkillFile(file: string): SkillItem {
  const text = fs.readFileSync(file, 'utf8');
  const fallback = file.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || '导入技能';
  return parseSkillMarkdown(text, fallback);
}

/** 从链接导入 SKILL.md（GitHub raw / 任意 http(s) 文本）。 */
export async function fetchSkillFromUrl(input: string): Promise<SkillItem> {
  const url = String(input || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('请填写 http(s) 链接');
  const response = await session.defaultSession.fetch(url, {
    method: 'GET',
    headers: { accept: 'text/plain, text/markdown, */*' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  const text = await response.text();
  if (text.length > 200_000) throw new Error('SKILL.md 太大（超过 200KB）');
  const fallback = url.split('/').pop()?.replace(/\.md$/i, '') || '导入技能';
  return parseSkillMarkdown(text, decodeURIComponent(fallback));
}

/** 从文件夹里批量读取 SKILL.md（只扫一层，避免误读整盘）。 */
export function readSkillFolder(folder: string): SkillItem[] {
  const items: SkillItem[] = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/^SKILL\.md$/i.test(entry.name)) continue;
    items.push(readSkillFile(folder + '/' + entry.name));
  }
  return items;
}

export function skillPrompt(settings: AppSettings, skillIds?: string[]): string {
  if (!settings.skills.enabled) return '';
  const enabled = settings.skills.items.filter((item) => item.enabled && item.body.trim());
  const items = Array.isArray(skillIds)
    ? enabled.filter((item) => skillIds.includes(item.id))
    : enabled;
  if (!items.length) return '';
  const menu = items.map((item) => `- ${item.name}：${item.description || '（无描述）'}`).join('\n');
  let budget = 12000;
  const bodies: string[] = [];
  for (const item of items) {
    if (budget <= 0) break;
    const body = item.body.slice(0, Math.min(4000, budget));
    budget -= body.length;
    bodies.push(`### ${item.name}\n${body}`);
  }
  return [
    '',
    '【可用技能】',
    '如果用户的问题明显匹配某个技能，请按对应技能正文执行：',
    menu,
    '',
    '【技能正文】',
    bodies.join('\n\n')
  ].join('\n');
}
