/** 找出回答里超出参考文献范围的 [n] 编号（1-based）。 */
export function invalidCitationNumbers(text: string, referenceCount: number): number[] {
  const bad = new Set<number>();
  const pattern = /\[(\d{1,3})\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(text || '')))) {
    const number = Number(match[1]);
    if (!Number.isFinite(number) || number < 1 || number > referenceCount) {
      bad.add(number);
    }
  }
  return [...bad].sort((a, b) => a - b);
}
