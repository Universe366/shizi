/**
 * 对话级工具白名单：undefined = 不限制（全部工具），[] = 一个都不用。
 * 放在 shared 里便于单测，不依赖 Electron。
 */
export function selectByAllowed<T extends { qualifiedName: string }>(
  items: T[],
  allowed?: string[]
): T[] {
  if (!Array.isArray(allowed)) return items;
  const set = new Set(allowed.map(String));
  return items.filter((item) => set.has(item.qualifiedName));
}
