// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SidebarPagesDialog } from './SidebarPagesDialog';

const pages = [{ id: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com/' }];

function mockApi(save: ReturnType<typeof vi.fn>) {
  (window as unknown as { bsub: Record<string, unknown> }).bsub = {
    saveSidebarPages: save,
    clearSidebarWebData: vi.fn().mockResolvedValue({ ok: true, data: true })
  };
}

describe('SidebarPagesDialog', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { bsub?: unknown }).bsub;
  });

  it('添加网页时保存并清空输入', async () => {
    const save = vi.fn().mockResolvedValue({
      ok: true,
      data: [...pages, { id: 'page-2', title: 'Example', url: 'https://example.com/' }]
    });
    mockApi(save);
    render(<SidebarPagesDialog open pages={pages} onClose={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('名称（可留空）'), {
      target: { value: 'Example' }
    });
    fireEvent.change(screen.getByPlaceholderText('https://chat.deepseek.com/'), {
      target: { value: 'https://example.com/' }
    });
    fireEvent.click(screen.getByText('添加'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual([
      ...pages,
      { id: 'page-2', title: 'Example', url: 'https://example.com/' }
    ]);
  });

  it('非法网址不调用保存', () => {
    const save = vi.fn();
    mockApi(save);
    render(<SidebarPagesDialog open pages={pages} onClose={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('https://chat.deepseek.com/'), {
      target: { value: 'javascript:alert(1)' }
    });
    fireEvent.click(screen.getByText('添加'));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('只支持 http/https 网址')).toBeTruthy();
  });

  it('删除网页时保存剩余列表', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, data: [] });
    mockApi(save);
    render(<SidebarPagesDialog open pages={pages} onClose={() => undefined} />);
    fireEvent.click(screen.getByTitle('删除这个网页'));
    await waitFor(() => expect(save).toHaveBeenCalledWith([]));
  });
});
