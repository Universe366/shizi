import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_STYLE, buildAss } from './ass';

describe('buildAss', () => {
  it('生成带时间轴和样式的 ASS', () => {
    const ass = buildAss(
      [{ start: 1.5, end: 3, text: '第一句' }],
      { style: { fontSize: 48 } }
    );
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('Style: Default,Microsoft YaHei,48');
    expect(ass).toContain('Dialogue: 0,0:00:01.50,0:00:03.00,Default');
    expect(ass).toContain('第一句');
  });

  it('双语时输出 Secondary 轨并叠放译文', () => {
    const ass = buildAss(
      [{ start: 0, end: 1, text: 'Hello' }],
      {
        translated: [{ start: 0, end: 1, text: '你好' }],
        style: { ...DEFAULT_SUBTITLE_STYLE, bilingual: true }
      }
    );
    expect(ass).toContain('Style: Secondary,');
    expect(ass).toContain('你好');
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:01.00,Secondary');
  });

  it('默认不输出 Secondary', () => {
    const ass = buildAss([{ start: 0, end: 1, text: 'Hello' }]);
    expect(ass).not.toContain('Style: Secondary,');
  });
});
