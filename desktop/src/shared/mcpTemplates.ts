export interface McpTemplate {
  id: string;
  name: string;
  description: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** 需要用户替换的占位符说明 */
  note?: string;
}

/** 常用 MCP 服务模板（本地进程为主，不联网拉取市场）。 */
export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: '读取/写入指定目录的文件（官方参考实现）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<PATH>'],
    note: '把 <PATH> 换成允许访问的目录'
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: '抓取网页并转成 Markdown（官方参考实现）',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch']
  },
  {
    id: 'memory',
    name: 'Memory',
    description: '基于知识图谱的长期记忆（官方参考实现）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory']
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: '让模型显式拆解复杂推理步骤（官方参考实现）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
  },
  {
    id: 'git',
    name: 'Git',
    description: '读取本地仓库历史、diff、分支（官方参考实现）',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '<PATH>'],
    note: '把 <PATH> 换成 Git 仓库目录'
  },
  {
    id: 'time',
    name: 'Time',
    description: '时区转换与当前时间（官方参考实现）',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time']
  },
  {
    id: 'github',
    name: 'GitHub',
    description: '搜索仓库、Issue、PR（需要 GitHub Token）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<TOKEN>' },
    note: '把 <TOKEN> 换成 GitHub Personal Access Token'
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Brave 网页搜索（需要 API Key）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '<KEY>' },
    note: '把 <KEY> 换成 Brave Search API Key'
  }
];
