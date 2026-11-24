// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LibraryDetail } from '../../../shared/types';
import { LibraryTabBar } from './LibraryTabBar';

const baseVideo = {
  id: 1,
  bvid: null,
  cid: null,
  title: 't',
  owner: 'o',
  duration: 0,
  cover: null,
  url: 'u',
  kind: 'video',
  source: 'bilibili',
  createdAt: 0,
  updatedAt: 0,
  summaryUpdatedAt: null,
  tags: [],
  collections: [],
  trackCount: 0,
  lineCount: 0,
  chars: 0
};

const detail = {
  video: baseVideo,
  bundle: {
    info: {} as never,
    track: {} as never,
    lines: [{ start: 0, end: 1, text: 'a' }]
  },
  summary: { content: 'summary', model: 'm', updatedAt: 0 },
  note: { videoId: 1, content: 'n', updatedAt: 0 }
} as unknown as LibraryDetail;

describe('LibraryTabBar', () => {
  afterEach(cleanup);

  it('只显示字幕与总结，不再有笔记 tab', () => {
    render(<LibraryTabBar detail={detail} active="subtitles" onChange={() => {}} />);
    expect(screen.getByText(/字幕 1/)).toBeTruthy();
    expect(screen.queryByText(/笔记/)).toBeNull();
  });

  it('切换 tab 触发回调', () => {
    const onChange = vi.fn();
    render(<LibraryTabBar detail={detail} active="subtitles" onChange={onChange} />);
    fireEvent.click(screen.getByText(/总结/));
    expect(onChange).toHaveBeenCalledWith('summary');
  });

  it('没有字幕时禁用字幕 tab', () => {
    const bare = { ...detail, bundle: null } as unknown as LibraryDetail;
    render(<LibraryTabBar detail={bare} active="summary" onChange={() => {}} />);
    expect((screen.getByText(/字幕/) as HTMLButtonElement).disabled).toBe(true);
  });
});
