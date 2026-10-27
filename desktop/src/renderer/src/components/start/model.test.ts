import { describe, expect, it } from 'vitest';
import { parseShortcutLines } from './model';

describe('parseShortcutLines', () => {
  it('支持名称 + 网址、逗号、竖线与纯网址', () => {
    const result = parseShortcutLines(
      [
        '哔哩哔哩 https://www.bilibili.com',
        '知乎,https://www.zhihu.com',
        'GitHub | https://github.com',
        'https://www.runoob.com'
      ].join('\n'),
      '常用'
    );
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ label: '哔哩哔哩', url: 'https://www.bilibili.com' });
    expect(result[1]).toMatchObject({ label: '知乎', url: 'https://www.zhihu.com' });
    expect(result[2]).toMatchObject({ label: 'GitHub', url: 'https://github.com' });
    expect(result[3]).toMatchObject({ label: 'runoob.com', group: '常用' });
  });

  it('忽略空行、注释与重复网址，没有协议时补 https', () => {
    const result = parseShortcutLines(
      ['# 注释', '', 'MDN developer.mozilla.org', 'MDN2 https://developer.mozilla.org'].join('\n'),
      '学习'
    );
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://developer.mozilla.org');
    expect(result[0].group).toBe('学习');
  });

  it('没有网址的行会被跳过', () => {
    expect(parseShortcutLines('只有名称\n随便写点什么')).toHaveLength(0);
  });
});

import {
  buildStartBackup,
  bumpUsage,
  mergeShortcuts,
  parseStartBackup,
  topUsed
} from './model';

describe('起始页备份', () => {
  it('导出后可以原样解析，且过滤无效网址', () => {
    const backup = buildStartBackup({
      shortcuts: [
        { id: 'a', label: 'B 站', url: 'bilibili.com', group: '常用' },
        { id: 'b', label: '坏链接', url: 'javascript:alert(1)', group: '常用' }
      ],
      wallpaper: 'mint',
      minimal: true,
      city: '杭州'
    });
    expect(backup.app).toBe('shizi-start');
    expect(backup.shortcuts).toHaveLength(1);
    expect(backup.shortcuts[0].url).toBe('https://bilibili.com/');

    const parsed = parseStartBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.shortcuts[0].label).toBe('B 站');
    expect(parsed.data.prefs.city).toBe('杭州');
    expect(parsed.data.prefs.minimal).toBe(true);
  });

  it('拒绝非本应用的备份与非 JSON', () => {
    expect(parseStartBackup('not json').ok).toBe(false);
    expect(parseStartBackup(JSON.stringify({ app: 'other', shortcuts: [] })).ok).toBe(false);
    expect(
      parseStartBackup(JSON.stringify({ app: 'shizi-start', shortcuts: [{ label: 'x', url: '' }] }))
        .ok
    ).toBe(false);
  });

  it('合并时按网址去重并保序', () => {
    const current = [{ id: 'a', label: 'A', url: 'https://a.com/' }];
    const merged = mergeShortcuts(current, [
      { id: 'a2', label: 'A2', url: 'https://a.com' },
      { id: 'b', label: 'B', url: 'https://b.com/' }
    ]);
    expect(merged.map((item) => item.label)).toEqual(['A', 'B']);
  });
});

describe('使用次数', () => {
  it('bumpUsage 累加并封顶，topUsed 按次数排序', () => {
    let usage = {};
    usage = bumpUsage(usage, 'a');
    usage = bumpUsage(usage, 'a');
    usage = bumpUsage(usage, 'b');
    expect(usage).toEqual({ a: 2, b: 1 });
    const top = topUsed(
      [
        { id: 'a', label: 'A', url: 'https://a.com/' },
        { id: 'b', label: 'B', url: 'https://b.com/' },
        { id: 'c', label: 'C', url: 'https://c.com/' }
      ],
      usage,
      8
    );
    expect(top.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
