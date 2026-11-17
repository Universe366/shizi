import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { app, session, shell } from 'electron';
import type {
  BrowserExtensionItem,
  BrowserExtensionsState,
  BrowserExtensionStatus,
  Result
} from '../shared/types';
import { BROWSER_EXTENSION_LIMIT, normalizeBrowserExtensions } from '../shared/extensions';
import { loadSettings, saveSettings } from './settings';
import { archivePayload, extractZipTo } from './zip';

/**
 * 浏览器扩展宿主。
 *
 * 只支持「解压目录」形态（Electron 的 session.loadExtension 不支持 .crx），
 * 扩展加载进默认 session，也就是内置标签页；侧栏网页用的是独立 partition，不加载扩展。
 * 任何单个扩展加载失败都只记录错误，不影响启动和已有功能。
 */

interface RuntimeState {
  chromeId: string;
  error: string;
}

const runtime = new Map<string, RuntimeState>();

export interface ExtensionManifestInfo {
  name: string;
  version: string;
  manifestVersion: 2 | 3;
}

function messageOf(error: unknown): string {
  return (error as Error)?.message || String(error) || '加载失败';
}

/** 读取并校验扩展目录里的 manifest.json；失败时抛出可直接展示给用户的中文错误。 */
export function readExtensionManifest(dir: string): ExtensionManifestInfo {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new Error('目录不存在或无法访问');
  }
  if (!stat.isDirectory()) throw new Error('请选择扩展目录，而不是文件');
  const manifestPath = path.join(dir, 'manifest.json');
  let text: string;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error('目录里没有 manifest.json，请选择解压后的扩展目录');
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    throw new Error('manifest.json 不是合法 JSON');
  }
  const manifestVersion = Number(raw?.manifest_version);
  if (manifestVersion !== 2 && manifestVersion !== 3) {
    throw new Error('只支持 manifest_version 2 或 3 的扩展');
  }
  let name = String(raw?.name ?? '').trim();
  // __MSG_xxx__ 需要 i18n 求值，加载前拿不到；先用目录名兜底。
  if (!name || /^__MSG_/i.test(name)) name = path.basename(dir);
  const version = String(raw?.version ?? '').trim();
  if (!version) throw new Error('manifest.json 缺少 version');
  return {
    name: name.slice(0, 80),
    version: version.slice(0, 40),
    manifestVersion: manifestVersion === 2 ? 2 : 3
  };
}

function newExtensionId(): string {
  return `ext_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
}

function statusOf(item: BrowserExtensionItem): BrowserExtensionStatus {
  const state = runtime.get(item.id);
  return {
    ...item,
    loaded: Boolean(state?.chromeId),
    chromeId: state?.chromeId || '',
    error: state?.error || ''
  };
}

export function listBrowserExtensions(): BrowserExtensionsState {
  const settings = loadSettings();
  return {
    enabled: settings.extensions.enabled !== false,
    items: settings.extensions.items.map(statusOf)
  };
}

async function loadOne(item: BrowserExtensionItem): Promise<void> {
  // 先校验 manifest，避免把 Electron 的英文异常直接甩给用户。
  readExtensionManifest(item.path);
  const existing = runtime.get(item.id);
  if (existing?.chromeId) return;
  const extension = await session.defaultSession.loadExtension(item.path, {
    allowFileAccess: true
  });
  runtime.set(item.id, { chromeId: extension.id, error: '' });
}

function unloadOne(item: BrowserExtensionItem): void {
  const state = runtime.get(item.id);
  if (state?.chromeId) {
    try {
      session.defaultSession.removeExtension(state.chromeId);
    } catch {
      // 扩展可能已经被 Chromium 自己卸载，忽略。
    }
  }
  runtime.delete(item.id);
}

function persist(items: BrowserExtensionItem[], enabled?: boolean): void {
  const settings = loadSettings();
  saveSettings({
    ...settings,
    extensions: {
      enabled: enabled ?? settings.extensions.enabled !== false,
      items: normalizeBrowserExtensions(items)
    }
  });
}

/** 启动时调用：按设置加载所有启用的扩展；单个失败不影响其它扩展。 */
export async function loadBrowserExtensions(): Promise<void> {
  runtime.clear();
  const settings = loadSettings();
  if (settings.extensions.enabled === false) return;
  for (const item of settings.extensions.items) {
    if (!item.enabled) continue;
    try {
      await loadOne(item);
    } catch (error) {
      runtime.set(item.id, { chromeId: '', error: messageOf(error) });
      console.warn('[extensions] 加载失败', item.path, messageOf(error));
    }
  }
}

/** 添加解压目录；重复添加同一目录时只做启用，不新增条目。 */
export async function addBrowserExtension(dirInput: string): Promise<Result<BrowserExtensionStatus>> {
  try {
    const dir = path.resolve(String(dirInput || '').trim()).replace(/[\\/]+$/, '');
    if (!dir) throw new Error('没有选择目录');
    const manifest = readExtensionManifest(dir);
    const settings = loadSettings();
    const existing = settings.extensions.items.find(
      (item) => item.path.toLowerCase() === dir.toLowerCase()
    );
    if (existing) {
      if (!existing.enabled) return setBrowserExtensionEnabled(existing.id, true);
      return { ok: true, data: statusOf(existing) };
    }
    if (settings.extensions.items.length >= BROWSER_EXTENSION_LIMIT) {
      throw new Error(`最多添加 ${BROWSER_EXTENSION_LIMIT} 个扩展`);
    }
    const item: BrowserExtensionItem = {
      id: newExtensionId(),
      path: dir,
      name: manifest.name,
      version: manifest.version,
      manifestVersion: manifest.manifestVersion,
      enabled: true,
      addedAt: Date.now()
    };
    persist([...settings.extensions.items, item]);
    if (settings.extensions.enabled !== false) {
      try {
        await loadOne(item);
      } catch (error) {
        runtime.set(item.id, { chromeId: '', error: messageOf(error) });
      }
    }
    return { ok: true, data: statusOf(item) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/**
 * 从 .zip / .crx 安装扩展：解压到 userData/extensions/<随机目录>，再走目录安装流程。
 * 商店包通常是「zip 里套一层文件夹」，extractZipTo 会自动进入唯一顶层目录。
 */
export async function addBrowserExtensionFromArchive(
  fileInput: string
): Promise<Result<BrowserExtensionStatus>> {
  const file = path.resolve(String(fileInput || '').trim());
  let extractRoot = '';
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('请选择 .zip / .crx 文件');
    if (stat.size > 100 * 1024 * 1024) throw new Error('扩展包超过 100MB 上限');
    const buffer = fs.readFileSync(file);
    extractRoot = path.join(
      app.getPath('userData'),
      'extensions',
      `ext_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
    );
    const dir = extractZipTo(archivePayload(buffer), extractRoot);
    const result = await addBrowserExtension(dir);
    if (!result.ok) {
      fs.rmSync(extractRoot, { recursive: true, force: true });
    }
    return result;
  } catch (error) {
    if (extractRoot) {
      try {
        fs.rmSync(extractRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    return { ok: false, error: messageOf(error) };
  }
}

export async function setBrowserExtensionEnabled(
  id: string,
  enabled: boolean
): Promise<Result<BrowserExtensionStatus>> {
  try {
    const settings = loadSettings();
    const item = settings.extensions.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error('扩展不存在，可能已被删除');
    const next: BrowserExtensionItem = { ...item, enabled };
    persist(settings.extensions.items.map((candidate) => (candidate.id === id ? next : candidate)));
    if (!enabled) {
      unloadOne(next);
    } else if (settings.extensions.enabled !== false) {
      try {
        await loadOne(next);
      } catch (error) {
        runtime.set(next.id, { chromeId: '', error: messageOf(error) });
      }
    }
    return { ok: true, data: statusOf(next) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export function removeBrowserExtension(id: string): Result<boolean> {
  try {
    const settings = loadSettings();
    const item = settings.extensions.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error('扩展不存在');
    unloadOne(item);
    persist(settings.extensions.items.filter((candidate) => candidate.id !== id));
    return { ok: true, data: true };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** 总开关：关闭时全部卸载但保留配置，重新打开时按原列表恢复。 */
export async function setBrowserExtensionsEnabled(
  enabled: boolean
): Promise<Result<BrowserExtensionsState>> {
  try {
    const settings = loadSettings();
    persist(settings.extensions.items, enabled);
    if (!enabled) {
      for (const item of settings.extensions.items) unloadOne(item);
    } else {
      for (const item of settings.extensions.items) {
        if (!item.enabled) continue;
        try {
          await loadOne(item);
        } catch (error) {
          runtime.set(item.id, { chromeId: '', error: messageOf(error) });
        }
      }
    }
    return { ok: true, data: listBrowserExtensions() };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** 在资源管理器里定位 manifest.json，方便用户确认自己选的是哪个目录。 */
export function revealBrowserExtension(id: string): Result<boolean> {
  try {
    const item = loadSettings().extensions.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error('扩展不存在');
    shell.showItemInFolder(path.join(item.path, 'manifest.json'));
    return { ok: true, data: true };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}
