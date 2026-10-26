// 桌面端快捷键：可自定义的动作 + 固定键位目录。
// 设置页从这里渲染，主进程/渲染层用同一份匹配逻辑，避免“文档写了但没实现”。

import {
  matchesShortcut,
  parseShortcut,
  prettyShortcut,
  type KeyStroke
} from './shortcutKeys';

export type ShortcutActionId =
  | 'new-tab'
  | 'close-tab'
  | 'reopen-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'focus-address'
  | 'find'
  | 'search'
  | 'palette'
  | 'settings'
  | 'reader'
  | 'bookmark'
  | 'section-subtitles'
  | 'section-summary'
  | 'section-chat'
  | 'section-library'
  | 'tab-search'
  | 'ask-selection'
  | 'reload';

export type ShortcutScope = 'app' | 'page' | 'both';

export interface ShortcutAction {
  id: ShortcutActionId;
  label: string;
  defaultShortcut: string;
  /** app=只有主界面焦点；page=只有网页焦点；both=两者都生效 */
  scope: ShortcutScope;
  group: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'new-tab', label: '新建标签页', defaultShortcut: 'Ctrl+KeyT', scope: 'both', group: '标签页' },
  { id: 'close-tab', label: '关闭当前标签页', defaultShortcut: 'Ctrl+KeyW', scope: 'both', group: '标签页' },
  { id: 'reopen-tab', label: '重新打开关闭的标签页', defaultShortcut: 'Ctrl+Shift+KeyT', scope: 'both', group: '标签页' },
  { id: 'next-tab', label: '下一个标签页', defaultShortcut: 'Ctrl+Tab', scope: 'both', group: '标签页' },
  { id: 'prev-tab', label: '上一个标签页', defaultShortcut: 'Ctrl+Shift+Tab', scope: 'both', group: '标签页' },
  { id: 'focus-address', label: '聚焦地址栏', defaultShortcut: 'Ctrl+KeyL', scope: 'both', group: '地址栏与搜索' },
  { id: 'find', label: '页内查找', defaultShortcut: 'Ctrl+KeyF', scope: 'both', group: '地址栏与搜索' },
  { id: 'search', label: '全局搜索', defaultShortcut: 'Ctrl+KeyK', scope: 'both', group: '地址栏与搜索' },
  { id: 'palette', label: '命令面板', defaultShortcut: 'Ctrl+Shift+KeyP', scope: 'both', group: '地址栏与搜索' },
  { id: 'settings', label: '打开设置', defaultShortcut: 'Ctrl+Comma', scope: 'both', group: '地址栏与搜索' },
  { id: 'reader', label: '阅读模式', defaultShortcut: 'Alt+KeyR', scope: 'both', group: '页面' },
  { id: 'bookmark', label: '收藏当前页', defaultShortcut: 'Ctrl+KeyD', scope: 'both', group: '页面' },
  { id: 'reload', label: '刷新页面', defaultShortcut: 'Ctrl+KeyR', scope: 'both', group: '页面' },
  { id: 'ask-selection', label: '选中即问', defaultShortcut: 'Ctrl+Shift+KeyS', scope: 'page', group: '页面' },
  { id: 'tab-search', label: '标签页 / 历史面板', defaultShortcut: 'Ctrl+Shift+KeyA', scope: 'both', group: '面板' },
  { id: 'section-subtitles', label: '打开面板：字幕', defaultShortcut: 'Ctrl+Shift+Digit1', scope: 'both', group: '面板' },
  { id: 'section-summary', label: '打开面板：总结', defaultShortcut: 'Ctrl+Shift+Digit2', scope: 'both', group: '面板' },
  { id: 'section-chat', label: '打开面板：对话', defaultShortcut: 'Ctrl+Shift+Digit3', scope: 'both', group: '面板' },
  { id: 'section-library', label: '打开面板：库', defaultShortcut: 'Ctrl+Shift+Digit4', scope: 'both', group: '面板' }
];

const byId = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

export function shortcutAction(id: string): ShortcutAction | null {
  return byId.get(id as ShortcutActionId) || null;
}

/** 合并用户覆盖值；非法/未知项忽略，保证永远可用。 */
export function effectiveShortcuts(
  overrides?: Record<string, string> | null
): Record<ShortcutActionId, string> {
  const map = {} as Record<ShortcutActionId, string>;
  for (const action of SHORTCUT_ACTIONS) {
    const custom = overrides?.[action.id];
    map[action.id] = custom && parseShortcut(custom) ? custom : action.defaultShortcut;
  }
  return map;
}

/** 找出重复绑定；返回冲突的动作 id 分组。 */
export function duplicateShortcuts(
  map: Record<ShortcutActionId, string>
): ShortcutActionId[][] {
  const groups = new Map<string, ShortcutActionId[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const key = map[action.id];
    const list = groups.get(key) || [];
    list.push(action.id);
    groups.set(key, list);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

/** 根据一次按键找到动作；scope 表示当前焦点环境。 */
export function actionForStroke(
  stroke: KeyStroke | null,
  map: Record<ShortcutActionId, string>,
  scope: 'app' | 'page'
): ShortcutActionId | null {
  for (const action of SHORTCUT_ACTIONS) {
    if (action.scope !== 'both' && action.scope !== scope) continue;
    if (matchesShortcut(stroke, map[action.id])) return action.id;
  }
  return null;
}

/** 设置页展示用：把动作按分组排好。 */
export function shortcutActionGroups(): Array<{ title: string; items: ShortcutAction[] }> {
  const groups: Array<{ title: string; items: ShortcutAction[] }> = [];
  for (const action of SHORTCUT_ACTIONS) {
    let group = groups.find((item) => item.title === action.group);
    if (!group) {
      group = { title: action.group, items: [] };
      groups.push(group);
    }
    group.items.push(action);
  }
  return groups;
}

export interface FixedShortcutEntry {
  keys: string;
  label: string;
}

export const FIXED_SHORTCUT_GROUPS: Array<{ title: string; items: FixedShortcutEntry[] }> = [
  {
    title: '固定键位',
    items: [
      { keys: 'Ctrl + 1 … 9', label: '跳到第 N 个标签页' },
      { keys: 'Alt + 1 … 9', label: '跳到第 N 个标签页（备用）' },
      { keys: 'Alt + ← / →', label: '后退 / 前进' },
      { keys: 'F5', label: '刷新页面' },
      { keys: 'Ctrl + = / - / 0', label: '放大 / 缩小 / 恢复 100%' },
      { keys: 'F11', label: '窗口全屏' },
      { keys: 'Esc', label: '退出网页全屏 / 关闭浮层' },
      { keys: 'Ctrl + Shift + Q', label: '退出应用' }
    ]
  },
  {
    title: '播放倍速',
    items: [
      { keys: 'Alt + Shift + ↑ / ↓', label: '提高 / 降低倍速' },
      { keys: 'Alt + Shift + 0', label: '恢复 1.0×' },
      { keys: 'Alt + Shift + S', label: '打开 / 收起倍速面板' },
      { keys: 'A / D / S（可选单键）', label: '降速 / 提速 / 复位（需在「页面与阅读」开启）' }
    ]
  },
  {
    title: '全局快捷键',
    items: [
      { keys: 'Ctrl + Alt + S', label: '框选截图并送到桌宠（可在下面开关）' },
      { keys: 'Ctrl + Shift + Space', label: '桌宠语音提问（可在下面开关）' },
      { keys: 'Ctrl + Shift + E', label: '打开桌宠对话（可在下面开关）' }
    ]
  }
];

export function shortcutDisplay(accel: string): string {
  return prettyShortcut(accel);
}
