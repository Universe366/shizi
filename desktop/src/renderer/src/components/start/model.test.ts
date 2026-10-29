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
import { lunarDate } from './model';

describe('lunarDate', () => {
  it('把农历日期转成干支年 + 月日', () => {
    const value = lunarDate(new Date(2026, 9, 29));
    expect(value).not.toBeNull();
    expect(value?.text).toContain('九月');
    if (value) expect(value.text).toContain('丙午');
  });
});
import {
  forecastLabel,
  formatPomodoro,
  inkForLuminance,
  nextPomodoroPhase,
  wallpaperMediaFromUrl
} from './model';

describe('番茄钟阶段', () => {
  it('每完成 4 个专注进入长休，休息后回到专注', () => {
    expect(nextPomodoroPhase('work', 0)).toBe('short');
    expect(nextPomodoroPhase('work', 3)).toBe('short');
    expect(nextPomodoroPhase('work', 4)).toBe('long');
    expect(nextPomodoroPhase('short', 4)).toBe('work');
    expect(nextPomodoroPhase('long', 4)).toBe('work');
  });

  it('时间格式化补零', () => {
    expect(formatPomodoro(25 * 60)).toBe('25:00');
    expect(formatPomodoro(59)).toBe('00:59');
    expect(formatPomodoro(0)).toBe('00:00');
  });
});

describe('壁纸直链', () => {
  it('按扩展名推断图片 / GIF / 视频', () => {
    expect(wallpaperMediaFromUrl('https://a.com/b.jpg')?.kind).toBe('image');
    expect(wallpaperMediaFromUrl('https://a.com/b.gif')?.kind).toBe('gif');
    expect(wallpaperMediaFromUrl('https://a.com/b.mp4?x=1')?.kind).toBe('video');
    expect(wallpaperMediaFromUrl('https://a.com/b.webm')).toMatchObject({
      kind: 'video',
      source: 'url'
    });
  });

  it('拒绝非 http(s) 地址', () => {
    expect(wallpaperMediaFromUrl('javascript:alert(1)')).toBeNull();
    expect(wallpaperMediaFromUrl('')).toBeNull();
  });
});

describe('壁纸墨色', () => {
  it('暗壁纸用浅色字，亮壁纸用深色字', () => {
    expect(inkForLuminance(0.2)).toBe('light');
    expect(inkForLuminance(0.8)).toBe('dark');
    expect(inkForLuminance(null)).toBeNull();
  });
});

describe('预报日期标签', () => {
  it('今天 / 明天 / 后天 / 周几', () => {
    const now = new Date(2026, 9, 29);
    expect(forecastLabel('2026-10-29', now)).toBe('今天');
    expect(forecastLabel('2026-10-30', now)).toBe('明天');
    expect(forecastLabel('2026-10-31', now)).toBe('后天');
    expect(forecastLabel('2026-11-01', now)).toBe('周日');
  });
});
describe('壁纸备份', () => {
  it('直链壁纸会随备份导出并还原', () => {
    const backup = buildStartBackup({
      shortcuts: [{ id: 'a', label: 'B 站', url: 'https://www.bilibili.com', group: '常用' }],
      wallpaperMedia: { kind: 'video', source: 'url', url: 'https://a.com/loop.mp4' }
    });
    const parsed = parseStartBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.prefs.wallpaperMedia).toEqual({
        kind: 'video',
        source: 'url',
        url: 'https://a.com/loop.mp4'
      });
    }
  });
});
import { normalizeUsage } from './model';

describe('起始页数据备份', () => {
  it('便签、使用次数与番茄轮数可导出还原', () => {
    const backup = buildStartBackup({
      shortcuts: [{ id: 'a', label: 'B 站', url: 'https://www.bilibili.com', group: '常用' }],
      notes: '记一笔',
      usage: { a: 3 },
      pomodoroRounds: 2
    });
    const parsed = parseStartBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.prefs.notes).toBe('记一笔');
      expect(parsed.data.prefs.usage).toEqual({ a: 3 });
      expect(parsed.data.prefs.pomodoroRounds).toBe(2);
    }
  });

  it('使用次数只保留正整数', () => {
    expect(normalizeUsage({ a: 2, b: 0, c: -1, d: 'x' })).toEqual({ a: 2 });
    expect(normalizeUsage(null)).toBeUndefined();
  });
});
import { formatBingDate, formatClock, formatTemperature } from './model';

describe('时钟 / 温度 / 必应日期', () => {
  it('按设置输出 24 小时与秒', () => {
    const date = new Date(2026, 9, 29, 9, 5, 3);
    expect(formatClock(date, { seconds: false, hour12: false })).toBe('09:05');
    expect(formatClock(date, { seconds: true, hour12: false })).toBe('09:05:03');
  });

  it('摄氏度与华氏度', () => {
    expect(formatTemperature(22, 'c')).toBe('22°');
    expect(formatTemperature(0, 'f')).toBe('32°');
    expect(formatTemperature(22, 'f')).toBe('72°');
  });

  it('必应 startdate 转月日', () => {
    expect(formatBingDate('20261029')).toBe('10月29日');
    expect(formatBingDate('bad')).toBe('');
  });
});
