import { describe, expect, it } from 'vitest';
import {
  actionForStroke,
  duplicateShortcuts,
  effectiveShortcuts
} from './shortcuts';
import {
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  prettyShortcut,
  strokeFromEvent
} from './shortcutKeys';

const stroke = (patch: Partial<Parameters<typeof formatShortcut>[0]>) => ({
  code: 'KeyP',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...patch
});

describe('shortcutKeys', () => {
  it('格式化 / 解析往返一致', () => {
    const value = formatShortcut(stroke({ ctrl: true, shift: true, code: 'Digit3' }));
    expect(value).toBe('Ctrl+Shift+Digit3');
    expect(parseShortcut(value)).toEqual({
      code: 'Digit3',
      ctrl: true,
      alt: false,
      shift: true,
      meta: false
    });
  });

  it('展示用标签处理符号键', () => {
    expect(prettyShortcut('Ctrl+Comma')).toBe('Ctrl + ,');
    expect(prettyShortcut('Ctrl+Shift+Digit3')).toBe('Ctrl + Shift + 3');
  });

  it('用 code 匹配，Shift+3 的 key 变化不影响', () => {
    const event = strokeFromEvent({ code: 'Digit3', ctrlKey: true, shiftKey: true });
    expect(matchesShortcut(event, 'Ctrl+Shift+Digit3')).toBe(true);
    expect(matchesShortcut(event, 'Ctrl+Digit3')).toBe(false);
  });

  it('拒绝非法组合', () => {
    expect(parseShortcut('Ctrl+Shift+')).toBeNull();
    expect(parseShortcut('Ctrl+NotAKey')).toBeNull();
  });
});

describe('shortcut actions', () => {
  it('自定义值生效，非法值回退默认', () => {
    const map = effectiveShortcuts({ 'new-tab': 'Alt+KeyN', find: 'bad' });
    expect(map['new-tab']).toBe('Alt+KeyN');
    expect(map.find).toBe('Ctrl+KeyF');
  });

  it('重复绑定会被找出来', () => {
    const map = effectiveShortcuts({ 'new-tab': 'Ctrl+KeyF' });
    const groups = duplicateShortcuts(map);
    expect(groups.some((ids) => ids.includes('new-tab') && ids.includes('find'))).toBe(true);
  });

  it('网页焦点不会触发仅界面的动作', () => {
    const map = effectiveShortcuts();
    const event = strokeFromEvent({ code: 'KeyT', ctrlKey: true });
    expect(actionForStroke(event, map, 'app')).toBe('new-tab');
    expect(actionForStroke(event, map, 'page')).toBe('new-tab');
    const selection = strokeFromEvent({ code: 'KeyS', ctrlKey: true, shiftKey: true });
    expect(actionForStroke(selection, map, 'app')).toBeNull();
    expect(actionForStroke(selection, map, 'page')).toBe('ask-selection');
  });

  it('倍速动作只交给页内脚本，不由主进程转发', () => {
    const map = effectiveShortcuts();
    const event = strokeFromEvent({ code: 'ArrowRight', shiftKey: true });
    expect(map['media-faster']).toBe('Shift+ArrowRight');
    expect(actionForStroke(event, map, 'app')).toBeNull();
    expect(actionForStroke(event, map, 'page')).toBeNull();
  });
});
