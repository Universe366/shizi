import { describe, expect, it } from 'vitest';
import {
  BridgeProtocolError,
  eventVideo,
  normalizeLines,
  normalizeVideo,
  parseEventBatch
} from './bridgeProtocol';

describe('bridgeProtocol', () => {
  it('normalizeVideo 生成稳定的 PageInfo', () => {
    const info = normalizeVideo({
      bvid: 'BV1xx',
      cid: 42,
      title: '标题',
      owner: 'UP',
      duration: 120,
      url: 'https://www.bilibili.com/video/BV1xx',
      viewPoints: [{ from: 0, to: 30, content: '开场' }]
    });
    expect(info.bvid).toBe('BV1xx');
    expect(info.cid).toBe(42);
    expect(info.kind).toBe('video');
    expect(info.viewPoints).toEqual([{ title: '开场', start: 0, end: 30 }]);
  });

  it('normalizeLines 去掉空行并夹取负时间', () => {
    expect(
      normalizeLines([
        { start: -3, end: 2, text: ' 第一句 ' },
        { start: 2, end: 3, text: '   ' },
        { start: 'x', end: 4, text: '第二句' }
      ])
    ).toEqual([
      { start: 0, end: 2, text: '第一句' },
      { start: 0, end: 4, text: '第二句' }
    ]);
  });

  it('parseEventBatch 接受合法批次并去重 id', () => {
    const batch = parseEventBatch({
      protocol: 2,
      client: { id: 'ext', browser: 'edge', version: '2.19.0' },
      events: [
        { id: 'a', type: 'video.captured', payload: { lines: [] } },
        { id: 'a', type: 'video.captured', payload: { lines: [] } },
        { id: 'b', type: 'summary.saved', payload: { summary: 'x' } }
      ]
    });
    expect(batch.protocol).toBe(2);
    expect(batch.client.browser).toBe('edge');
    expect(batch.events.map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('parseEventBatch 拒绝未知类型与缺失字段', () => {
    expect(() => parseEventBatch({ events: [{ id: 'a', type: 'nope', payload: {} }] })).toThrow(
      BridgeProtocolError
    );
    expect(() => parseEventBatch({ events: [{ type: 'video.captured', payload: {} }] })).toThrow(
      /id/
    );
    expect(() =>
      parseEventBatch({ events: [{ id: 'a', type: 'video.captured', payload: {} }] })
    ).toThrow(/payload/);
  });

  it('parseEventBatch 限制批量大小', () => {
    const events = Array.from({ length: 51 }, (_, index) => ({
      id: `e${index}`,
      type: 'video.captured',
      payload: { lines: [] }
    }));
    expect(() => parseEventBatch({ events })).toThrow(/50/);
  });

  it('eventVideo 没有身份时抛错', () => {
    expect(() => eventVideo({ video: { title: '只有标题' } })).toThrow(BridgeProtocolError);
    expect(() => eventVideo({ video: { url: 'https://example.com/a' } })).not.toThrow();
  });
});
