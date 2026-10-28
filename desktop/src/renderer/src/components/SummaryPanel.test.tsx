// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PageInfo, TabInfo, VerificationSummary } from '../../../shared/types';
import { SummaryPanel } from './SummaryPanel';

const info = {
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
  duration: 60,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  signature: 'sig'
} as PageInfo;

const tab = {
  id: 't1',
  title: '测试视频',
  url: info.url,
  loading: false,
  active: true,
  canGoBack: false,
  canGoForward: false,
  suspended: false,
  zoom: 1
} as TabInfo;

type Handlers = { done?: (event: unknown) => void; error?: (event: unknown) => void };

function installBsub(options: { saved?: boolean; pageError?: string } = {}) {
  const handlers: Handlers = {};
  const api = {
    getPageInfo: vi.fn(async () =>
      options.pageError
        ? { ok: false as const, error: options.pageError }
        : { ok: true as const, data: info }
    ),
    getSubtitles: vi.fn(async () => ({
      ok: true as const,
      data: {
        needLogin: false,
        tracks: [],
        lines: [],
        sources: [],
        errors: [],
        diagnostics: {}
      }
    })),
    savedSubtitles: vi.fn(async () => ({ ok: true as const, data: [] })),
    getSummary: vi.fn(async () =>
      options.saved
        ? { ok: true as const, data: { content: '# 已保存的总结', model: 'deepseek', updatedAt: 0 } }
        : { ok: true as const, data: null }
    ),
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: {
        settings: {
          ai: { preProofread: false },
          search: { verify: true },
          export: { defaultFormat: 'md', format: 'md' }
        },
        version: '0.37.2'
      }
    })),
    onSettingsChanged: vi.fn(() => () => {}),
    onAiDelta: vi.fn(() => () => {}),
    onAiDone: vi.fn((cb: (event: unknown) => void) => {
      handlers.done = cb;
      return () => {};
    }),
    onAiError: vi.fn((cb: (event: unknown) => void) => {
      handlers.error = cb;
      return () => {};
    }),
    onAiStatus: vi.fn(() => () => {}),
    onAiReasoning: vi.fn(() => () => {}),
    onAsrProgress: vi.fn(() => () => {}),
    onAsrDone: vi.fn(() => () => {}),
    onAsrError: vi.fn(() => () => {}),
    transcribe: vi.fn(async () => ({ ok: true as const, data: { requestId: 'asr-1' } })),
    cancelTranscribe: vi.fn(async () => undefined),
    newTab: vi.fn(async () => ({ id: 't2', reused: false, ready: true })),
    refreshView: vi.fn(),
    exitFullscreen: vi.fn(),
    cancelSummary: vi.fn(async () => undefined)
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return { api, handlers };
}

describe('SummaryPanel', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('加载已保存的总结并保留联网开关', async () => {
    installBsub({ saved: true });
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    expect(await screen.findByText('已保存的总结')).toBeTruthy();
    expect(screen.getByLabelText('联网')).toBeTruthy();
  });

  it('联网开关默认开启', async () => {
    installBsub({ saved: true });
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    expect(await screen.findByText('已保存的总结')).toBeTruthy();
    expect((screen.getByLabelText('联网') as HTMLInputElement).checked).toBe(true);
  });

  it('没有保存总结时展示空状态', async () => {
    installBsub();
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    expect(await screen.findByText('还没有总结')).toBeTruthy();
    expect(screen.getByText('生成总结')).toBeTruthy();
  });

  it('需要登录 B 站时给出登录/转写入口', async () => {
    const { api } = installBsub();
    api.getSubtitles.mockResolvedValueOnce({
      ok: true,
      data: {
        needLogin: true,
        tracks: [],
        lines: [],
        sources: [],
        errors: [],
        diagnostics: {}
      }
    } as never);
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    await screen.findByText('还没有总结');
    fireEvent.click(screen.getByText('生成总结'));
    expect(await screen.findByText(/需要登录 B 站/)).toBeTruthy();
    fireEvent.click(screen.getByText('登录 B 站'));
    expect(api.newTab).toHaveBeenCalledWith('https://passport.bilibili.com/login');
    fireEvent.click(screen.getByText('转写后总结'));
    await waitFor(() => expect(api.transcribe).toHaveBeenCalled());
  });

  it('页面信息读取失败时显示错误', async () => {
    installBsub({ pageError: '需要登录' });
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    expect(await screen.findByText(/需要登录/, undefined, { timeout: 8000 })).toBeTruthy();
  });

  it('收到总结完成事件后渲染正文与核对卡片', async () => {
    const { handlers } = installBsub();
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    await screen.findByText('还没有总结');

    const verification = {
      items: [
        {
          label: '3nm',
          query: '3nm',
          line: '台积电 3nm 量产',
          references: [{ title: '证据标题', url: 'https://example.com/a', snippet: 's' }]
        }
      ],
      references: [{ title: '证据标题', url: 'https://example.com/a', snippet: 's' }],
      supplements: [],
      attempted: 1,
      failed: 0,
      judged: false,
      dropped: 0
    } as VerificationSummary;

    handlers.done?.({ requestId: '', text: '# 新总结', model: 'deepseek', verification });

    expect(await screen.findByText('新总结')).toBeTruthy();
    expect(screen.getByText(/本次未完成语义判定/)).toBeTruthy();
    expect(screen.getByText('证据标题')).toBeTruthy();
  });

  it('AI 失败事件显示错误', async () => {
    const { handlers } = installBsub();
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    await screen.findByText('还没有总结');
    handlers.error?.({ requestId: '', error: '模型超时' });
    expect(await screen.findByText(/模型超时/)).toBeTruthy();
  });

  it('生成时发送联网开关，不再有快速入口', async () => {
    const { api } = installBsub();
    api.getSubtitles.mockResolvedValueOnce({
      ok: true,
      data: {
        needLogin: false,
        tracks: [
          {
            lan: 'zh-CN',
            lanDoc: '中文（自动生成）',
            url: 'https://example.com/sub.json',
            isAi: true,
            aiStatus: null,
            source: 'official'
          }
        ],
        lines: [],
        sources: [],
        errors: [],
        diagnostics: {}
      }
    } as never);
    const runtime = api as unknown as {
      getTrackBody: ReturnType<typeof vi.fn>;
      summarize: ReturnType<typeof vi.fn>;
    };
    runtime.getTrackBody = vi.fn(async () => ({
      ok: true as const,
      data: { lines: [{ from: 0, to: 1.5, text: '这是字幕' }] }
    }));
    runtime.summarize = vi.fn(async () => ({
      ok: true as const,
      data: { requestId: 'r1' }
    }));
    render(<SummaryPanel activeTab={tab} onOpenSettings={() => {}} />);
    await screen.findByText('还没有总结');
    expect(screen.queryByText('快速')).toBeNull();
    fireEvent.click(screen.getByText('生成总结'));
    await waitFor(() =>
      expect(runtime.summarize).toHaveBeenCalledWith(
        expect.objectContaining({ experimentalChatWeb: true })
      )
    );
  });
});
