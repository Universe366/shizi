import { describe, expect, it } from 'vitest';
import {
  MAX_PANEL_ORDER,
  isPanelKey,
  mergePanelOrder,
  normalizePanelLayout,
  orderPanelKeys,
  panelLabel
} from './panels';

describe('侧栏面板布局', () => {
  it('只接受内置与插件面板 key，并去重/截断', () => {
    const layout = normalizePanelLayout({
      order: ['chat', 'plugin:demo.main:main', 'bad key', 'chat', 42, 'plugin:UPPER:x'],
      hidden: ['summary', 'summary', '']
    });
    expect(layout.order).toEqual(['chat', 'plugin:demo.main:main']);
    expect(layout.hidden).toEqual(['summary']);
    expect(normalizePanelLayout(null)).toEqual({ order: [], hidden: [] });
  });

  it('显式顺序优先，其余按自然顺序补齐', () => {
    const keys = ['subtitles', 'summary', 'chat'];
    expect(orderPanelKeys(keys, { order: ['chat'], hidden: [] })).toEqual([
      'chat',
      'subtitles',
      'summary'
    ]);
    expect(orderPanelKeys(keys, undefined)).toEqual(keys);
  });

  it('隐藏项被过滤；全部隐藏时退回完整列表', () => {
    const keys = ['subtitles', 'summary', 'chat'];
    expect(orderPanelKeys(keys, { order: [], hidden: ['summary'] })).toEqual([
      'subtitles',
      'chat'
    ]);
    expect(orderPanelKeys(keys, { order: [], hidden: keys })).toEqual(keys);
  });

  it('mergePanelOrder 补齐没有出现过的面板', () => {
    expect(mergePanelOrder(['chat'], ['subtitles', 'summary', 'chat'])).toEqual([
      'chat',
      'subtitles',
      'summary'
    ]);
  });

  it('key 校验与标题兜底', () => {
    expect(isPanelKey('plugin:a.b:main')).toBe(true);
    expect(isPanelKey('plugin:a')).toBe(false);
    expect(isPanelKey('web:deepseek')).toBe(false);
    expect(panelLabel('chat')).toBe('对话');
    expect(panelLabel('plugin:a.b:main', { 'plugin:a.b:main': '示例' })).toBe('示例');
    expect(panelLabel('plugin:a.b:main')).toBe('plugin:a.b:main');
    expect(normalizePanelLayout({ order: new Array(MAX_PANEL_ORDER + 10).fill('chat') }).order)
      .toHaveLength(1);
  });
});
