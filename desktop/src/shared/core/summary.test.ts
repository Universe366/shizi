import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt, officialSegmentsBlock } from './summary';

describe('shared summary core', () => {
  it('官方分段块含起止时间与标题', () => {
    const block = officialSegmentsBlock({
      viewPoints: [
        { start: 0, end: 60, title: '开场' },
        { start: 60, end: 120, title: '正片' }
      ]
    });
    expect(block).toContain('开场');
    expect(block).toContain('0:00 ~ 1:00');
    expect(block).toContain('1:00 ~ 2:00');
  });

  it('少于两段不强制官方分段', () => {
    expect(officialSegmentsBlock({ viewPoints: [{ start: 0, end: 10, title: '一段' }] })).toBe('');
  });

  it('术语表使用 from → to 写法', () => {
    const built = buildSummaryPrompt({
      info: { title: '测试', duration: 61, url: 'https://example.com' },
      promptText: '总结模板',
      glossary: [{ from: '拾字', to: '拾字', note: '产品名' }]
    });
    expect(built.system).toContain('总结模板');
    expect(built.system).toContain('拾字（产品名）');
    expect(built.user).toContain('视频标题：测试');
    expect(built.user).toContain('视频时长：1:01');
  });

  it('系统提示始终追加时间线顺序规则（自定义格式规则时也追加）', () => {
    const built = buildSummaryPrompt({
      info: { title: '测试' },
      promptText: '模板',
      formatRules: '自定义格式规则'
    });
    expect(built.system).toContain('自定义格式规则');
    expect(built.system).toContain('严格按视频时间线');
    expect(built.system).toContain('不要按主题重排');
    // 顺序规则必须在格式规则之后单独成段，模型更容易遵守最后出现的硬约束。
    expect(built.system.indexOf('严格按视频时间线')).toBeGreaterThan(
      built.system.indexOf('自定义格式规则')
    );
    expect(built.system).toContain('\n\n【顺序：严格按视频时间线');
  });

  it('用户提示要求正文按字幕时间顺序组织', () => {
    const built = buildSummaryPrompt({ info: { title: '测试' }, promptText: '模板' });
    expect(built.user).toContain('按字幕时间顺序');
    expect(built.user).toContain('时间戳');
  });

  it('官方分段块要求按时间顺序排列', () => {
    expect(
      officialSegmentsBlock({
        viewPoints: [
          { start: 0, end: 60, title: '开场' },
          { start: 60, end: 120, title: '正片' }
        ]
      })
    ).toContain('按时间顺序排列');
  });

  it('useVideoMeta=false 时不带简介', () => {
    const built = buildSummaryPrompt({
      info: { title: '测试', desc: '简介内容' },
      promptText: '模板',
      useVideoMeta: false
    });
    expect(built.user).not.toContain('简介内容');
  });
});
