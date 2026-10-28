/** 清除上下文后，只把标记之后的消息发给模型（界面仍保留全部）。 */
export function contextMessages<T>(messages: T[], start: number | null): T[] {
  if (start === null || !Number.isFinite(start) || start <= 0) return messages;
  return messages.slice(Math.min(Math.floor(start), messages.length));
}

/** 把另一个历史对话压缩成可插入输入框的引用块。 */
export function formatConversationReference(
  title: string,
  rows: Array<{ role: string; content: string }>,
  maxChars = 1600
): string {
  const lines = [`> 引用对话「${title}」`];
  for (const row of rows.slice(-8)) {
    const text = String(row.content || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const line = `> ${row.role === 'assistant' ? 'AI' : '用户'}：${text.slice(0, 300)}`;
    if (lines.join('\n').length + line.length > maxChars) break;
    lines.push(line);
  }
  if (lines.length === 1) lines.push('> （这个对话还没有内容）');
  return `${lines.join('\n')}\n\n`;
}
