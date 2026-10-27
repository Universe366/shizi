// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShortcutDialog, type ShortcutDraft } from './ShortcutDialog';

function setup(draft: ShortcutDraft) {
  const onChange = vi.fn();
  const element = (next: ShortcutDraft) => (
    <ShortcutDialog
      draft={next}
      groups={['常用']}
      onChange={onChange}
      onCancel={() => undefined}
      onSave={() => undefined}
    />
  );
  const view = render(element(draft));
  const update = (next: ShortcutDraft) => view.rerender(element(next));
  return { onChange, update };
}

describe('ShortcutDialog 自动获取', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('点击自动获取后填充标题与描述', async () => {
    const api = {
      startProbeSite: vi.fn(async () => ({
        ok: true as const,
        data: {
          url: 'https://example.com/',
          title: '示例站点',
          description: '一个示例',
          icon: ''
        }
      }))
    };
    Object.defineProperty(window, 'bsub', { configurable: true, value: api });
    const { onChange, update } = setup({ label: '', url: 'https://example.com', group: '常用' });

    // 受控组件：把 onChange 的结果回填，模拟父组件
    onChange.mockImplementation((next: ShortcutDraft) => update(next));
    fireEvent.click(screen.getByText('自动获取'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)?.[0] as ShortcutDraft;
    expect(next.label).toBe('示例站点');
    expect(next.desc).toBe('一个示例');
  });
});
