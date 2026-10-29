// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PageContextMenuPayload } from '../../../shared/types';
import { PageContextMenu } from './PageContextMenu';

const menu: PageContextMenuPayload = {
  x: 20,
  y: 20,
  pageX: 5,
  pageY: 6,
  selectionText: '选中的文字',
  linkURL: 'https://example.com/a?spm_id_from=1',
  srcURL: '',
  isEditable: false,
  canPaste: false,
  canCopy: true,
  canGoBack: true,
  canGoForward: false,
  devMode: false
};

describe('PageContextMenu', () => {
  afterEach(cleanup);

  it('复制、后退与打开链接', () => {
    const writeClipboard = vi.fn(async () => ({ ok: true }));
    const newTab = vi.fn(async () => 'id');
    const pageContextAction = vi.fn();
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: { writeClipboard, newTab, pageContextAction }
    });
    const onClose = vi.fn();
    render(<PageContextMenu menu={menu} onClose={onClose} />);
    fireEvent.click(screen.getByText('复制'));
    expect(writeClipboard).toHaveBeenCalledWith('选中的文字');
    expect(onClose).toHaveBeenCalled();
    cleanup();

    render(<PageContextMenu menu={menu} onClose={onClose} />);
    fireEvent.click(screen.getByText('后退'));
    expect(pageContextAction).toHaveBeenCalledWith('back');
    cleanup();

    render(<PageContextMenu menu={menu} onClose={onClose} />);
    fireEvent.click(screen.getByText('在新标签页打开链接'));
    expect(newTab).toHaveBeenCalledWith('https://example.com/a?spm_id_from=1');
  });
});
