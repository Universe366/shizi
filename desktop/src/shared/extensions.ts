import type { BrowserExtensionItem } from './types';

/**
 * 用户可添加的扩展数量上限。
 * 每个扩展都会在内置浏览器的 session 里挂一个后台脚本，几十个就会明显拖慢启动。
 */
export const BROWSER_EXTENSION_LIMIT = 40;

const MAX_PATH = 600;

function cleanText(value: unknown, limit: number): string {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, limit);
}

/** Windows 盘符路径、UNC 路径或类 Unix 绝对路径都算合法；相对路径一律丢弃。 */
export function isAbsoluteExtensionPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

/**
 * 规范化扩展列表：设置文件可能被手改，坏条目直接丢弃，不抛错。
 * 同一路径只保留第一次出现的条目（Windows 路径大小写不敏感）。
 */
export function normalizeBrowserExtensions(input: unknown): BrowserExtensionItem[] {
  if (!Array.isArray(input)) return [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();
  const items: BrowserExtensionItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || items.length >= BROWSER_EXTENSION_LIMIT) continue;
    const item = raw as Partial<BrowserExtensionItem>;
    const itemPath = cleanText(item.path, MAX_PATH).replace(/[\\/]+$/, '');
    if (!itemPath || !isAbsoluteExtensionPath(itemPath)) continue;
    const pathKey = itemPath.toLowerCase();
    if (seenPaths.has(pathKey)) continue;
    const id = cleanText(item.id, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || seenIds.has(id)) continue;
    seenPaths.add(pathKey);
    seenIds.add(id);
    items.push({
      id,
      path: itemPath,
      name: cleanText(item.name, 80) || '未命名扩展',
      version: cleanText(item.version, 40),
      manifestVersion: Number(item.manifestVersion) === 2 ? 2 : 3,
      enabled: item.enabled !== false,
      addedAt: Number(item.addedAt) || 0
    });
  }
  return items;
}
