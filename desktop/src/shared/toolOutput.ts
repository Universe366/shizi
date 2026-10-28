/** 工具输出分段：内联一部分，剩余内容由 app__read_tool_output 按 offset 读取。 */

export const TOOL_OUTPUT_INLINE = 8000;
export const TOOL_OUTPUT_PAGE = 6000;

export interface TruncatedToolOutput {
  text: string;
  truncated: boolean;
}

export function truncateToolOutput(
  content: string,
  id: string,
  readToolName: string,
  inline = TOOL_OUTPUT_INLINE
): TruncatedToolOutput {
  const value = String(content || '');
  if (value.length <= inline) return { text: value, truncated: false };
  return {
    text:
      value.slice(0, inline) +
      `\n\n[工具输出已截断：共 ${value.length} 字符，用 ${readToolName} 读取剩余内容，id="${id}"，offset=${inline}]`,
    truncated: true
  };
}

export function readToolOutputChunk(
  content: string,
  offset: number,
  page = TOOL_OUTPUT_PAGE
): { text: string; nextOffset: number | null } {
  const value = String(content || '');
  const start = Math.max(0, Math.min(value.length, Math.floor(Number(offset) || 0)));
  const chunk = value.slice(start, start + page);
  return {
    text: `[${start}-${start + chunk.length}/${value.length}]\n${chunk}`,
    nextOffset: start + chunk.length < value.length ? start + chunk.length : null
  };
}
