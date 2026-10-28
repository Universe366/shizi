import { describe, expect, it } from 'vitest';
import { describeMcpParameters } from './mcpSchema';

describe('MCP 工具参数展开', () => {
  it('展开顶层参数、类型与必填', () => {
    const rows = describeMcpParameters({
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词' },
        limit: { type: ['number', 'null'], description: '条数' },
        mode: { type: 'string', enum: ['fast', 'deep'] }
      },
      required: ['query']
    });
    expect(rows).toEqual([
      { name: 'query', type: 'string', required: true, description: '搜索词', enumValues: [] },
      {
        name: 'limit',
        type: 'number | null',
        required: false,
        description: '条数',
        enumValues: []
      },
      {
        name: 'mode',
        type: 'string',
        required: false,
        description: '',
        enumValues: ['fast', 'deep']
      }
    ]);
  });

  it('展开一层嵌套对象与数组对象', () => {
    const rows = describeMcpParameters({
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: { owner: { type: 'string' } },
          required: ['owner']
        },
        items: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'number' } } }
        }
      }
    });
    expect(rows.map((row) => row.name)).toEqual([
      'filter',
      'filter.owner',
      'items',
      'items[].id'
    ]);
    expect(rows[1].required).toBe(true);
  });

  it('非法 schema 返回空数组', () => {
    expect(describeMcpParameters(null)).toEqual([]);
    expect(describeMcpParameters({})).toEqual([]);
  });
});
