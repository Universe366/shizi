// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Bookmark, BookmarkFolder } from '../../../shared/types';
import { BookmarkBar } from './BookmarkBar';

const bookmarks: Bookmark[] = [
  { id: 1, url: 'https://a.example', title: '书签栏条目', favicon: null, folder: '', createdAt: 2 },
  { id: 2, url: 'https://b.example', title: '文件夹里的条目', favicon: null, folder: '学习', createdAt: 1 }
];
const folders: BookmarkFolder[] = [{ name: '学习', createdAt: 1, count: 1 }];

function installBsub() {
  const api = {
    listBookmarks: vi.fn(async () => ({ ok: true as const, data: bookmarks })),
    listBookmarkFolders: vi.fn(async () => ({ ok: true as const, data: folders })),
    onBookmarksChanged: vi.fn(() => () => {})
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BookmarkBar', () => {
  it('显示书签栏条目，点击打开', async () => {
    installBsub();
    const onOpen = vi.fn();
    render(<BookmarkBar onOpen={onOpen} onManage={vi.fn()} />);
    const item = await screen.findByText('书签栏条目');
    fireEvent.click(item);
    expect(onOpen).toHaveBeenCalledWith('https://a.example');
    expect(screen.queryByText('文件夹里的条目')).toBeNull();
  });

  it('文件夹点开后列出内部书签', async () => {
    installBsub();
    const onOpen = vi.fn();
    render(<BookmarkBar onOpen={onOpen} onManage={vi.fn()} />);
    fireEvent.click(await screen.findByText('学习'));
    const inside = await screen.findByText('文件夹里的条目');
    fireEvent.click(inside);
    expect(onOpen).toHaveBeenCalledWith('https://b.example');
  });

  it('管理按钮打开书签中心', async () => {
    installBsub();
    const onManage = vi.fn();
    render(<BookmarkBar onOpen={vi.fn()} onManage={onManage} />);
    fireEvent.click(screen.getByTitle('管理书签'));
    expect(onManage).toHaveBeenCalled();
  });
});
