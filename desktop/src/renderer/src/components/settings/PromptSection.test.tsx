// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings } from '../../../../shared/types';
import { DEFAULT_SUMMARY_PROMPT } from '../../../../shared/prompts';
import { PromptSection } from './PromptSection';

const value = {
  activeId: 't1',
  templates: [
    { id: 't1', name: '默认模板', text: '模板正文' },
    { id: 't2', name: '备用模板', text: '备用正文' }
  ],
  chat: '对话提示词',
  translate: '翻译提示词',
  optimize: '优化提示词',
  chapters: '章节提示词'
} as AppSettings['prompt'];

const ai = {
  activeId: 'deepseek',
  platforms: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      models: ['deepseek-chat']
    }
  ],
  taskModels: {}
} as unknown as AppSettings['ai'];

function props(overrides: Record<string, unknown> = {}) {
  return {
    value,
    ai,
    onAiChange: vi.fn(),
    onPatch: vi.fn(),
    onAddTemplate: vi.fn(),
    onRemoveTemplate: vi.fn(),
    onUpdateTemplate: vi.fn(),
    ...overrides
  };
}

describe('PromptSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染当前模板名称与正文', () => {
    const { container } = render(<PromptSection {...props()} />);
    const nameInput = container.querySelector('input.settings-input') as HTMLInputElement;
    expect(nameInput.value).toBe('默认模板');
    expect((screen.getByDisplayValue('模板正文') as HTMLTextAreaElement).value).toBe('模板正文');
  });

  it('切换模板与编辑名称/正文', () => {
    const p = props();
    render(<PromptSection {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: '总结模板' }), { target: { value: 't2' } });
    expect(p.onPatch).toHaveBeenCalledWith({ activeId: 't2' });
    const nameInput = document.querySelector('input.settings-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '新名称' } });
    expect(p.onUpdateTemplate).toHaveBeenCalledWith({ name: '新名称' });
  });

  it('四类提示词编辑都走 onPatch', () => {
    const p = props();
    render(<PromptSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('翻译提示词'), { target: { value: '新翻译' } });
    expect(p.onPatch).toHaveBeenCalledWith({ translate: '新翻译' });
    fireEvent.change(screen.getByDisplayValue('章节提示词'), { target: { value: '新章节' } });
    expect(p.onPatch).toHaveBeenCalledWith({ chapters: '新章节' });
  });

  it('内置模板可以一键恢复默认内容', () => {
    const p = props({
      value: {
        ...value,
        activeId: 'default',
        templates: [{ id: 'default', name: '改过的名字', text: '改过的内容' }]
      }
    });
    render(<PromptSection {...p} />);
    fireEvent.click(screen.getByTitle('恢复这个模板的默认内容'));
    expect(p.onUpdateTemplate).toHaveBeenCalledWith({
      name: '默认（视频整理）',
      text: DEFAULT_SUMMARY_PROMPT
    });
  });

  it('新增/删除模板回调，只剩一个模板时删除禁用', () => {
    const p = props();
    const { rerender } = render(<PromptSection {...p} />);
    fireEvent.click(screen.getByTitle('新增模板'));
    expect(p.onAddTemplate).toHaveBeenCalled();

    rerender(<PromptSection {...props({ value: { ...value, templates: [value.templates[0]] } })} />);
    expect((screen.getByTitle('删除当前模板') as HTMLButtonElement).disabled).toBe(true);
  });
});
