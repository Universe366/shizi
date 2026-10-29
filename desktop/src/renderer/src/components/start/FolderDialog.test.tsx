// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StartShortcut } from '../../../../shared/types';
import { FolderDialog } from './FolderDialog';

const items: StartShortcut[] = [
  { id: 'a', label: 'B 站', url: 'https://bilibili.com', group: '常用', folder: '视频' },
  { id: 'b', label: 'YouTube', url: 'https://youtube.com', group: '常用', folder: '视频' }
];

describe('FolderDialog', () => {
  afterEach(cleanup);

  it('展示文件夹内容并支持打开/移出', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <FolderDialog
        open
        name="视频"
        items={items}
        editMode
        onClose={vi.fn()}
        onOpen={onOpen}
        onRemoveFromFolder={onRemove}
      />
    );
    expect(screen.getByText('视频')).toBeTruthy();
    fireEvent.click(screen.getByText('B 站'));
    expect(onOpen).toHaveBeenCalledWith(items[0]);
    fireEvent.click(screen.getByTitle('从文件夹移出 YouTube'));
    expect(onRemove).toHaveBeenCalledWith('b');
  });
});
