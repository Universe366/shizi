/** 清除上下文后，只把标记之后的消息发给模型（界面仍保留全部）。 */
export function contextMessages<T>(messages: T[], start: number | null): T[] {
  if (start === null || !Number.isFinite(start) || start <= 0) return messages;
  return messages.slice(Math.min(Math.floor(start), messages.length));
}
