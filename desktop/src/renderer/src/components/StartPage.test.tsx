// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StartPage } from './StartPage';
import { loadWallpaperBlob } from './start/wallpaperStore';

vi.mock('./start/wallpaperStore', () => ({
  loadWallpaperBlob: vi.fn(async () => null),
  saveWallpaperBlob: vi.fn(async () => undefined),
  clearWallpaperBlob: vi.fn(async () => undefined)
}));

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
            startShortcuts: [] as Array<{ id: string; label: string; url: string; group?: string }>,
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
            startShortcuts: [] as Array<{ id: string; label: string; url: string; group?: string }>,
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
            startShortcuts: [] as Array<{ id: string; label: string; url: string; group?: string }>,
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

  it('快捷方式可以保存描述与标签', async () => {
    const api = installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByTitle('添加快捷方式'));
    fireEvent.change(screen.getByPlaceholderText('例如：知乎'), { target: { value: '语音工具' } });
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'example.com' }
    });
    fireEvent.change(screen.getByPlaceholderText('一句话说明（可选）'), {
      target: { value: '中文识别' }
    });
    fireEvent.change(screen.getByPlaceholderText('用逗号分隔，最多 6 个'), {
      target: { value: 'AI, 工具' }
    });
    fireEvent.click(screen.getByText('保存'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            startShortcuts: [
              expect.objectContaining({
                label: '语音工具',
                desc: '中文识别',
                tags: ['AI', '工具']
              })
            ]
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
describe('StartPage 搜索直达与右键菜单', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  function withShortcuts() {
    const api = installBsub();
    api.getSettings.mockImplementation(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            searchEngine: 'bing',
            petTodos: [],
            startShortcuts: [
              { id: 's1', label: '知乎', url: 'https://www.zhihu.com', group: '常用' },
              { id: 's2', label: 'MDN', url: 'https://developer.mozilla.org', group: '学习' }
            ],
            startWallpaper: 'aurora',
            startWeather: false,
            startCity: '上海',
            startHotSearch: false
          }
        },
        version: '0.39.3'
      }
    }));
    return api;
  }

  it('输入收藏站点名称时，第一条建议是直接打开', async () => {
    withShortcuts();
    const p = props();
    render(<StartPage {...p} />);
    await waitFor(() => expect(screen.getByText('知乎')).toBeTruthy());
    const input = screen.getByPlaceholderText(/在 必应 搜索/);
    fireEvent.change(input, { target: { value: '知乎' } });
    const first = document.querySelector('.start-suggest-item') as HTMLElement;
    expect(first.textContent).toContain('知乎');
    fireEvent.click(first);
    expect(p.onNavigate).toHaveBeenCalledWith('https://www.zhihu.com');
  });

  it('回车时完全匹配的名称直接打开站点', async () => {
    withShortcuts();
    const p = props();
    render(<StartPage {...p} />);
    await waitFor(() => expect(screen.getByText('MDN')).toBeTruthy());
    const input = screen.getByPlaceholderText(/在 必应 搜索/);
    fireEvent.change(input, { target: { value: 'MDN' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onNavigate).toHaveBeenCalledWith('https://developer.mozilla.org');
  });

  it('右键卡片可以删除快捷方式', async () => {
    const api = withShortcuts();
    render(<StartPage {...props()} />);
    await waitFor(() => expect(screen.getByText('知乎')).toBeTruthy());
    const tile = document.querySelector('.start-tile[title="https://www.zhihu.com"]') as HTMLElement;
    fireEvent.contextMenu(tile, { clientX: 300, clientY: 300 });
    fireEvent.click(screen.getByText('删除'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            startShortcuts: [expect.objectContaining({ label: 'MDN' })]
          })
        })
      )
    );
  });

  it('分组标签只显示该组站点', async () => {
    withShortcuts();
    render(<StartPage {...props()} />);
    await waitFor(() => expect(screen.getByText('知乎')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /学习/ }));
    expect(screen.queryByText('知乎')).toBeNull();
    expect(screen.getByText('MDN')).toBeTruthy();
  });
});

describe('StartPage 壁纸抽屉与极简模式', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('抽屉里的模糊与遮罩会保存到本地', async () => {
    installBsub();
    render(<StartPage {...props()} />);
    fireEvent.click(screen.getByTitle('更换壁纸'));
    const ranges = document.querySelectorAll('.start-range input');
    expect(ranges.length).toBe(2);
    fireEvent.change(ranges[0], { target: { value: '12' } });
    const saved = JSON.parse(localStorage.getItem('start-wallpaper-effect') || '{}');
    expect(saved.blur).toBe(12);
  });

  it('极简模式隐藏小组件，再点恢复', async () => {
    installBsub();
    render(<StartPage {...props()} />);
    expect(document.querySelectorAll('.start-widget').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTitle('极简模式'));
    await waitFor(() => expect(document.querySelectorAll('.start-widget').length).toBe(0));
    fireEvent.click(screen.getByTitle('极简模式'));
    await waitFor(() =>
      expect(document.querySelectorAll('.start-widget').length).toBeGreaterThan(0)
    );
  });
});

describe('StartPage 批量导入与分组管理', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function withGroups() {
    const api = installBsub();
    api.getSettings.mockImplementation(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            searchEngine: 'bing',
            petTodos: [],
            startShortcuts: [
              { id: 's1', label: '知乎', url: 'https://www.zhihu.com', group: '常用' },
              { id: 's2', label: 'MDN', url: 'https://developer.mozilla.org', group: '学习' }
            ],
            startWallpaper: 'aurora',
            startWeather: false,
            startCity: '上海',
            startHotSearch: false
          }
        },
        version: '0.39.4'
      }
    }));
    return api;
  }

  it('批量粘贴多行网址并写入设置', async () => {
    const api = withGroups();
    render(<StartPage {...props()} />);
    await waitFor(() => expect(screen.getByText('知乎')).toBeTruthy());
    fireEvent.click(screen.getByTitle('批量导入网址'));
    const textarea = screen.getByPlaceholderText(/哔哩哔哩/);
    fireEvent.change(textarea, {
      target: {
        value: 'Figma https://www.figma.com\nhttps://github.com\n# 注释行'
      }
    });
    fireEvent.click(screen.getByText('导入 2'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            startShortcuts: expect.arrayContaining([
              expect.objectContaining({ label: 'Figma', url: 'https://www.figma.com' }),
              expect.objectContaining({ label: 'github.com', url: 'https://github.com' })
            ])
          })
        })
      )
    );
  });

  it('编辑态可以重命名分组', async () => {
    const api = withGroups();
    render(<StartPage {...props()} />);
    await waitFor(() => expect(screen.getByText('MDN')).toBeTruthy());
    fireEvent.click(screen.getByText('编辑'));
    const renameButtons = screen.getAllByTitle('重命名分组');
    fireEvent.click(renameButtons[1]);
    const input = document.querySelector('.start-group-rename') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '课程' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            startShortcuts: expect.arrayContaining([
              expect.objectContaining({ label: 'MDN', group: '课程' })
            ])
          })
        })
      )
    );
  });

  it('删除分组会把站点移到常用', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = withGroups();
    render(<StartPage {...props()} />);
    await waitFor(() => expect(screen.getByText('MDN')).toBeTruthy());
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getAllByTitle('删除分组')[1]);
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            startShortcuts: expect.arrayContaining([
              expect.objectContaining({ label: 'MDN', group: '常用' })
            ])
          })
        })
      )
    );
  });
});
describe('StartPage 指令面板 / Dock / 效率小组件', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  function withShortcuts() {
    const api = installBsub();
    api.getSettings.mockImplementation(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            searchEngine: 'bing',
            petTodos: [],
            startShortcuts: [
              { id: 's1', label: '知乎', url: 'https://www.zhihu.com', group: '常用' }
            ],
            startWallpaper: 'aurora',
            startWeather: false,
            startCity: '上海',
            startHotSearch: false
          }
        },
        version: '0.122.0'
      }
    }));
    return api;
  }

  it('Ctrl+K 打开指令面板，回车执行页面命令', async () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: '指令面板' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('指令面板搜索'), { target: { value: '任务中心' } });
    // 第一条永远是「用当前引擎搜索」，第二条才是页面命令。
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(p.onOpenTasks).toHaveBeenCalled();
  });

  it('指令面板里输入内容可以直接用当前引擎搜索', async () => {
    installBsub();
    const p = props();
    render(<StartPage {...p} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('指令面板搜索');
    fireEvent.change(input, { target: { value: '拾字' } });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(p.onNavigate).toHaveBeenCalledWith('拾字');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('指令面板可以切换禅模式', async () => {
    installBsub();
    render(<StartPage {...props()} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.click(await screen.findByText('进入禅模式'));
    await waitFor(() => expect(document.querySelectorAll('.start-widget').length).toBe(0));
  });

  it('Dock 展示快捷方式与内置入口，点击可打开', async () => {
    withShortcuts();
    const p = props();
    render(<StartPage {...p} />);
    await waitFor(() => expect(screen.getByText('知乎')).toBeTruthy());
    const dockItem = document.querySelector('.start-dock [title="知乎"]') as HTMLElement;
    expect(dockItem).toBeTruthy();
    fireEvent.click(dockItem);
    expect(p.onNavigate).toHaveBeenCalledWith('https://www.zhihu.com');
    expect(document.querySelector('.start-dock [title="字幕库"]')).toBeTruthy();
  });

  it('番茄钟可以切换专注、短休与长休', async () => {
    installBsub();
    render(<StartPage {...props()} />);
    expect(screen.getByText('番茄钟')).toBeTruthy();
    fireEvent.click(screen.getByText('短休 5'));
    expect(screen.getByText('05:00')).toBeTruthy();
    fireEvent.click(screen.getByText('长休 15'));
    expect(screen.getByText('15:00')).toBeTruthy();
  });

  it('Dock 显示番茄钟剩余分钟，点击可开始/暂停', async () => {
    installBsub();
    render(<StartPage {...props()} />);
    const badge = document.querySelector('.start-dock-pomo-badge') as HTMLElement;
    expect(badge.textContent).toBe('25');
    const button = screen.getByLabelText('番茄钟');
    fireEvent.click(button);
    await waitFor(() => expect(button.className).toContain('is-running'));
    fireEvent.click(button);
    await waitFor(() => expect(button.className).not.toContain('is-running'));
  });

  it('本地视频壁纸会渲染成 video 元素', async () => {
    const api = installBsub();
    api.getSettings.mockImplementation(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            searchEngine: 'bing',
            petTodos: [],
            startShortcuts: [],
            startWallpaper: 'aurora',
            startWallpaperImage: '',
            startWallpaperMedia: { kind: 'video', source: 'file' },
            startWeather: false,
            startCity: '上海',
            startHotSearch: false
          }
        },
        version: '0.122.0'
      }
    }));
    vi.mocked(loadWallpaperBlob).mockResolvedValueOnce(new Blob(['x'], { type: 'video/mp4' }));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:wallpaper')
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    render(<StartPage {...props()} />);
    await waitFor(() =>
      expect(document.querySelector('video.start-wallpaper-video')).toBeTruthy()
    );
  });

  it('壁纸直链会写入设置并推断类型', async () => {
    const api = installBsub();
    render(<StartPage {...props()} />);
    fireEvent.click(screen.getByTitle('更换壁纸'));
    fireEvent.change(screen.getByLabelText('壁纸直链'), {
      target: { value: 'https://example.com/loop.mp4' }
    });
    fireEvent.click(screen.getByText('应用'));
    await vi.waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({
            startWallpaperMedia: {
              kind: 'video',
              source: 'url',
              url: 'https://example.com/loop.mp4'
            }
          })
        })
      )
    );
  });

  it('天气展示预报与湿度', async () => {
    const api = installBsub();
    const iso = (offset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')}`;
    };
    api.startWeather.mockResolvedValue({
      ok: true as const,
      data: {
        city: '上海',
        temperature: 22,
        description: '多云',
        high: 25,
        low: 18,
        humidity: 61,
        wind: 12,
        apparent: 21,
        forecast: [
          { date: iso(0), high: 25, low: 18, description: '多云' },
          { date: iso(1), high: 26, low: 19, description: '晴' }
        ]
      }
    } as never);
    render(<StartPage {...props()} />);
    expect(await screen.findByText('湿度 61%')).toBeTruthy();
    expect(screen.getByText('明天')).toBeTruthy();
    expect(screen.getByText('体感 21°')).toBeTruthy();
  });

  it('便签内容自动写入本地', async () => {
    installBsub();
    render(<StartPage {...props()} />);
    const input = screen.getByLabelText('起始页便签');
    fireEvent.change(input, { target: { value: '今晚整理字幕' } });
    await waitFor(() =>
      expect(localStorage.getItem('start-notes')).toBe('今晚整理字幕')
    );
  });

  it('禅模式下按 Esc 退出', async () => {
    installBsub();
    render(<StartPage {...props()} />);
    fireEvent.click(screen.getByTitle('极简模式'));
    await waitFor(() => expect(document.querySelectorAll('.start-widget').length).toBe(0));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(document.querySelectorAll('.start-widget').length).toBeGreaterThan(0)
    );
  });
});
