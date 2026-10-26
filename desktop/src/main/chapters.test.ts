import { describe, expect, it } from 'vitest';
import { generateChapters } from './chapters';
import type { PageInfo } from '../shared/types';

const base: PageInfo = {
  kind: 'video',
  bvid: 'BV1xx411c7mD',
  aid: 1,
  cid: 2,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '测试视频',
  owner: 'UP',
  desc: '',
  duration: 600,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  signature: 'sig'
};

describe('generateChapters', () => {
  it('有官方分段时直接沿用，不调用 AI、也不需要 API Key', async () => {
    const chapters = await generateChapters(
      {
        ...base,
        viewPoints: [
          { title: '开场', start: 0, end: 120 },
          { title: '第一部分', start: 120, end: 360 },
          { title: '第二部分', start: 360, end: 600 }
        ]
      },
      []
    );
    expect(chapters).toEqual([
      { title: '开场', start: 0, end: 120 },
      { title: '第一部分', start: 120, end: 360 },
      { title: '第二部分', start: 360, end: 600 }
    ]);
  });
});
