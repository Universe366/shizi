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
