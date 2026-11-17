// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { SidebarPageIcon } from './SidebarPageIcon';

function page(url: string, title = '测试站点') {
  return { id: 'p1', title, url };
}

function installProbe(probe: ReturnType<typeof vi.fn>) {
  (window as unknown as { bsub: Record<string, unknown> }).bsub = {
    startProbeSite: probe
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { bsub?: unknown }).bsub;
});

describe('SidebarPageIcon', () => {
  it('图标加载前显示首字，加载完成后隐藏垫底文字', () => {
    installProbe(vi.fn());
    const { container } = render(
      <SidebarPageIcon page={page('https://icon-a.example.com/')} />
    );
    const letter = container.querySelector('.side-nav-letter') as HTMLElement;
    const image = container.querySelector('.side-nav-favicon') as HTMLImageElement;
    expect(letter.className).not.toContain('is-hidden');
    fireEvent.load(image);
    expect(letter.className).toContain('is-hidden');
  });

  it('直接 favicon.ico 失败后用页面 meta 图标', async () => {
    const probe = vi.fn(async () => ({
      ok: true as const,
      data: {
        icon: 'https://cdn.example.com/icon.png',
        title: '站点',
        description: '',
        url: 'https://icon-b.example.com/'
      }
    }));
    installProbe(probe);
    const { container } = render(
      <SidebarPageIcon page={page('https://icon-b.example.com/')} />
    );
    fireEvent.error(container.querySelector('.side-nav-favicon') as HTMLImageElement);
    await waitFor(() => expect(probe).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (container.querySelector('.side-nav-favicon') as HTMLImageElement | null)?.src
      ).toBe('https://cdn.example.com/icon.png')
    );
    expect(probe).toHaveBeenCalledWith('https://icon-b.example.com/');
    const letter = container.querySelector('.side-nav-letter') as HTMLElement;
    fireEvent.load(container.querySelector('.side-nav-favicon') as HTMLImageElement);
    expect(letter.className).toContain('is-hidden');
  });

  it('所有图标都失败时回退为两个汉字', async () => {
    installProbe(vi.fn(async () => ({ ok: false as const, error: 'no icon' })));
    const { container } = render(
      <SidebarPageIcon page={page('https://icon-c.example.com/', '腾讯元宝')} />
    );
    fireEvent.error(container.querySelector('.side-nav-favicon') as HTMLImageElement);
    await waitFor(() =>
      expect(container.querySelector('.side-nav-letter')?.textContent).toBe('腾讯')
    );
    expect(container.querySelector('.side-nav-favicon')).toBeNull();
  });
});
