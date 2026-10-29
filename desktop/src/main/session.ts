import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { TabGroup } from '../shared/types';

/**
 * 标签页会话：退出/崩溃后下次启动能恢复。
 *
 * 只存 URL / 标题 / 当前激活地址，不存页面状态；恢复时按顺序重建 WebContentsView。
 * 文件放 userData/session.json，跟数据目录一起迁移。
 */
export interface SessionTab {
  url: string;
  title: string;
  groupId?: string;
  pinned?: boolean;
}

export interface SessionState {
  version: 1;
  activeUrl: string;
  tabs: SessionTab[];
  groups?: TabGroup[];
}

const VERSION = 1;
const MAX_TABS = 40;

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

export function loadSession(): SessionState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    if (!raw || raw.version !== VERSION || !Array.isArray(raw.tabs)) return null;
    const tabs = raw.tabs
      .filter((tab: unknown): tab is SessionTab => {
        const value = tab as SessionTab;
        return Boolean(value && typeof value.url === 'string' && /^https?:\/\//i.test(value.url));
      })
      .slice(0, MAX_TABS)
      .map((tab: SessionTab) => ({
        url: tab.url,
        title: String(tab.title || ''),
        groupId: typeof tab.groupId === 'string' ? tab.groupId : undefined,
        pinned: tab.pinned === true
      }));
    const groups = Array.isArray(raw.groups)
      ? (raw.groups as unknown[])
          .filter((group): group is TabGroup => Boolean(group && typeof group === 'object'))
          .map((group) => ({
            id: String(group.id || ''),
            name: String(group.name || '分组').slice(0, 24),
            color: (['blue', 'green', 'red', 'yellow', 'purple', 'gray'] as const).includes(
              group.color as never
            )
              ? group.color
              : 'blue',
            collapsed: group.collapsed === true
          }))
          .filter((group) => group.id)
      : [];
    if (!tabs.length) return null;
    const activeUrl = tabs.some((tab: SessionTab) => tab.url === raw.activeUrl)
      ? String(raw.activeUrl)
      : tabs[tabs.length - 1].url;
    return { version: VERSION, activeUrl, tabs, groups };
  } catch {
    return null;
  }
}

export function saveSession(tabs: SessionTab[], activeUrl: string, groups: TabGroup[] = []): void {
  try {
    const clean = tabs
      .filter((tab) => /^https?:\/\//i.test(tab.url))
      .slice(0, MAX_TABS)
      .map((tab) => ({
        url: tab.url,
        title: String(tab.title || ''),
        groupId: tab.groupId,
        pinned: tab.pinned === true
      }));
    if (!clean.length) {
      // 用户主动关掉所有标签后退出：必须清掉旧会话，否则下次启动会把它们恢复回来。
      clearSession();
      return;
    }
    const file = sessionFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    const state: SessionState = { version: VERSION, activeUrl, tabs: clean, groups };
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temp, file);
  } catch (error) {
    console.warn('[session] 保存失败:', (error as Error).message);
  }
}

export function clearSession(): void {
  try {
    fs.rmSync(sessionFile(), { force: true });
  } catch {
    // ignore
  }
}
