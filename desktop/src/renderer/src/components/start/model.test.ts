import { describe, expect, it, vi } from 'vitest';
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

import { normalizeTags, topTags, filterByTag, matchShortcut } from './model';

describe('标签', () => {
  it('归一化：支持逗号/空格、去重、最多 6 个', () => {
    expect(normalizeTags('AI, 工具、AI  学习')).toEqual(['AI', '工具', '学习']);
    expect(normalizeTags('a b c d e f g h')).toHaveLength(6);
    expect(normalizeTags(['x', 'x', ' '])).toEqual(['x']);
  });

  it('统计与筛选', () => {
    const items = [
      { id: 'a', label: 'A', url: 'https://a.com/', tags: ['AI', '工具'] },
      { id: 'b', label: 'B', url: 'https://b.com/', tags: ['AI'] }
    ];
    expect(topTags(items, 5)[0]).toEqual({ tag: 'AI', count: 2 });
    expect(filterByTag(items, 'ai').map((item) => item.id)).toEqual(['a', 'b']);
    expect(filterByTag(items, '工具').map((item) => item.id)).toEqual(['a']);
  });

  it('搜索可以命中描述与标签', () => {
    const item = { id: 'a', label: 'A', url: 'https://a.com/', desc: '中文识别', tags: ['语音'] };
    expect(matchShortcut(item, '识别')).toBe(true);
    expect(matchShortcut(item, '语音')).toBe(true);
    expect(matchShortcut(item, '不存在')).toBe(false);
  });
});

import { autofillShortcuts, shouldAutofillLabel } from './model';

describe('批量自动补全', () => {
  it('只补名称还是域名的条目，失败保留原值', async () => {
    const items = [
      { id: 'a', label: 'a.com', url: 'https://a.com/' },
      { id: 'b', label: '自己起的名字', url: 'https://b.com/' },
      { id: 'c', label: 'c.com', url: 'https://c.com/' }
    ];
    const probe = vi.fn(async (url: string) => {
      if (url.includes('c.com')) throw new Error('boom');
      return { title: '站点标题', description: '站点描述' };
    });
    expect(shouldAutofillLabel('a.com', 'https://a.com/')).toBe(true);
    expect(shouldAutofillLabel('自己起的名字', 'https://b.com/')).toBe(false);
    const result = await autofillShortcuts(items, probe);
    expect(result.filled).toBe(1);
    expect(result.items[0]).toMatchObject({ label: '站点标题', desc: '站点描述' });
    expect(result.items[1].label).toBe('自己起的名字');
    expect(result.items[2].label).toBe('c.com');
  });
});
