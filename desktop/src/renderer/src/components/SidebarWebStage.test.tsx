// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidebarWebStage } from './SidebarWebStage';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('SidebarWebStage 小浏览器工具条', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: {
        sidebarWebActivate: vi.fn(async () => ({ ok: true, data: true })),
        sidebarWebDeactivate: vi.fn(),
        sidebarWebBounds: vi.fn(),
        sidebarWebReload: vi.fn(),
        sidebarWebBack: vi.fn(),
        sidebarWebForward: vi.fn(),
        sidebarWebNavigate: vi.fn(async () => ({ ok: true, data: true })),
        sidebarWebZoomIn: vi.fn(async () => ({ ok: true, data: 1.1 })),
        sidebarWebZoomOut: vi.fn(async () => ({ ok: true, data: 0.9 })),
        sidebarWebZoomReset: vi.fn(async () => ({ ok: true, data: 1 })),
        sidebarWebState: vi.fn(async () => ({ ok: true, data: null })),
        onSidebarWebState: () => () => undefined
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('渲染地址与缩放，按钮调用侧栏网页 API', () => {
    render(
      <SidebarWebStage
        page={{ id: 'p1', title: '示例', url: 'https://example.com/' }}
        layoutKey="left-300"
      />
    );
    const address = screen.getByLabelText('侧栏网页地址') as HTMLInputElement;
    expect(address.value).toBe('https://example.com/');
    fireEvent.click(screen.getByLabelText('放大'));
    expect(window.bsub.sidebarWebZoomIn).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('刷新'));
    expect(window.bsub.sidebarWebReload).toHaveBeenCalled();
  });

  it('地址栏回车导航到新网址', () => {
    render(
      <SidebarWebStage
        page={{ id: 'p1', title: '示例', url: 'https://example.com/' }}
        layoutKey="left-300"
      />
    );
    const address = screen.getByLabelText('侧栏网页地址');
    fireEvent.change(address, { target: { value: 'bilibili.com' } });
    fireEvent.keyDown(address, { key: 'Enter' });
    expect(window.bsub.sidebarWebNavigate).toHaveBeenCalledWith('https://bilibili.com');
  });
});
