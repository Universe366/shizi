import type { PanelLayout } from './types';

/**
 * 侧栏面板布局。
 *
 * 内置面板与插件面板共用一套 key：
 *   subtitles / summary / chat / plugin:<pluginId>:<panelId>
 * order 只记录用户显式排过的顺序，没出现在里面的按自然顺序跟在后面。
 */

export const BUILTIN_PANELS = [
  { id: 'subtitles', title: '字幕' },
  { id: 'summary', title: '总结' },
  { id: 'chat', title: '对话' }
] as const;

export type BuiltinPanelId = (typeof BUILTIN_PANELS)[number]['id'];

export const MAX_PANEL_ORDER = 60;

const PANEL_KEY_RE = /^(subtitles|summary|chat|plugin:[a-z0-9][a-z0-9._-]{1,63}:[a-z0-9][a-z0-9._-]{0,39})$/;

export function isPanelKey(value: unknown): value is string {
  return typeof value === 'string' && PANEL_KEY_RE.test(value);
}

function cleanList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of input) {
    if (!isPanelKey(item) || seen.has(item) || list.length >= MAX_PANEL_ORDER) continue;
    seen.add(item);
    list.push(item);
  }
  return list;
}

export function normalizePanelLayout(input: unknown): PanelLayout {
  const raw = (input && typeof input === 'object' ? input : {}) as {
    order?: unknown;
    hidden?: unknown;
  };
  return { order: cleanList(raw.order), hidden: cleanList(raw.hidden) };
}

/** 显式顺序在前，其余按自然顺序补齐；全部被隐藏时退回完整列表，避免界面空掉。 */
export function orderPanelKeys(keys: string[], layout: PanelLayout | undefined): string[] {
  const unique = [...new Set(keys)];
  const hidden = new Set(layout?.hidden || []);
  const visible = unique.filter((key) => !hidden.has(key));
  const pool = visible.length ? visible : unique;
  const rank = new Map<string, number>();
  (layout?.order || []).forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index);
  });
  return [...pool].sort((a, b) => {
    const left = rank.get(a);
    const right = rank.get(b);
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });
}

/** 把当前所有面板补齐进 order，供设置页做上下移动。 */
export function mergePanelOrder(order: string[], keys: string[]): string[] {
  const unique = [...new Set(keys)];
  const kept = order.filter((key) => unique.includes(key));
  return [...kept, ...unique.filter((key) => !kept.includes(key))];
}

export function panelLabel(key: string, pluginLabels: Record<string, string> = {}): string {
  const builtin = BUILTIN_PANELS.find((panel) => panel.id === key);
  if (builtin) return builtin.title;
  return pluginLabels[key] || key;
}
