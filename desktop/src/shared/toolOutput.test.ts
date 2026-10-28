import { describe, expect, it } from 'vitest';
import {
  TOOL_OUTPUT_INLINE,
  TOOL_OUTPUT_PAGE,
  readToolOutputChunk,
  truncateToolOutput
} from './toolOutput';

describe('工具输出分段', () => {
  it('短输出原样返回', () => {
    const result = truncateToolOutput('hello', 'id', 'app__read_tool_output');
    expect(result).toEqual({ text: 'hello', truncated: false });
  });

  it('长输出截断并给出 id/offset 提示', () => {
    const content = 'a'.repeat(TOOL_OUTPUT_INLINE + 100);
    const result = truncateToolOutput(content, 'tool-1', 'app__read_tool_output');
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('a'.repeat(TOOL_OUTPUT_INLINE))).toBe(true);
    expect(result.text).toContain('tool-1');
    expect(result.text).toContain(`offset=${TOOL_OUTPUT_INLINE}`);
  });

  it('分段读取带区间与下一段 offset', () => {
    const content = 'b'.repeat(TOOL_OUTPUT_PAGE + 10);
    const first = readToolOutputChunk(content, 0);
    expect(first.text.startsWith(`[0-${TOOL_OUTPUT_PAGE}/`)).toBe(true);
    expect(first.nextOffset).toBe(TOOL_OUTPUT_PAGE);
    const second = readToolOutputChunk(content, first.nextOffset as number);
    expect(second.text.startsWith(`[${TOOL_OUTPUT_PAGE}-${content.length}/`)).toBe(true);
    expect(second.nextOffset).toBeNull();
    expect(readToolOutputChunk(content, 999999).text).toContain(
      `[${content.length}-${content.length}/${content.length}]`
    );
  });
});
