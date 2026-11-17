/**
 * 插件清单与贡献点。
 *
 * 设计目标：插件只是「一个目录 + manifest.json + 静态 UI」，主进程按声明把面板/命令挂上去；
 * 插件 UI 跑在 shizi-plugin:// 协议下的 iframe 里，不接触 Node，也不碰应用自己的 DOM。
 */

/** 自定义协议：shizi-plugin://<pluginId>/<entry> */
export const PLUGIN_SCHEME = 'shizi-plugin';

/** 插件可申请的权限；未申请的权限在 RPC 层直接拒绝。 */
export const PLUGIN_PERMISSIONS = [
  'storage',
  'library.read',
  'page.read',
  'net.fetch',
  'tabs.open'
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PLUGIN_MANIFEST_VERSION = 1;
export const MAX_PLUGIN_PANELS = 12;
export const MAX_PLUGIN_COMMANDS = 40;
export const PLUGIN_DATA_LIMIT_BYTES = 256 * 1024;
export const PLUGIN_FETCH_LIMIT_BYTES = 2 * 1024 * 1024;

export interface PluginPanelContribution {
  id: string;
  title: string;
  /** 侧栏图标（emoji 或 1–2 个汉字）。 */
  icon: string;
  /** 相对入口页面；默认 index.html。 */
  entry: string;
}

export interface PluginCommandContribution {
  id: string;
  title: string;
  hint: string;
  /** 命令页；默认 index.html?command=<id>。 */
  entry: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: PluginPermission[];
  panels: PluginPanelContribution[];
  commands: PluginCommandContribution[];
}

/** 运行期状态（目录丢失、清单坏掉都会体现在 error 里）。 */
export interface PluginInfo extends PluginManifest {
  enabled: boolean;
  installedAt: number;
  error: string;
}

export interface PluginListState {
  plugins: PluginInfo[];
}

/** 插件市场索引的一条记录。索引既可以是数组，也可以是 { plugins: [...] }。 */
export interface PluginMarketEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** 插件包 zip 的 http(s) 地址 */
  zip: string;
  homepage: string;
  tags: string[];
}

export interface PluginMarketItem extends PluginMarketEntry {
  installedVersion: string;
  updateAvailable: boolean;
}

export interface PluginMarketResult {
  entries: PluginMarketItem[];
  fetchedAt: number;
  source: string;
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const PANEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export function normalizePluginId(input: unknown): string | null {
  const id = String(input ?? '').trim().toLowerCase();
  return PLUGIN_ID_RE.test(id) ? id : null;
}

export function isPluginPermission(value: unknown): value is PluginPermission {
  return typeof value === 'string' && (PLUGIN_PERMISSIONS as readonly string[]).includes(value);
}

/** 入口文件必须是插件目录内的相对路径：不允许绝对路径、盘符、.. 和反斜杠。 */
export function normalizePluginEntry(input: unknown, fallback: string): string {
  let entry = String(input ?? '').trim().replace(/\\/g, '/');
  if (!entry) return fallback;
  entry = entry.replace(/^\.\//, '').replace(/\/+/g, '/');
  if (!entry || entry.length > 200) return fallback;
  if (entry.startsWith('/') || /^[a-zA-Z]:/.test(entry)) return fallback;
  const segments = entry.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return fallback;
  return entry;
}

function textOf(value: unknown, limit: number): string {
  return String(value ?? '').trim().slice(0, limit);
}

/**
 * 解析并校验 manifest.json。抛出的错误信息直接展示给用户，所以用中文说明哪里不对。
 */
export function parsePluginManifest(source: string): PluginManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(String(source ?? '').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('manifest.json 不是合法 JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('manifest.json 顶层必须是一个对象');
  }
  const record = raw as Record<string, unknown>;
  const id = normalizePluginId(record.id);
  if (!id) throw new Error('插件 id 只能用小写字母、数字、点、下划线或短横线（2–64 位）');
  const name = textOf(record.name, 80);
  if (!name) throw new Error('manifest.json 缺少 name');
  const version = textOf(record.version, 40) || '0.0.0';
  const permissions = Array.isArray(record.permissions)
    ? [...new Set(record.permissions.filter(isPluginPermission))]
    : [];

  const contributes =
    record.contributes && typeof record.contributes === 'object'
      ? (record.contributes as Record<string, unknown>)
      : {};

  const panels: PluginPanelContribution[] = [];
  const rawPanels = Array.isArray(contributes.panels) ? contributes.panels : [];
  for (const item of rawPanels.slice(0, MAX_PLUGIN_PANELS)) {
    if (!item || typeof item !== 'object') continue;
    const panel = item as Record<string, unknown>;
    const panelId = textOf(panel.id, 40).toLowerCase();
    if (!PANEL_ID_RE.test(panelId)) continue;
    if (panels.some((existing) => existing.id === panelId)) continue;
    panels.push({
      id: panelId,
      title: textOf(panel.title, 40) || name,
      icon: textOf(panel.icon, 8) || '🧩',
      entry: normalizePluginEntry(panel.entry, 'index.html')
    });
  }

  const commands: PluginCommandContribution[] = [];
  const rawCommands = Array.isArray(contributes.commands) ? contributes.commands : [];
  for (const item of rawCommands.slice(0, MAX_PLUGIN_COMMANDS)) {
    if (!item || typeof item !== 'object') continue;
    const command = item as Record<string, unknown>;
    const commandId = textOf(command.id, 60).toLowerCase();
    if (!PANEL_ID_RE.test(commandId)) continue;
    if (commands.some((existing) => existing.id === commandId)) continue;
    commands.push({
      id: commandId,
      title: textOf(command.title, 60) || commandId,
      hint: textOf(command.hint, 120),
      entry: normalizePluginEntry(command.entry, `index.html?command=${commandId}`)
    });
  }

  return {
    id,
    name,
    version,
    description: textOf(record.description, 200),
    author: textOf(record.author, 80),
    permissions,
    panels,
    commands
  };
}

function httpUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return /^https?:$/.test(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

/** 解析市场索引；坏条目直接丢弃，保证一个坏插件不会让整个市场不可用。 */
export function parsePluginMarket(source: string): PluginMarketEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(String(source ?? '').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('市场索引不是合法 JSON');
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { plugins?: unknown }).plugins)
      ? ((raw as { plugins: unknown[] }).plugins)
      : [];
  const seen = new Set<string>();
  const entries: PluginMarketEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || entries.length >= 200) continue;
    const record = item as Record<string, unknown>;
    const id = normalizePluginId(record.id);
    if (!id || seen.has(id)) continue;
    const zip = httpUrl(record.zip ?? record.url);
    if (!zip) continue;
    const name = String(record.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    seen.add(id);
    entries.push({
      id,
      name,
      version: String(record.version ?? '').trim().slice(0, 40) || '0.0.0',
      description: String(record.description ?? '').trim().slice(0, 200),
      author: String(record.author ?? '').trim().slice(0, 80),
      zip,
      homepage: httpUrl(record.homepage),
      tags: Array.isArray(record.tags)
        ? record.tags.map((tag) => String(tag).trim().slice(0, 20)).filter(Boolean).slice(0, 8)
        : []
    });
  }
  return entries;
}

/** 合并已安装版本，标出可更新的条目。 */
export function mergeMarketItems(
  entries: PluginMarketEntry[],
  installed: Array<{ id: string; version: string }>
): PluginMarketItem[] {
  const versions = new Map(installed.map((item) => [item.id, item.version]));
  return entries.map((entry) => {
    const installedVersion = versions.get(entry.id) || '';
    return {
      ...entry,
      installedVersion,
      updateAvailable: Boolean(installedVersion) && installedVersion !== entry.version
    };
  });
}

/** 面板在 Sidebar 里的 Section key：plugin:<pluginId>:<panelId>。 */
export function pluginPanelSection(pluginId: string, panelId: string): `plugin:${string}` {
  return `plugin:${pluginId}:${panelId}`;
}

export function parsePluginSection(
  section: string
): { pluginId: string; panelId: string } | null {
  const match = /^plugin:([^:]+):(.+)$/.exec(section);
  if (!match) return null;
  return { pluginId: match[1], panelId: match[2] };
}

/** 插件 UI 的加载地址；只拼接已经校验过的相对入口。 */
export function pluginEntryUrl(pluginId: string, entry: string): string {
  const safe = normalizePluginEntry(entry, 'index.html');
  return `${PLUGIN_SCHEME}://${pluginId}/${safe}`;
}
