// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, McpServer, McpTool } from '../../../../shared/types';
import { McpSection } from './McpSection';

const server = {
  id: 's1',
  name: '本地服务',
  url: 'https://example.com/mcp',
  token: '',
  headers: {},
  enabled: true,
  transport: 'http'
} as McpServer;

const tool = { name: 'search', description: '搜索', inputSchema: {} } as McpTool;

function props(overrides: Record<string, unknown> = {}) {
  return {
    value: { enabled: true, servers: [server], callTimeoutMs: 60000, maxToolRounds: 6 } as AppSettings['mcp'],
    testing: '',
    tools: {},
    args: '{}',
    result: '',
    resources: {},
    prompts: {},
    onChange: vi.fn(),
    onArgs: vi.fn(),
    onAddServer: vi.fn(),
    onUpdateServer: vi.fn(),
    onRemoveServer: vi.fn(),
    onTest: vi.fn(),
    onCall: vi.fn(),
    onReadResource: vi.fn(),
    onGetPrompt: vi.fn(),
    onOAuth: vi.fn(),
    onWatchResource: vi.fn(),
    ...overrides
  };
}

describe('McpSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染服务卡片与名称', () => {
    render(<McpSection {...props()} />);
    expect(screen.getByDisplayValue('本地服务')).toBeTruthy();
    expect(screen.getByDisplayValue('https://example.com/mcp')).toBeTruthy();
  });

  it('编辑名称与 URL、切换传输方式都带服务 id', () => {
    const p = props();
    render(<McpSection {...p} />);
    fireEvent.change(screen.getByDisplayValue('本地服务'), { target: { value: '改名' } });
    expect(p.onUpdateServer).toHaveBeenCalledWith('s1', { name: '改名' });
    fireEvent.change(screen.getByDisplayValue('HTTP JSON-RPC'), { target: { value: 'sse' } });
    expect(p.onUpdateServer).toHaveBeenCalledWith('s1', { transport: 'sse' });
  });

  it('连接测试与工具调用', () => {
    const p = props({ tools: { s1: [tool] } });
    render(<McpSection {...p} />);
    fireEvent.click(screen.getByText(/连接 \/ 列出工具/));
    expect(p.onTest).toHaveBeenCalledWith(server);
    fireEvent.click(screen.getByTitle('搜索'));
    expect(p.onCall).toHaveBeenCalledWith(server, tool);
  });

  it('HTTP 服务可以发起 OAuth 授权', () => {
    const p = props();
    render(<McpSection {...p} />);
    fireEvent.click(screen.getByText('OAuth 授权'));
    expect(p.onOAuth).toHaveBeenCalledWith(server);
  });

  it('资源可以勾选订阅', () => {
    const resource = {
      uri: 'file:///a.md',
      name: 'a.md',
      description: '文件',
      mimeType: 'text/markdown'
    };
    const p = props({ resources: { s1: [resource] } });
    render(<McpSection {...p} />);
    fireEvent.click(
      screen.getByTitle('订阅更新（每 20 秒检查一次，变化时提示）')
    );
    expect(p.onWatchResource).toHaveBeenCalledWith(server, 'file:///a.md', true);
  });

  it('带参数的提示词会先收集参数再运行', () => {
    const prompt = {
      name: 'brief',
      description: '生成简报',
      arguments: [{ name: 'topic', description: '主题', required: true }]
    };
    const p = props({ prompts: { s1: [prompt] } });
    render(<McpSection {...p} />);
    fireEvent.click(screen.getByText(/提示词 · brief/));
    fireEvent.change(screen.getByPlaceholderText('topic'), { target: { value: 'AI' } });
    fireEvent.click(screen.getByText('运行提示词'));
    expect(p.onGetPrompt).toHaveBeenCalledWith(server, 'brief', { topic: 'AI' });
  });

  it('模板可以一键添加为停用服务', () => {
    const p = props();
    render(<McpSection {...p} />);
    fireEvent.click(screen.getByText('模板'));
    fireEvent.click(screen.getByText('Fetch'));
    expect(p.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ servers: expect.arrayContaining([expect.objectContaining({ name: 'Fetch', enabled: false })]) })
    );
  });

  it('超时与轮数按秒/轮换算', () => {
    const p = props();
    render(<McpSection {...p} />);
    const timeout = screen.getByDisplayValue('60') as HTMLInputElement;
    fireEvent.change(timeout, { target: { value: '30' } });
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ callTimeoutMs: 30000 }));
  });
});
