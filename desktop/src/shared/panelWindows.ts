/** 独立面板窗口的持久化信息。 */
export interface DetachedPanelInfo {
  /** 侧栏 Section：subtitles / summary / chat / plugin:<id>:<panel> */
  section: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
}

export const PANEL_WINDOW_DEFAULT = { width: 380, height: 640 };
export const PANEL_WINDOW_MIN = { width: 300, height: 260 };
export const PANEL_WINDOW_LIMIT = 12;

/** 面板标题：插件面板由渲染层传入，这里只做兜底。 */
export function panelTitleOf(section: string): string {
  if (section === 'subtitles') return '字幕';
  if (section === 'summary') return '总结';
  if (section === 'chat') return '对话';
  if (section === 'settings') return '设置';
  if (section === 'library') return '库';
  if (section.startsWith('plugin:')) return '插件面板';
  if (section.startsWith('web:')) return '侧栏网页';
  return section;
}
