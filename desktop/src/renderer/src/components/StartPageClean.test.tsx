// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StartPageClean } from './StartPageClean';

const settings = {
  general: {
    startShortcuts: [
      { id: 's1', label: 'B 站', url: 'https://www.bilibili.com/' },
      { id: 's2', label: 'GitHub', url: 'https://github.com/', group: '学习' }
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
