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

/**
 * 关键词评分（BM25 的轻量替代）：中文按 2 字滑窗、英文按词切分，
 * 返回 0–1 的覆盖率，用于和向量分数混合检索（参考 ReadAny 的 hybrid search）。
 */
export function keywordScore(query: string, text: string): number {
  const terms = tokenize(query);
  if (!terms.length) return 0;
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return 0;
  let matched = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matched += 1;
  }
  return matched / terms.length;
}

export function tokenize(input: string): string[] {
  const text = String(input || '').toLowerCase().trim();
  if (!text) return [];
  const terms = new Set<string>();
  for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    if (/[\u4e00-\u9fff]/.test(word)) {
      // 中文：单字 + 相邻二字组合，兼顾「断句」这类短语
      for (let index = 0; index < word.length; index += 1) {
        terms.add(word[index]);
        if (index + 1 < word.length) terms.add(word.slice(index, index + 2));
      }
    } else if (word.length > 1) {
      terms.add(word);
    }
  }
  return [...terms].slice(0, 60);
}

/** 混合分数：向量相似度为主，关键词命中做加成。 */
export function hybridScore(cosine: number, keyword: number, weight = 0.28): number {
  const vector = Math.max(0, Number(cosine) || 0);
  const lexical = Math.max(0, Math.min(1, Number(keyword) || 0));
  return (1 - weight) * vector + weight * lexical;
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
