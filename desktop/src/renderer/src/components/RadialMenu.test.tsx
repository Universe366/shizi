// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RadialMenu } from './RadialMenu';
import type { WheelActionId } from '../../../shared/types';

const sectors: WheelActionId[] = [
  'summary',
  'chat',
  'newChat',
  'library',
  'settings',
  'start',
  'find',
  'reader'
];

describe('RadialMenu', () => {
  afterEach(cleanup);

  it('渲染 8 个扇区并响应点击', () => {
    const onAction = vi.fn();
    render(<RadialMenu open sectors={sectors} onAction={onAction} onClose={() => {}} />);
    expect(document.querySelectorAll('.radial-sector')).toHaveLength(8);
    fireEvent.click(screen.getByTitle('1. 总结本页'));
    expect(onAction).toHaveBeenCalledWith('summary');
  });

  it('数字键触发对应扇区，Esc 关闭', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(<RadialMenu open sectors={sectors} onAction={onAction} onClose={onClose} />);
    fireEvent.keyDown(window, { key: '2' });
    expect(onAction).toHaveBeenCalledWith('chat');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
