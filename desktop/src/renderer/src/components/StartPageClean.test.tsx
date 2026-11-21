// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StartPageClean } from './StartPageClean';

const settings = {
  general: {
    startShortcuts: [
      { id: 's1', label: 'B 站', url: 'https://www.bilibili.com/', folder: '' },
      { id: 's2', label: 'GitHub', url: 'https://github.com/', group: '学习', folder: '' }
    ],
    startWeather: false,
    startHotSearch: false,
    startCity: '上海',
    searchEngine: 'bing',
    searchEngineCustom: '',
    startWallpaper: 'aurora'
  },
  ai: {},
  search: {},
  subtitles: {},
  plugins: {},
  extensions: {}
};

function installBsub(overrides: Record<string, unknown> = {}) {
  const saveSettings = vi.fn(async (next: unknown) => ({
    ok: true as const,
    data: { settings: next, dataDir: '', version: '0.0.0' }
  }));
  Object.defineProperty(window, 'bsub', {
    configurable: true,
    value: {
      getSettings: vi.fn(async () => ({
        ok: true as const,
        data: { settings, dataDir: '', version: '0.0.0' }
      })),
      saveSettings,
      listLibrary: vi.fn(async () => ({ ok: true as const, data: { videos: [] } })),
      startWeather: vi.fn(async () => ({ ok: false as const, error: 'off' })),
      startHotSearch: vi.fn(async () => ({ ok: true as const, data: [] })),
      ...overrides
    }
  });
  return { saveSettings };
}

const noop = () => undefined;
const baseProps = {
  onNavigate: vi.fn(),
  onOpenLibrary: noop,
  onOpenHistory: noop,
  onOpenTasks: noop,
  onOpenSettings: noop,
  onOpenBookmarks: noop,
  onOpenDownloads: noop,
  onOpenGlobalSearch: noop,
  onOpenCommandPalette: noop,
  onClose: noop
};

describe('StartPageClean', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染时钟、搜索与快捷方式，回车走搜索引擎', async () => {
    installBsub();
    const onNavigate = vi.fn();
    render(<StartPageClean {...baseProps} onNavigate={onNavigate} />);
    expect(document.querySelector('.sc-clock')).toBeTruthy();
    await screen.findByText('B 站');

    const input = screen.getByPlaceholderText('搜索，或输入网址') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '拾字' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('https://www.bing.com/search?q=%E6%8B%BE%E5%AD%97');
  });

  it('设置抽屉可以打开，分组可筛选', async () => {
    installBsub();
    const { container } = render(<StartPageClean {...baseProps} />);
    await screen.findByText('GitHub');
    fireEvent.click(screen.getByTitle('自定义起始页'));
    expect(container.querySelector('.sc-sheet')).toBeTruthy();
    expect(screen.getByText('自定义起始页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '学习' }));
    const links = container.querySelector('.sc-links')?.textContent || '';
    expect(links).not.toContain('B 站');
    expect(links).toContain('GitHub');
  });

  it('同组同名文件夹合并，可进入和返回', async () => {
    const original = settings.general.startShortcuts;
    settings.general.startShortcuts = [
      ...original,
      {
        id: 'f1',
        label: '视频一',
        url: 'https://example.com/1',
        group: '学习',
        folder: '视频'
      },
      {
        id: 'f2',
        label: '视频二',
        url: 'https://example.com/2',
        group: '学习',
        folder: '视频'
      }
    ];
    try {
      installBsub();
      const { container } = render(<StartPageClean {...baseProps} />);
      await screen.findByText('GitHub');
      const folder = screen.getByTitle(/文件夹：学习 \/ 视频/);
      expect(folder.textContent).toContain('2');
      fireEvent.click(folder);
      const links = container.querySelector('.sc-links')?.textContent || '';
      expect(links).toContain('视频一');
      expect(links).toContain('视频二');
      expect(links).not.toContain('GitHub');
      fireEvent.click(screen.getByRole('button', { name: /返回全部/ }));
      expect(container.querySelector('.sc-links')?.textContent || '').toContain('GitHub');
    } finally {
      settings.general.startShortcuts = original;
    }
  });

  it('分组可以重命名，删除分组不删除链接', async () => {
    const { saveSettings } = installBsub();
    const { container } = render(<StartPageClean {...baseProps} />);
    await screen.findByText('GitHub');
    fireEvent.click(screen.getByTitle('自定义起始页'));
    fireEvent.click(screen.getByRole('tab', { name: '快捷方式' }));

    fireEvent.click(screen.getByTitle('重命名分组'));
    const input = container.querySelector('.sc-group-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '课程' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    let next = saveSettings.mock.calls.at(-1)?.[0] as {
      general: { startShortcuts: Array<{ label: string; group?: string }> };
    };
    expect(next.general.startShortcuts.find((item) => item.label === 'GitHub')?.group).toBe(
      '课程'
    );

    fireEvent.click(screen.getByTitle('删除分组'));
    await waitFor(() =>
      expect(
        (
          saveSettings.mock.calls.at(-1)?.[0] as {
            general: { startShortcuts: Array<{ label: string; group?: string }> };
          }
        ).general.startShortcuts.find((item) => item.label === 'GitHub')?.group
      ).toBeUndefined()
    );
    next = saveSettings.mock.calls.at(-1)?.[0] as {
      general: { startShortcuts: Array<{ label: string; group?: string }> };
    };
    expect(next.general.startShortcuts).toHaveLength(2);
  });

  it('可以创建空文件夹并显示磁贴', async () => {
    const { saveSettings } = installBsub();
    const { container } = render(<StartPageClean {...baseProps} />);
    await screen.findByText('GitHub');
    fireEvent.click(screen.getByTitle('自定义起始页'));
    fireEvent.click(screen.getByRole('tab', { name: '快捷方式' }));
    const inputs = container.querySelectorAll('.sc-folder-create input');
    fireEvent.change(inputs[1], { target: { value: '空文件夹' } });
    fireEvent.click(screen.getByRole('button', { name: /新建/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    const next = saveSettings.mock.calls.at(-1)?.[0] as {
      general: { startFolders: Array<{ group: string; name: string }> };
    };
    expect(next.general.startFolders).toContainEqual({ group: '', name: '空文件夹' });
  });

  it('文件夹可重命名，重命名只影响同组同文件夹', async () => {
    const original = settings.general.startShortcuts;
    settings.general.startShortcuts = [
      ...original,
      {
        id: 'f1',
        label: '视频一',
        url: 'https://example.com/1',
        group: '学习',
        folder: '视频'
      },
      {
        id: 'f2',
        label: '视频二',
        url: 'https://example.com/2',
        group: '学习',
        folder: '视频'
      }
    ];
    try {
      const { saveSettings } = installBsub();
      const { container } = render(<StartPageClean {...baseProps} />);
      await screen.findByText('GitHub');
      fireEvent.click(screen.getByTitle('自定义起始页'));
      fireEvent.click(screen.getByRole('tab', { name: '快捷方式' }));
      fireEvent.click(screen.getByTitle('重命名文件夹'));
      const input = container.querySelector('.sc-group-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '视频库' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(saveSettings).toHaveBeenCalled());
      const next = saveSettings.mock.calls.at(-1)?.[0] as {
        general: {
          startShortcuts: Array<{ label: string; group?: string; folder?: string }>;
        };
      };
      expect(
        next.general.startShortcuts.find((item) => item.label === '视频一')?.folder
      ).toBe('视频库');
      expect(
        next.general.startShortcuts.find((item) => item.label === '视频二')?.folder
      ).toBe('视频库');
    } finally {
      settings.general.startShortcuts = original;
    }
  });

  it('分组和文件夹按持久化顺序显示', async () => {
    const original = settings.general.startShortcuts;
    const target = settings.general as {
      startGroupOrder?: string[];
      startFolders?: Array<{ group: string; name: string }>;
      startFolderOrder?: string[];
    };
    settings.general.startShortcuts = [
      ...original,
      { id: 'g1', label: '工具站', url: 'https://example.com/tool', group: '工具', folder: '' }
    ];
    target.startGroupOrder = ['工具', '学习'];
    target.startFolders = [
      { group: '学习', name: '视频' },
      { group: '学习', name: '文档' }
    ];
    target.startFolderOrder = ['学习\u0000文档', '学习\u0000视频'];
    try {
      installBsub();
      render(<StartPageClean {...baseProps} />);
      await screen.findByText('GitHub');
      const groups = Array.from(document.querySelectorAll('.sc-groups button')).map(
        (item) => item.textContent
      );
      expect(groups.slice(0, 3)).toEqual(['全部', '工具', '学习']);
      const folders = Array.from(document.querySelectorAll('.sc-folder')).map(
        (item) => item.textContent
      );
      expect(folders[0]).toContain('文档');
      expect(folders[1]).toContain('视频');
    } finally {
      settings.general.startShortcuts = original;
      delete target.startGroupOrder;
      delete target.startFolders;
      delete target.startFolderOrder;
    }
  });

  it('添加快捷方式会写回设置', async () => {
    const { saveSettings } = installBsub();
    const { container } = render(<StartPageClean {...baseProps} />);
    await screen.findByText('B 站');
    fireEvent.click(screen.getByRole('button', { name: /添加/ }));
    const modal = container.querySelector('.sc-modal') as HTMLElement;
    const inputs = modal.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: '知乎' } });
    fireEvent.change(inputs[1], { target: { value: 'zhihu.com' } });
    fireEvent.submit(modal);
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    const next = saveSettings.mock.calls.at(-1)?.[0] as { general: { startShortcuts: unknown[] } };
    expect(next.general.startShortcuts).toHaveLength(3);
  });
});
