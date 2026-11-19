// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ZoomBubble } from './ZoomBubble';

describe('ZoomBubble', () => {
  afterEach(cleanup);

  it('展示当前比例，放大/预设/重置可用', () => {
    const zoomIn = vi.fn(() => Promise.resolve());
    const zoomOut = vi.fn(() => Promise.resolve());
    const zoomReset = vi.fn(() => Promise.resolve());
    const setZoom = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: { zoomIn, zoomOut, zoomReset, setZoom }
    });
    const onClose = vi.fn();

    const { container } = render(<ZoomBubble open zoom={1.25} onClose={onClose} />);
    expect(container.querySelector('.zoom-bubble-value')?.textContent).toBe('125%');

    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(zoomIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(zoomOut).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '150%' }));
    expect(setZoom).toHaveBeenCalledWith(1.5);

    fireEvent.click(screen.getByTitle('重置为 100%'));
    expect(zoomReset).toHaveBeenCalledTimes(1);
  });

  it('点击外部关闭', () => {
    const onClose = vi.fn();
    render(<ZoomBubble open zoom={1} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
