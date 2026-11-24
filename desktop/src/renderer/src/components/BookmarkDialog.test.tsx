// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Bookmark, BookmarkFolder } from '../../../shared/types';
import { BookmarkDialog } from './BookmarkDialog';

const existing: Bookmark = {
  id: 1,
  url: 'https://a.example/page',
  title: '原名称',
  favicon: null,
  folder: '学习',
  createdAt: 1
};

const folders: BookmarkFolder[] = [{ name: '学习', createdAt: 1, count: 1 }];

function installBsub(overrides: Record<string, unknown> = {}) {
  const api = {
    listBookmarks: vi.fn(async () => ({ ok: true as const, data: [existing] })),
    listBookmarkFolders: vi.fn(async () => ({ ok: true as const, data: folders })),
    saveBookmark: vi.fn(async () => ({ ok: true as const, data: existing })),
    removeBookmark: vi.fn(async () => ({ ok: true as const, data: { removed: true } })),
    ...overrides
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BookmarkDialog', () => {
  it('已收藏时预填名称与文件夹，保存走 saveBookmark', async () => {
    const api = installBsub();
    const onClose = vi.fn();
    const onChanged = vi.fn();
    render(
      <BookmarkDialog url={existing.url} initialTitle="原名称" onClose={onClose} onChanged={onChanged} />
    );

    const name = (await screen.findByDisplayValue('原名称')) as HTMLInputElement;
    expect(await screen.findByDisplayValue('学习')).toBeTruthy();
    expect(screen.getByText('编辑书签')).toBeTruthy();

    fireEvent.change(name, { target: { value: '新名称' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() =>
      expect(api.saveBookmark).toHaveBeenCalledWith({
        url: existing.url,
        title: '新名称',
        folder: '学习'
      })
    );
    expect(onChanged).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('未收藏时是添加模式，没有删除按钮', async () => {
    installBsub({ listBookmarks: vi.fn(async () => ({ ok: true as const, data: [] })) });
    render(<BookmarkDialog url="https://new.example" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByText('添加书签')).toBeTruthy();
    expect(screen.queryByText(/删除书签/)).toBeNull();
  });
});
