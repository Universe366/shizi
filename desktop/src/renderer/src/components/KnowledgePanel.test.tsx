// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KnowledgePanel } from './KnowledgePanel';

function installBsub() {
  const handlers: { progress?: (event: unknown) => void } = {};
  const hits = [
    {
      videoId: 1,
      title: '本地 ASR 测试',
      kind: 'summary',
      startMs: 0,
      endMs: 0,
      text: '本地 whisper 的结论',
      score: 0.92
    },
    {
      videoId: 2,
      title: '字幕片段',
      kind: 'subtitle',
      startMs: 65000,
      endMs: 70000,
      text: '这一段讲的是依赖安装',
      score: 0.81
    }
  ];
  const api = {
    kbStatus: vi.fn(async () => ({
      ok: true as const,
      data: { chunks: 120, videos: 8, model: 'bge-m3', ready: true }
    })),
    kbDocuments: vi.fn(async () => ({
      ok: true as const,
      data: [
        {
          videoId: 1,
          title: '本地 ASR 测试',
          owner: 'UP',
          chunks: 60,
          subtitle: 50,
          summary: 8,
          note: 2,
          indexed: 60,
          updatedAt: Date.now()
        },
        {
          videoId: 2,
          title: '字幕片段',
          owner: '另一个 UP',
          chunks: 60,
          subtitle: 58,
          summary: 2,
          note: 0,
          indexed: 0,
          updatedAt: Date.now()
        }
      ]
    })),
    kbAsk: vi.fn(async () => ({ ok: true as const, data: { text: '这是回答', hits } })),
    kbSearch: vi.fn(async () => ({ ok: true as const, data: hits })),
    kbIndex: vi.fn(async () => ({
      ok: true as const,
      data: { chunks: 130, videos: 9, model: 'bge-m3', ready: true }
    })),
    onKbProgress: (cb: (event: unknown) => void) => {
      handlers.progress = cb;
      return () => {
        handlers.progress = undefined;
      };
    },
    openLibrarySource: vi.fn(async () => ({ ok: true as const, data: null }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return { api, handlers };
}

describe('KnowledgePanel', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('左侧列出文档，顶部显示索引状态', async () => {
    installBsub();
    render(<KnowledgePanel />);
    expect(await screen.findByText(/120 块 \/ 8 个视频/)).toBeTruthy();
    expect(await screen.findByText(/2 篇文档 · 120 块 · 1 篇已生成向量/)).toBeTruthy();
    expect(document.querySelectorAll('.kb-doc-row').length).toBe(3);
    expect(screen.getByText('全部文档')).toBeTruthy();
  });

  it('选中文档后提问会带 videoId 范围', async () => {
    const { api } = installBsub();
    render(<KnowledgePanel />);
    await screen.findByText('本地 ASR 测试');
    const row = [...document.querySelectorAll('.kb-doc-row')].find((el) =>
      el.textContent?.includes('本地 ASR 测试')
    ) as HTMLElement;
    fireEvent.click(row);
    expect(await screen.findByText('清除范围')).toBeTruthy();
    const input = screen.getByPlaceholderText(/只问/);
    fireEvent.change(input, { target: { value: '这篇讲了什么' } });
    fireEvent.click(document.querySelector('.kb-ask-side .mini-btn') as HTMLElement);
    await waitFor(() => expect(api.kbAsk).toHaveBeenCalledWith('这篇讲了什么', 1));
    expect(await screen.findByText('这是回答')).toBeTruthy();
    expect(document.querySelectorAll('.knowledge-hit').length).toBe(2);
  });

  it('引用可以按类型筛选', async () => {
    installBsub();
    render(<KnowledgePanel />);
    await screen.findByText(/8 个视频/);
    const input = screen.getByPlaceholderText(/这几期视频里/);
    fireEvent.change(input, { target: { value: '本地 ASR' } });
    fireEvent.click(document.querySelector('.kb-ask-side .mini-btn') as HTMLElement);
    await screen.findByText('这是回答');
    const filterButton = [...document.querySelectorAll('.kb-filters button')].find(
      (el) => el.textContent === '总结'
    ) as HTMLElement;
    fireEvent.click(filterButton);
    await waitFor(() => expect(document.querySelectorAll('.knowledge-hit').length).toBe(1));
  });

  it('构建索引会调用 kbIndex，并显示进度', async () => {
    const { api, handlers } = installBsub();
    render(<KnowledgePanel />);
    await screen.findByText(/8 个视频/);
    fireEvent.click(screen.getByText(/重建索引/));
    await waitFor(() => expect(api.kbIndex).toHaveBeenCalled());
    await waitFor(() => expect(handlers.progress).toBeTruthy());
    (handlers.progress as unknown as (event: unknown) => void)({
      phase: 'embed',
      done: 3,
      total: 12,
      message: '正在生成向量 3/12'
    });
    expect(await screen.findByText('正在生成向量 3/12')).toBeTruthy();
    expect(screen.getByText('3 / 12')).toBeTruthy();
  });
});