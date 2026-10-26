import { describe, expect, it } from 'vitest';
import { toolNeedsApproval } from '../shared/mcpApproval';

describe('MCP 工具审批分类', () => {
  it('off 一律不询问', () => {
    expect(toolNeedsApproval('delete_file', '删除文件', 'off')).toBe(false);
  });

  it('all 一律询问', () => {
    expect(toolNeedsApproval('search', '只读搜索', 'all')).toBe(true);
  });

  it('write 只拦写入/执行类', () => {
    expect(toolNeedsApproval('delete_file', '', 'write')).toBe(true);
    expect(toolNeedsApproval('send_email', '', 'write')).toBe(true);
    expect(toolNeedsApproval('run_command', '', 'write')).toBe(true);
    expect(toolNeedsApproval('create_issue', '', 'write')).toBe(true);
    expect(toolNeedsApproval('search', '搜索资料', 'write')).toBe(false);
    expect(toolNeedsApproval('read_file', '读取文件', 'write')).toBe(false);
  });

  it('描述里的动作也会触发', () => {
    expect(toolNeedsApproval('tool', '把内容写入数据库', 'write')).toBe(true);
  });

  it('默认（未设置）按写入口径处理由调用方决定', () => {
    expect(toolNeedsApproval('delete_file', '', undefined)).toBe(false);
  });
});
