/** 长视频分层合并：把分段总结按字符预算分组，避免一次性超过模型上下文。 */
export function packMergeGroups(items: string[], maxChars: number): string[][] {
  const budget = Math.max(2000, Math.round(maxChars));
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const raw of items) {
    const item = String(raw || '').trim();
    if (!item) continue;
    const chunk = item.length > budget ? item.slice(0, budget) : item;
    if (current.length && size + chunk.length > budget) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(chunk);
    size += chunk.length + 2;
  }
  if (current.length) groups.push(current);
  return groups;
}
