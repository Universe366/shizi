import { describe, expect, it } from 'vitest';
import { DEFAULT_SUMMARY_FORMAT_RULES, buildSummaryPrompt, officialSegmentsBlock } from './summary';

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

  it('默认不追加任何格式规则，系统提示就是模板本身', () => {
    const built = buildSummaryPrompt({ info: { title: '测试' }, promptText: '模板' });
    expect(built.system).toBe('模板');
    expect(DEFAULT_SUMMARY_FORMAT_RULES).toBe('');
  });

  it('只有在设置里填了格式规则时才追加', () => {
    const built = buildSummaryPrompt({
      info: { title: '测试' },
      promptText: '模板',
      formatRules: '自定义格式规则'
    });
    expect(built.system).toBe('模板\n自定义格式规则');
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
