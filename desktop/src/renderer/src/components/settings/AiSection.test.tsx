// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AiPlatform, AppSettings } from '../../../../shared/types';
import { AiSection } from './AiSection';

const platform = {
  id: 'ai1',
  name: 'DeepSeek',
  kind: 'deepseek',
  baseUrl: 'https://api.example.com',
  model: 'deepseek-chat',
  apiKey: 'sk-123',
  models: ['deepseek-chat'],
  protocol: 'openai',
  homepage: '',
  keyUrl: ''
} as unknown as AiPlatform;

const draft = {
  ai: {
    activeId: 'ai1',
    platforms: [platform],
    temperature: 0.3,
    maxTokens: 4096,
    stream: true,
    preProofread: false,
    sendOnEnter: true,
    expandReasoning: false,
    presetVersion: 1,
    appTools: true
  }
} as unknown as AppSettings;

function props(overrides: Record<string, unknown> = {}) {
  return {
    draft,
    active: platform,
    updateAi: vi.fn(),
    updatePlatform: vi.fn(),
    addPlatform: vi.fn(),
    removePlatform: vi.fn(),
    testConnection: vi.fn(),
    probeModels: vi.fn(),
    platformBusy: '',
    modelCache: {},
    showKey: {},
    setShowKey: vi.fn(),
    setEditingAiId: vi.fn(),
    platformStatus: () => <span>未测试</span>,
    ...overrides
  };
}

const button = (text: string) =>
  screen.getAllByRole('button').find((item) => item.textContent?.includes(text)) as HTMLButtonElement;

describe('AiSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染当前平台、Base URL 与连接状态', () => {
    render(<AiSection {...props()} />);
    expect(screen.getByDisplayValue('DeepSeek')).toBeTruthy();
    expect(screen.getByDisplayValue('https://api.example.com')).toBeTruthy();
    expect(screen.getByText('未测试')).toBeTruthy();
  });

  it('模型探测与测试连接回调', () => {
    const p = props();
    render(<AiSection {...p} />);
    fireEvent.click(button('获取模型列表'));
    fireEvent.click(button('测试连接'));
    expect(p.probeModels).toHaveBeenCalledWith('ai');
    expect(p.testConnection).toHaveBeenCalledWith('ai');
  });

  it('本地模型按钮新增并切换到 Ollama', () => {
    const p = props();
    render(<AiSection {...p} />);
    fireEvent.click(button('Ollama'));
    expect(p.updateAi).toHaveBeenCalledWith(
      expect.objectContaining({ activeId: 'ollama' })
    );
    expect(p.setEditingAiId).toHaveBeenCalledWith('ollama');
  });

  it('可以添加自定义模型名', () => {
    const p = props();
    render(<AiSection {...p} />);
    fireEvent.change(screen.getByPlaceholderText('添加自定义模型名'), {
      target: { value: 'my-model' }
    });
    fireEvent.click(button('添加'));
    expect(p.updatePlatform).toHaveBeenCalledWith({
      models: ['deepseek-chat', 'my-model'],
      model: 'my-model'
    });
  });

  it('本地库权限开关回传 appTools', () => {
    const p = props();
    render(<AiSection {...p} />);
    fireEvent.click(screen.getByLabelText(/允许 AI 查询本地库/));
    expect(p.updateAi).toHaveBeenCalledWith({ appTools: false });
  });

  it('新增与删除平台回调', () => {
    const two = { ...draft, ai: { ...draft.ai, platforms: [platform, { ...platform, id: 'ai2' }] } } as unknown as AppSettings;
    const p = props({ draft: two });
    render(<AiSection {...p} />);
    fireEvent.click(screen.getByTitle('新增平台'));
    expect(p.addPlatform).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('删除当前平台'));
    expect(p.removePlatform).toHaveBeenCalled();
  });
});
