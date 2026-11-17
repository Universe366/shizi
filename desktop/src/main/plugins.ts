import fs from 'node:fs';
import path from 'node:path';
import { app, protocol, session, shell } from 'electron';
import type { Result } from '../shared/types';
import {
  MAX_PLUGIN_PANELS,
  PLUGIN_DATA_LIMIT_BYTES,
  PLUGIN_FETCH_LIMIT_BYTES,
  PLUGIN_SCHEME,
  isPluginPermission,
  parsePluginManifest,
  pluginEntryUrl,
  type PluginInfo,
  type PluginManifest,
  type PluginPermission
} from '../shared/plugins';
import { loadSettings } from './settings';
import { listLibrary } from './library/videos';
import { searchLibrary } from './library/search';
import { getPageInfo } from './page';
import type { TabManager } from './tabs';

/**
 * 应用插件宿主（与浏览器扩展是两套东西）。
 *
 * 插件 = userData/plugins/<id>/ 下的静态站点 + manifest.json；
 * UI 通过自定义协议加载到 iframe，能力只走 plugins:rpc，按 manifest 的 permissions 校验。
 * 插件不能 import main、不能拿 Node，也不能改应用自己的 DOM。
 */

interface PluginRecord {
  manifest: PluginManifest;
  /** 安装后的绝对目录；早期记录可能缺这个字段。 */
  dir: string;
  enabled: boolean;
  installedAt: number;
}

interface Registry {
  version: 1;
  plugins: PluginRecord[];
}

function errorText(error: unknown): string {
  return (error as Error)?.message || String(error) || '未知错误';
}

function pluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

function registryFile(): string {
  return path.join(pluginsRoot(), 'registry.json');
}

function ensureRoot(): void {
  fs.mkdirSync(pluginsRoot(), { recursive: true });
}

function normalizeRecord(input: unknown): PluginRecord | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Partial<PluginRecord>;
  const manifest = record.manifest;
  if (!manifest || typeof manifest !== 'object' || !manifest.id) return null;
  const dir = String(record.dir || path.join(pluginsRoot(), manifest.id));
  return {
    manifest: {
      id: manifest.id,
      name: String(manifest.name || manifest.id),
      version: String(manifest.version || '0.0.0'),
      description: String(manifest.description || ''),
      author: String(manifest.author || ''),
      permissions: Array.isArray(manifest.permissions)
        ? manifest.permissions.filter(isPluginPermission)
        : [],
      panels: Array.isArray(manifest.panels) ? manifest.panels : [],
      commands: Array.isArray(manifest.commands) ? manifest.commands : []
    },
    dir,
    enabled: record.enabled !== false,
    installedAt: Number(record.installedAt) || 0
  };
}

export function readRegistry(): Registry {
  try {
    const raw = JSON.parse(fs.readFileSync(registryFile(), 'utf8')) as Partial<Registry>;
    const plugins = Array.isArray(raw.plugins)
      ? raw.plugins.map(normalizeRecord).filter((item): item is PluginRecord => Boolean(item))
      : [];
    return { version: 1, plugins };
  } catch {
    return { version: 1, plugins: [] };
  }
}

function writeRegistry(registry: Registry): void {
  ensureRoot();
  const file = registryFile();
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  } catch {
    // 备份失败不阻塞安装
  }
  fs.writeFileSync(file, JSON.stringify(registry, null, 2), 'utf8');
}

function entryFileOf(entry: string): string {
  return entry.split('?')[0].split('#')[0];
}

function verifyEntries(dir: string, manifest: PluginManifest): void {
  const entries = new Set<string>([
    ...manifest.panels.map((panel) => panel.entry),
    ...manifest.commands.map((command) => command.entry)
  ]);
  for (const entry of entries) {
    const file = path.join(dir, entryFileOf(entry));
    if (!fs.existsSync(file)) {
      throw new Error(`入口文件不存在：${entryFileOf(entry)}`);
    }
  }
}

/** 读取并校验一个插件目录（安装前检查，不写磁盘）。 */
export function readPluginDirectory(dir: string): { manifest: PluginManifest; dir: string } {
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) throw new Error('请选择插件目录，而不是文件');
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('目录里没有 manifest.json');
  const manifest = parsePluginManifest(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.panels.length && !manifest.commands.length) {
    throw new Error('插件没有声明任何面板或命令（contributes.panels / contributes.commands）');
  }
  if (manifest.panels.length > MAX_PLUGIN_PANELS) throw new Error('面板数量超过上限');
  verifyEntries(dir, manifest);
  return { manifest, dir };
}

function infoOf(record: PluginRecord): PluginInfo {
  let error = '';
  if (!record.dir || !fs.existsSync(record.dir)) error = '插件目录不存在，请重新安装';
  return {
    ...record.manifest,
    enabled: record.enabled,
    installedAt: record.installedAt,
    error
  };
}

export function listPlugins(): PluginInfo[] {
  return readRegistry()
    .plugins.map(infoOf)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/** 安装（或重装）一个插件目录：复制到 userData/plugins/<id>，原目录之后可以删除。 */
export function installPluginFromDir(sourceDir: string): Result<PluginInfo> {
  try {
    const source = path.resolve(String(sourceDir || '').trim());
    const { manifest } = readPluginDirectory(source);
    ensureRoot();
    const target = path.join(pluginsRoot(), manifest.id);
    const sameDir = source.toLowerCase() === path.resolve(target).toLowerCase();
    if (!sameDir) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(source, target, { recursive: true });
    }
    const record: PluginRecord = {
      manifest,
      dir: target,
      enabled: true,
      installedAt: Date.now()
    };
    const registry = readRegistry();
    writeRegistry({
      version: 1,
      plugins: registry.plugins
        .filter((item) => item.manifest.id !== manifest.id)
        .concat(record)
    });
    return { ok: true, data: infoOf(record) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export function setPluginEnabled(id: string, enabled: boolean): Result<PluginInfo> {
  try {
    const registry = readRegistry();
    const record = registry.plugins.find((item) => item.manifest.id === id);
    if (!record) throw new Error('插件不存在');
    record.enabled = enabled;
    writeRegistry(registry);
    return { ok: true, data: infoOf(record) };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export function removePlugin(id: string): Result<boolean> {
  try {
    const registry = readRegistry();
    const record = registry.plugins.find((item) => item.manifest.id === id);
    if (!record) throw new Error('插件不存在');
    try {
      if (record.dir) fs.rmSync(record.dir, { recursive: true, force: true });
    } catch {
      // 目录被占用时仍然移除登记，下次启动不会再加载。
    }
    writeRegistry({
      version: 1,
      plugins: registry.plugins.filter((item) => item.manifest.id !== id)
    });
    return { ok: true, data: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export function revealPlugin(id: string): Result<boolean> {
  try {
    const record = readRegistry().plugins.find((item) => item.manifest.id === id);
    if (!record) throw new Error('插件不存在');
    shell.showItemInFolder(path.join(record.dir, 'manifest.json'));
    return { ok: true, data: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/* ------------------------------ 自定义协议 ------------------------------ */

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

/** 插件页面的 CSP：脚本只能来自插件自己，网络能力必须走宿主 RPC。 */
const PLUGIN_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'"
].join('; ');

/** 必须在 app ready 之前调用。 */
export function installPluginScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

/** app ready 之后调用：按 shizi-plugin://<id>/<entry> 提供插件静态文件。 */
export function installPluginProtocol(): void {
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const pluginId = url.hostname;
      const entry = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const record = readRegistry().plugins.find(
        (item) => item.manifest.id === pluginId && item.enabled
      );
      if (!record) return new Response('plugin not found', { status: 404 });
      const baseDir = path.resolve(record.dir);
      const target = path.resolve(baseDir, entry);
      if (target !== baseDir && !target.startsWith(baseDir + path.sep)) {
        return new Response('forbidden', { status: 403 });
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return new Response('not found', { status: 404 });
      }
      const body = fs.readFileSync(target);
      const mime = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': mime,
          'content-security-policy': PLUGIN_CSP,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        }
      });
    } catch {
      return new Response('bad request', { status: 400 });
    }
  });
}

/* --------------------------------- RPC --------------------------------- */

const METHOD_PERMISSION: Record<string, PluginPermission | null> = {
  'app.info': null,
  'theme.get': null,
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.remove': 'storage',
  'library.query': 'library.read',
  'page.info': 'page.read',
  'net.fetch': 'net.fetch',
  'tabs.open': 'tabs.open'
};

function dataFile(pluginId: string): string {
  return path.join(pluginsRoot(), pluginId, 'data.json');
}

function readData(pluginId: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile(pluginId), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeData(pluginId: string, data: Record<string, unknown>): void {
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > PLUGIN_DATA_LIMIT_BYTES) {
    throw new Error(`插件数据超过 ${Math.round(PLUGIN_DATA_LIMIT_BYTES / 1024)}KB 上限`);
  }
  fs.mkdirSync(path.dirname(dataFile(pluginId)), { recursive: true });
  fs.writeFileSync(dataFile(pluginId), text, 'utf8');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function minimalVideo(video: ReturnType<typeof listLibrary>['videos'][number]) {
  return {
    id: video.id,
    title: video.title,
    owner: video.owner,
    duration: video.duration,
    cover: video.cover,
    url: video.url,
    kind: video.kind,
    updatedAt: video.updatedAt
  };
}

async function runPluginMethod(
  pluginId: string,
  manifest: PluginManifest,
  method: string,
  params: unknown,
  tabs: TabManager
): Promise<unknown> {
  const permission = METHOD_PERMISSION[method];
  if (permission === undefined) throw new Error(`不支持的方法：${method}`);
  if (permission && !manifest.permissions.includes(permission)) {
    throw new Error(`插件没有申请 ${permission} 权限`);
  }
  const input = asRecord(params);

  switch (method) {
    case 'app.info':
      return {
        name: '拾字',
        version: app.getVersion(),
        platform: process.platform,
        electron: process.versions.electron,
        chrome: process.versions.chrome
      };
    case 'theme.get': {
      const settings = loadSettings();
      return {
        theme: settings.general.theme,
        accentColor: settings.general.accentColor,
        colorScheme: settings.general.colorScheme,
        density: settings.general.density,
        fontScale: settings.general.fontScale
      };
    }
    case 'storage.get': {
      const data = readData(pluginId);
      const key = String(input.key ?? '').trim();
      if (!key) return data;
      return data[key] ?? null;
    }
    case 'storage.set': {
      const key = String(input.key ?? '').trim().slice(0, 120);
      if (!key) throw new Error('storage.set 需要 key');
      const data = readData(pluginId);
      data[key] = input.value ?? null;
      writeData(pluginId, data);
      return true;
    }
    case 'storage.remove': {
      const key = String(input.key ?? '').trim();
      if (!key) throw new Error('storage.remove 需要 key');
      const data = readData(pluginId);
      delete data[key];
      writeData(pluginId, data);
      return true;
    }
    case 'library.query': {
      const limit = Math.min(100, Math.max(1, Math.round(Number(input.limit) || 20)));
      const query = String(input.query ?? '').trim();
      if (query) {
        const result = searchLibrary(query, Math.min(60, limit * 3));
        return {
          query,
          total: result.total,
          videos: result.videos.slice(0, limit).map(minimalVideo),
          matches: result.matches.slice(0, limit).map((match) => ({
            videoId: match.videoId,
            title: match.title,
            owner: match.owner,
            start: match.start,
            text: match.text.slice(0, 500)
          }))
        };
      }
      const list = listLibrary('updated');
      return {
        total: list.total,
        videos: list.videos.slice(0, limit).map(minimalVideo)
      };
    }
    case 'page.info': {
      const webContents = tabs.activeWebContents();
      if (!webContents || webContents.isDestroyed()) return null;
      const info = await getPageInfo(webContents);
      if (!info) return null;
      return {
        title: info.title,
        url: info.url,
        kind: info.kind,
        bvid: info.bvid,
        cid: info.cid,
        owner: info.owner,
        duration: info.duration
      };
    }
    case 'net.fetch': {
      const target = String(input.url ?? '').trim();
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        throw new Error('net.fetch 需要合法的 http(s) 地址');
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('只允许 http/https');
      const method = String(input.method || 'GET').toUpperCase();
      if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(method)) throw new Error('不支持的请求方法');
      const headers = asRecord(input.headers) as Record<string, string>;
      const body = typeof input.body === 'string' ? input.body : undefined;
      const response = await session.defaultSession.fetch(parsed.toString(), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(15000)
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > PLUGIN_FETCH_LIMIT_BYTES) {
        throw new Error(`响应超过 ${Math.round(PLUGIN_FETCH_LIMIT_BYTES / 1024 / 1024)}MB 上限`);
      }
      return {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        text: buffer.toString('utf8')
      };
    }
    case 'tabs.open': {
      const target = String(input.url ?? '').trim();
      if (!/^https?:\/\//i.test(target)) throw new Error('tabs.open 只接受 http(s) 地址');
      const tabId = await tabs.create(target);
      return { tabId };
    }
    default:
      throw new Error(`不支持的方法：${method}`);
  }
}

/** 渲染进程转发插件 iframe 的 RPC；权限校验在这里做，不信任插件侧。 */
export async function pluginRpc(
  pluginId: string,
  method: string,
  params: unknown,
  tabs: TabManager
): Promise<Result<unknown>> {
  try {
    const record = readRegistry().plugins.find((item) => item.manifest.id === pluginId);
    if (!record) throw new Error('插件不存在');
    if (!record.enabled) throw new Error('插件未启用');
    const value = await runPluginMethod(pluginId, record.manifest, String(method || ''), params, tabs);
    return { ok: true, data: value };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** 面板/命令入口 URL（渲染层用来设置 iframe src）。 */
export function pluginUrl(pluginId: string, entry: string): string {
  return pluginEntryUrl(pluginId, entry);
}
