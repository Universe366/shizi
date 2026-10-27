// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KnowledgePanel } from './KnowledgePanel';

const HITS = [
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

function installBsub() {
  const handlers: { progress?: (event: unknown) => void } = {};
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
          updatedAt: Date.now(),
          tags: ['ASR'],
          status: 'review' as const
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
          updatedAt: Date.now(),
          tags: [],
          status: 'new' as const
        }
      ]
    })),
    listCollections: vi.fn(async () => ({
      ok: true as const,
      data: [{ id: 3, name: '课程合集', count: 5 }]
    })),
    kbAsk: vi.fn(async () => ({ ok: true as const, data: { text: '这是回答', hits: HITS } })),
    kbSearch: vi.fn(async () => ({ ok: true as const, data: HITS })),
    kbIndex: vi.fn(async () => ({
      ok: true as const,
      data: { chunks: 130, videos: 9, model: 'bge-m3', ready: true }
    })),
    kbChunks: vi.fn(async () => ({
      ok: true as const,
      data: [{ kind: 'subtitle', startMs: 65000, endMs: 70000, text: '第一段字幕内容' }]
    })),
    kbStatusSet: vi.fn(async () => ({ ok: true as const, data: 'learning' as const })),
    kbExport: vi.fn(async () => ({ ok: true as const, data: 'C:/tmp/kb.md' })),
    getLibraryItem: vi.fn(async () => ({
      ok: true as const,
      data: {
        video: { id: 1, title: '本地 ASR 测试', owner: 'UP', url: 'https://www.bilibili.com/video/BV1' },
        bundle: null,
        summary: { content: '总结内容', model: 'm', updatedAt: Date.now() },
        note: { videoId: 1, content: '已有笔记', updatedAt: Date.now() }
      }
    })),
    saveNote: vi.fn(async (_videoId: number, content: string) => ({
      ok: true as const,
      data: { videoId: 1, content, updatedAt: Date.now() }
    })),
    onKbProgress: (cb: (event: unknown) => void) => {
      handlers.progress = cb;
      return () => {
        handlers.progress = undefined;
      };
    },
    openLibrarySource: vi.fn(async () => ({ ok: true as const, data: true }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return { api, handlers };
}

const pick = (selector: string, text: string) =>
  [...document.querySelectorAll(selector)].find((el) => el.textContent?.includes(text)) as
    | HTMLElement
    | undefined;

describe('KnowledgePanel', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('左侧显示合集与文档，可按学习状态筛选', async () => {
    installBsub();
    render(<KnowledgePanel />);
    expect(await screen.findByText(/120 块 \/ 8 个视频/)).toBeTruthy();
    expect(await screen.findByText('课程合集')).toBeTruthy();
    expect(document.querySelectorAll('.kb-doc-row').length).toBe(4); // 全部 + 合集 + 2 文档
    fireEvent.click(pick('.kb-side-filters button', '待复习') as HTMLElement);
    await waitFor(() => expect(screen.queryByText('字幕片段')).toBeNull());
    expect(screen.getByText('本地 ASR 测试')).toBeTruthy();
  });

  it('选择合集后提问会带 collectionId', async () => {
    const { api } = installBsub();
    render(<KnowledgePanel />);
    await screen.findByText('课程合集');
    fireEvent.click(screen.getByText('课程合集'));
    const input = screen.getByPlaceholderText(/只在这个合集/);
    fireEvent.change(input, { target: { value: '课程讲什么' } });
    fireEvent.click(document.querySelector('.kb-ask-side .mini-btn') as HTMLElement);
    await waitFor(() =>
      expect(api.kbAsk).toHaveBeenCalledWith('课程讲什么', { collectionId: 3 })
    );
  });

  it('文档页签展示总结/笔记/片段，点击片段跳到时间', async () => {
    const { api } = installBsub();
    render(<KnowledgePanel />);
    await screen.findByText('本地 ASR 测试');
    fireEvent.click(screen.getByText('本地 ASR 测试'));
    fireEvent.click(screen.getByText('文档'));
    expect(await screen.findByText('总结内容')).toBeTruthy();
    expect(screen.getByText('已有笔记')).toBeTruthy();
    fireEvent.click(document.querySelector('.kb-doc-chunk') as HTMLElement);
    expect(api.openLibrarySource).toHaveBeenCalledWith(1, 65000);
  });

  it('引用栏可以跳到具体时间', async () => {
    const { api } = installBsub();
    render(<KnowledgePanel />);
    await screen.findByText('课程合集');
    const input = screen.getByPlaceholderText(/这几期视频里/);
    fireEvent.change(input, { target: { value: '本地 ASR' } });
    fireEvent.click(document.querySelector('.kb-ask-side .mini-btn') as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('.kb-rail-hit').length).toBe(2));
    fireEvent.click(screen.getByText(/跳到 1:05/));
    expect(api.openLibrarySource).toHaveBeenCalledWith(2, 65000);
  });

  it('回答可以追加到当前文档笔记', async () => {
    const { api } = installBsub();
    render(<KnowledgePanel />);
    await screen.findByText('本地 ASR 测试');
    fireEvent.click(screen.getByText('本地 ASR 测试'));
    fireEvent.click(screen.getByText('问答'));
    const input = screen.getByPlaceholderText(/只问/);
    fireEvent.change(input, { target: { value: '这篇讲了什么' } });
    fireEvent.click(document.querySelector('.kb-ask-side .mini-btn') as HTMLElement);
    await waitFor(() => expect(api.kbAsk).toHaveBeenCalled());
    fireEvent.click(screen.getByText('存为笔记'));
    await waitFor(() => expect(api.saveNote).toHaveBeenCalled());
    const content = api.saveNote.mock.calls.at(-1)?.[1] as string;
    expect(content).toContain('已有笔记');
    expect(content).toContain('## 问：这篇讲了什么');
    expect(content).toContain('[1]');
  });

  it('构建索引与导出', async () => {
    const { api, handlers } = installBsub();
    render(<KnowledgePanel />);
    await screen.findByText(/8 个视频/);
    fireEvent.click(screen.getByText(/重建索引/));
    await waitFor(() => expect(api.kbIndex).toHaveBeenCalled());
    (handlers.progress as unknown as (event: unknown) => void)({
      phase: 'embed',
      done: 3,
      total: 12,
      message: '正在生成向量 3/12'
    });
    expect(await screen.findByText('正在生成向量 3/12')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('导出…'), { target: { value: 'markdown' } });
    await waitFor(() => expect(api.kbExport).toHaveBeenCalledWith('markdown'));
    expect(await screen.findByText(/已导出到 C:\/tmp\/kb.md/)).toBeTruthy();
  });
});