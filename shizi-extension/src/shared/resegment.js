// 规则断句：合并碎句/未结束句，再按标点和字量拆分。移植自桌面端 resegment.ts。
const SENTENCE_END = /[。！？!?…]$/;
const PUNCT = /[，,。！？!?；;：:、]/;

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function joinText(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left) return right;
  if (!right) return left;
  const needSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  return `${left}${needSpace ? ' ' : ''}${right}`;
}

export function resegmentByRules(lines, options = {}) {
  const maxChars = Math.max(8, Math.min(80, Math.round(options.maxChars) || 24));
  const minDuration = Math.max(0.4, Math.min(6, Number(options.minDuration) || 1.2));
  const merged = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = normalizeText(line.text);
    if (!text) continue;
    const from = Number(line.from) || 0;
    const to = Math.max(from + 0.3, Number(line.to) || from + 0.3);
    const previous = merged[merged.length - 1];
    if (previous) {
      const gap = from - previous.to;
      const duration = previous.to - previous.from;
      const combined = joinText(previous.text, text);
      const closeGap = gap >= -0.25 && gap <= 1.2;
      const shouldMerge = combined.length <= maxChars && closeGap && (duration < minDuration || !SENTENCE_END.test(previous.text));
      if (shouldMerge) {
        previous.text = combined;
        previous.to = Math.max(previous.to, to);
        continue;
      }
    }
    merged.push({ from, to, text });
  }

  const output = [];
  for (const line of merged) {
    if (line.text.length <= maxChars) {
      output.push(line);
      continue;
    }
    const parts = [];
    let rest = line.text;
    while (rest.length > maxChars) {
      let cut = -1;
      for (let index = Math.min(maxChars, rest.length - 1); index >= Math.max(6, maxChars / 2); index -= 1) {
        if (PUNCT.test(rest[index - 1])) {
          cut = index;
          break;
        }
      }
      if (cut < 0) cut = maxChars;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || 1;
    let cursor = line.from;
    const span = Math.max(0.3, line.to - line.from);
    for (const part of parts) {
      const duration = Math.max(0.3, (part.length / totalChars) * span);
      output.push({ from: cursor, to: cursor + duration, text: part });
      cursor += duration;
    }
  }
  return output;
}
