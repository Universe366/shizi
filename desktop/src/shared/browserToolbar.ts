import type { BrowserToolbarSettings } from './types';

export const DEFAULT_BROWSER_TOOLBAR: BrowserToolbarSettings = {
  back: true,
  forward: true,
  reload: true,
  engine: true,
  speed: true,
  bookmark: true,
  library: true,
  home: true,
  settings: true,
  menu: true
};

export function normalizeBrowserToolbar(input: unknown): BrowserToolbarSettings {
  const raw = (input || {}) as Partial<BrowserToolbarSettings>;
  const next = { ...DEFAULT_BROWSER_TOOLBAR };
  for (const key of Object.keys(next) as Array<keyof BrowserToolbarSettings>) {
    if (typeof raw[key] === 'boolean') next[key] = raw[key] as boolean;
  }
  // 主菜单是兜底入口，至少保留一个可打开设置的按钮。
  if (!next.settings && !next.menu) next.menu = true;
  return next;
}
