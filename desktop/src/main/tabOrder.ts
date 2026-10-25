/**
 * 标签关闭后的落点：和 Edge / Chrome 一样优先激活右邻居，没有右邻居才回退到左邻居。
 * 输入是关闭前的标签 id 顺序（Map 插入顺序，也就是标签栏的基准顺序）。
 */
export function neighborAfterClose(ids: readonly string[], closingId: string): string | null {
  const index = ids.indexOf(closingId);
  if (index < 0) return ids.length ? ids[ids.length - 1] : null;
  if (index + 1 < ids.length) return ids[index + 1];
  if (index - 1 >= 0) return ids[index - 1];
  return null;
}
