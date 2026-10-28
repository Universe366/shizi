/** 粗略 token 估算：CJK 约 1.1 token/字，其他约 4 字符/token。 */
export function estimateTextTokens(text: string): number {
  const value = String(text || '');
  if (!value) return 0;
  const cjk = (value.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return Math.max(1, Math.ceil(cjk * 1.1 + (value.length - cjk) / 4));
}

export function estimateMessagesTokens(
  messages: Array<{ content?: string | Array<{ type?: string; text?: string }> }>
): number {
  return messages.reduce((sum, message) => {
    const content = message.content;
    const text = Array.isArray(content)
      ? content.map((part) => String(part?.text || '')).join('')
      : String(content || '');
    return sum + estimateTextTokens(text);
  }, 0);
}
