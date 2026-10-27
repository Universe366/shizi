// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DownloadVideoDialog } from './DownloadVideoDialog';

type Handler = (...args: never[]) => void;

function installBsub() {
  const handlers: Record<string, Handler | undefined> = {};
  const api = {
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            download: {
              quality: 'best',
              audioOnly: false,
              audioFormat: 'm4a',
              cover: false,
              subtitles: false,
              metadata: false,
              template: 'title-id',
              folderPerList: true
            }
          }
        },
        version: '0.39.5'
      }
    })),
    listLibrary: vi.fn(async () => ({ ok: true as const, data: { videos: [] } })),
    probeOnlineVideo: vi.fn(async () => ({
      ok: true as const,
      data: {
        kind: 'playlist' as const,
        id: 'BV1xx',
        title: '测试合集',
        uploader: 'UP 主',
        duration: 300,
        thumbnail: '',
        webpageUrl: 'https://www.bilibili.com/video/BV1xx',
        entries: [
          { index: 1, id: 'a', title: '第一集', duration: 100, url: 'u1' },
          { index: 2, id: 'b', title: '第二集', duration: 100, url: 'u2' },
          { index: 3, id: 'c', title: '第三集', duration: 100, url: 'u3' }
        ]
      }
    })),
    downloadOnlineVideo: vi.fn(async (_payload: unknown) => ({
      ok: true as const,
      data: { requestId: 'r1' }
    })),
    cancelOnlineDownload: vi.fn(),
    onDownloadProgress: (cb: Handler) => {
      handlers.progress = cb;
      return () => {
        handlers.progress = undefined;
      };
    },
    onDownloadDone: (cb: Handler) => {
      handlers.done = cb;
      return () => {
        handlers.done = undefined;
      };
    },
    onDownloadError: (cb: Handler) => {
      handlers.error = cb;
      return () => {
        handlers.error = undefined;
      };
    },
    revealExport: vi.fn(async () => ({ ok: true as const, data: null }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return { api, handlers };
}

const props = () => ({ open: true, onClose: vi.fn() });

async function parseUrl() {
  const input = screen.getByPlaceholderText(/粘贴 B 站链接/);
  fireEvent.change(input, { target: { value: 'https://www.bilibili.com/video/BV1xx' } });
  fireEvent.click(screen.getByText('解析'));
  await screen.findByText('测试合集');
}

describe('DownloadVideoDialog', () => {
  afterEach(cleanup);

  it('解析后展示分P并默认全选', async () => {
    installBsub();
    render(<DownloadVideoDialog {...props()} />);
    await parseUrl();
    expect(screen.getByText('已选 3 / 3')).toBeTruthy();
    expect(screen.getByText('第一集')).toBeTruthy();
    expect(screen.getByText(/下载选中 3 项/)).toBeTruthy();
  });

  it('取消勾选后只提交选中的分P', async () => {
    const { api } = installBsub();
    render(<DownloadVideoDialog {...props()} />);
    await parseUrl();
    fireEvent.click(screen.getByText('第二集'));
    expect(screen.getByText('已选 2 / 3')).toBeTruthy();
    fireEvent.click(screen.getByText(/下载选中 2 项/));
    await waitFor(() => expect(api.downloadOnlineVideo).toHaveBeenCalled());
    const payload = api.downloadOnlineVideo.mock.calls.at(-1)?.[0] as unknown as {
      options: { playlistItems: number[]; listTitle: string };
    };
    expect(payload.options.playlistItems).toEqual([1, 3]);
    expect(payload.options.listTitle).toBe('测试合集');
  });

  it('单视频解析后不需要选集', async () => {
    const { api } = installBsub();
    api.probeOnlineVideo.mockResolvedValue({
      ok: true as const,
      data: {
        kind: 'single' as const,
        id: 'BV1yy',
        title: '单个视频',
        uploader: 'UP',
        duration: 60,
        thumbnail: '',
        webpageUrl: 'https://www.bilibili.com/video/BV1yy',
        entries: []
      }
    } as never);
    render(<DownloadVideoDialog {...props()} />);
    const input = screen.getByPlaceholderText(/粘贴 B 站链接/);
    fireEvent.change(input, { target: { value: 'https://www.bilibili.com/video/BV1yy' } });
    fireEvent.click(screen.getByText('解析'));
    await screen.findByText('单个视频');
    fireEvent.click(screen.getByText('开始下载'));
    await waitFor(() => expect(api.downloadOnlineVideo).toHaveBeenCalled());
    const payload = api.downloadOnlineVideo.mock.calls.at(-1)?.[0] as unknown as {
      options: Record<string, unknown>;
    };
    expect(payload.options.playlistItems).toBeUndefined();
  });

  it('进度事件会更新任务行', async () => {
    const { handlers } = installBsub();
    render(<DownloadVideoDialog {...props()} />);
    await parseUrl();
    fireEvent.click(screen.getByText(/下载选中 3 项/));
    await waitFor(() => expect(handlers.progress).toBeTruthy());
    (handlers.progress as unknown as (event: unknown) => void)({
      requestId: 'r1',
      percent: 42,
      speed: '1.20MiB/s',
      eta: '00:09',
      message: '下载中 42%'
    });
    await waitFor(() => expect(screen.getByText('42%')).toBeTruthy());
    expect(screen.getByText(/1.20MiB\/s/)).toBeTruthy();
  });
});
  it('失败的任务可以重试', async () => {
    const { api, handlers } = installBsub();
    render(<DownloadVideoDialog {...props()} />);
    await parseUrl();
    fireEvent.click(screen.getByText(/下载选中 3 项/));
    await waitFor(() => expect(handlers.error).toBeTruthy());
    (handlers.error as unknown as (event: unknown) => void)({
      requestId: 'r1',
      error: '网络中断'
    });
    await waitFor(() => expect(screen.getByText('重试')).toBeTruthy());
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(api.downloadOnlineVideo).toHaveBeenCalledTimes(2));
  });
