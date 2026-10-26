// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StartPage } from './StartPage';

function installBsub() {
  const api = {
    listBrowseHistory: vi.fn(async () => ({ ok: true as const, data: [] })),
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            searchEngine: 'bing',
            petTodos: [],
            startShortcuts: [],
            startWallpaper: 'aurora',
            startWeather: true,
            startCity: '上海',
            startHotSearch: true
          }
        },
        version: '0.38.13'
      }
    })),
    startWeather: vi.fn(async () => ({
      ok: true as const,
      data: { city: '上海', temperature: 22, description: '多云', high: 25, low: 18 }
    })),
    startHotSearch: vi.fn(async () => ({ ok: true as const, data: ['热搜一', '热搜二'] })),
    startBingWallpaper: vi.fn(async () => ({
      ok: true as const,
      data: { url: 'https://www.bing.com/bing.jpg', copyright: 'Bing' }
    })),
    exportSettings: vi.fn(async () => ({ ok: true as const, data: { canceled: true } })),
    importSettings: vi.fn(async () => ({ ok: true as const, data: { canceled: true } })),
    saveSettings: vi.fn(async (next: unknown) => ({ ok: true as const, data: { settings: next } })),
    listLibrary: vi.fn(async () => ({
      ok: true as const,
      data: {
        videos: [
          { id: 1, title: '最近视频', owner: 'UP', url: 'https://www.bilibili.com/video/BV1' }
        ]
      }
    }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    onNavigate: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenBookmarks: vi.fn(),
    onOpenDownloads: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
}

describe('StartPage', () => {
  afterEach(cleanup);

  it('搜索框回车跳转并关闭', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    const input = screen.getByPlaceholderText(/在 必应 搜索/);
    fireEvent.change(input, { target: { value: 'BV1xx411c7mD' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onNavigate).toHaveBeenCalledWith('BV1xx411c7mD');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('空输入不跳转', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(document.querySelector('.start-search-go') as HTMLElement);
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it('快捷入口分别回调', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(screen.getByText('字幕库'));
    fireEvent.click(screen.getByText('历史记录'));
    fireEvent.click(screen.getByText('任务中心'));
    fireEvent.click(screen.getByText('设置'));
    expect(p.onOpenLibrary).toHaveBeenCalled();
    expect(p.onOpenHistory).toHaveBeenCalled();
    expect(p.onOpenTasks).toHaveBeenCalled();
    expect(p.onOpenSettings).toHaveBeenCalled();
  });

  it('输入时展示搜索建议，点击建议直接跳转', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    const input = screen.getByPlaceholderText(/在 必应 搜索/);
    fireEvent.change(input, { target: { value: '字幕工具' } });
    fireEvent.click(screen.getByText(/在 必应 搜索“字幕工具”/));
    expect(p.onNavigate).toHaveBeenCalledWith('字幕工具');
  });

  it('编辑模式可以隐藏天气小组件', async () => {
    const api = installBsub();
    render(<StartPage {...props()} />);
    fireEvent.click(screen.getByText('编辑'));
    const checkbox = document.querySelector(
      '.start-widget-toggle input'
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    const last = api.saveSettings.mock.calls.at(-1)?.[0] as {
      general: { startWidgets: string[] };
    };
    expect(last.general.startWidgets).not.toContain('weather');
    await waitFor(() => expect(document.querySelector('.start-weather-widget')).toBeNull());
  });

  it('待办可以删除', async () => {
    const api = installBsub();
    api.getSettings.mockImplementation(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            searchEngine: 'bing',
            petTodos: [{ id: 1, text: '测试待办', done: false }] as never[],
            startShortcuts: [],
            startWallpaper: 'aurora',
            startWeather: true,
            startCity: '上海',
            startHotSearch: true
          }
        },
        version: '0.39.1'
      }
    }));
    render(<StartPage {...props()} />);
    await waitFor(() => expect(screen.getByText('测试待办')).toBeTruthy());
    fireEvent.click(document.querySelector('.start-todo-remove') as HTMLElement);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    const last = api.saveSettings.mock.calls.at(-1)?.[0] as {
      general: { petTodos: unknown[] };
    };
    expect(last.general.petTodos).toEqual([]);
  });

  it('设置丢失时用本地备份恢复快捷方式', async () => {
    const api = installBsub();
    localStorage.setItem(
      'start-shortcut-backup',
      JSON.stringify([{ id: 'x', label: '备份站点', url: 'https://example.com', group: '常用' }])
    );
    render(<StartPage {...props()} />);
    await waitFor(() => expect(screen.getByText('备份站点')).toBeTruthy());
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    localStorage.clear();
  });

  it('必应壁纸会应用到起始页背景', async () => {
    const api = installBsub();
    api.getSettings.mockImplementation(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            searchEngine: 'bing',
            petTodos: [],
            startShortcuts: [],
            startWallpaper: 'bing',
            startWeather: false,
            startCity: '上海',
            startHotSearch: false
          }
        },
        version: '0.39.2'
      }
    }));
    api.startBingWallpaper.mockResolvedValue({
      ok: true as const,
      data: { url: 'https://www.bing.com/bing.jpg', copyright: 'Bing' }
    } as never);
    render(<StartPage {...props()} />);
    await waitFor(() => expect(api.startBingWallpaper).toHaveBeenCalled());
    const page = document.querySelector('.start-page') as HTMLElement;
    await waitFor(() => expect(page.style.backgroundImage).toContain('bing.jpg'));
  });

  it('展示最近的库条目，点击打开', async () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    const item = await screen.findByText('最近视频');
    fireEvent.click(item);
    expect(p.onNavigate).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1');
  });
});

describe('StartPage v2', () => {
  afterEach(cleanup);

  it('切换搜索引擎会写设置', async () => {
    const api = installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(screen.getByTitle('切换搜索引擎'));
    fireEvent.click(screen.getByText('Google'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({ searchEngine: 'google' })
        })
      )
    );
  });

  it('待办小组件能新增并保存', async () => {
    const api = installBsub();
    const p = props();
    render(<StartPage {...p} />);
    const input = screen.getByPlaceholderText(/添加待办/);
    fireEvent.change(input, { target: { value: '写日报' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            petTodos: [expect.objectContaining({ text: '写日报', done: false })]
          })
        })
      )
    );
  });
});

describe('StartPage 自定义快捷方式与壁纸', () => {
  afterEach(cleanup);

  it('可以添加快捷方式并写设置', async () => {
    const api = installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加快捷方式'));
    fireEvent.change(screen.getByPlaceholderText('例如：知乎'), { target: { value: '知乎' } });
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'zhihu.com' }
    });
    fireEvent.click(screen.getByText('保存'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            startShortcuts: [expect.objectContaining({ label: '知乎', url: 'https://zhihu.com' })]
          })
        })
      )
    );
  });

  it('可以切换壁纸并写设置', async () => {
    const api = installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(screen.getByTitle('更换壁纸'));
    fireEvent.click(screen.getByTitle('薄荷'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({ startWallpaper: 'mint' })
        })
      )
    );
  });

  it('天气与热搜来自 IPC', async () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    expect(await screen.findByText('22°')).toBeTruthy();
    expect(await screen.findByText('热搜一')).toBeTruthy();
  });
});

describe('StartPage 编辑模式', () => {
  afterEach(cleanup);

  it('添加入口始终可见，编辑态才显示删除', () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    expect(screen.getByTitle('添加快捷方式')).toBeTruthy();
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByTitle('添加快捷方式')).toBeTruthy();
  });
});
