import { describe, expect, it } from 'vitest';
import { formatReminder, parseReminder } from './reminder';

describe('parseReminder', () => {
  const now = new Date('2026-10-25T10:00:00+08:00').getTime();

  it('解析「N 分钟后」并去掉时间短语', () => {
    expect(parseReminder('20分钟后 喝水', now)).toEqual({
      text: '喝水',
      dueAt: now + 20 * 60_000
    });
  });

  it('解析「N 小时后」', () => {
    expect(parseReminder('1小时后 开会', now)).toEqual({
      text: '开会',
      dueAt: now + 3_600_000
    });
  });

  it('解析今天的时间点，过去则顺延到明天', () => {
    const result = parseReminder('09:30 提交', now);
    expect(result.text).toBe('提交');
    expect(new Date(result.dueAt || 0).getDate()).toBe(26);
  });

  it('解析明天的时间点', () => {
    const result = parseReminder('明天 08:15 晨跑', now);
    expect(result.text).toBe('晨跑');
    const date = new Date(result.dueAt || 0);
    expect(date.getDate()).toBe(26);
    expect(date.getHours()).toBe(8);
    expect(date.getMinutes()).toBe(15);
  });

  it('没有时间时只返回正文', () => {
    expect(parseReminder('买牛奶', now)).toEqual({ text: '买牛奶' });
  });

  it('格式化当天时间只显示时分', () => {
    expect(formatReminder(now + 60_000, now)).toMatch(/\d{2}:\d{2}/);
  });
});
