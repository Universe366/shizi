/** 知识库纯函数：分块、余弦相似度、时间戳与引用格式。 */

/** 把一段 Markdown/正文按段落切成目标大小的块，尽量不截断句子。 */
export function chunkText(input: string, size = 900, overlap = 80): string[] {
  const text = String(input || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      // 优先在段落/句号/换行处收口，避免把一句话劈开。
      const window = text.slice(start, end);
      const breakpoint = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. ')
      );
      if (breakpoint > size * 0.5) end = start + breakpoint + 1;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** 把检索结果拼成给模型的资料块，带 [n] 引用编号。 */
export function buildKbContext(hits: Array<{ title: string; startMs: number; text: string }>): string {
  return hits
    .map(
      (hit, index) =>
        `[${index + 1}] ${hit.title || '未命名'} @${clock(hit.startMs)}\n${hit.text.slice(0, 1800)}`
    )
    .join('\n\n');
}
