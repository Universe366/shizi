import { describe, expect, it, vi } from 'vitest';
import type { LibraryVideo } from '../../shared/types';

const videos = vi.hoisted(() => ({ list: [] as LibraryVideo[] }));
vi.mock('./videos', () => ({
  listLibrary: () => ({ videos: videos.list })
}));

import { findDuplicateVideos } from './duplicates';

function video(id: number, title: string, url: string, bvid: string | null = null): LibraryVideo {
  return {
    id,
    bvid,
    cid: null,
    title,
    owner: 'UP',
    duration: 10,
    cover: null,
    url,
    kind: 'video',
    source: 'web',
    createdAt: id,
    updatedAt: id,
    summaryUpdatedAt: null,
    tags: [],
    collections: [],
    trackCount: 0,
    lineCount: 0,
    chars: 0
  };
}

describe('findDuplicateVideos', () => {
  it('优先按 BVID/链接分组，其次按标题', () => {
    videos.list = [
      video(1, '同一个视频', 'https://example.com/a?x=1', 'BV1'),
      video(2, '另一个标题', 'https://example.com/a?x=2', 'BV1'),
      video(3, '相同标题', 'https://example.com/b'),
      video(4, '相同标题。', 'https://example.com/c'),
      video(5, '独有', 'https://example.com/d')
    ];
    const groups = findDuplicateVideos();
    expect(groups).toHaveLength(2);
    expect(groups[0].reason).toBe('url');
    expect(groups[0].videos.map((item) => item.id)).toEqual([1, 2]);
    expect(groups[1].reason).toBe('title');
    expect(groups[1].videos.map((item) => item.id)).toEqual([3, 4]);
  });
});
