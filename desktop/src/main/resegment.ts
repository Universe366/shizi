import type { SubtitleLine } from '../shared/types';
import { chatOnce } from './aiClient';
import { activePlatform, loadSettings } from './settings';

export interface ResegmentOptions {
  /** 每行目标最大字数 */
  maxChars: number;
  /** 合并后最短展示秒数（低于这个值的碎句优先并入相邻行） */
  minDuration: number;
  /** 用当前 AI 平台判断断句；失败自动退回规则 */
  useAi: boolean;
}

export interface ResegmentResult {
  lines: SubtitleLine[];
  /** 实际使用的策略：ai / rule */
  mode: 'ai' | 'rule';
  note: string;
}

const SENTENCE_END = /[。！？!?…]$/;
const PUNCT = /[，,。！？!?；;：:、]/;

function normalizeText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function joinText(a: string, b: string): string {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left) return right;
  if (!right) return left;
  // 中文直接拼；英文/数字之间补空格
  const needSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  return `${left}${needSpace ? ' ' : ''}${right}`;
}

function groupLines(lines: SubtitleLine[], groups: number[][]): SubtitleLine[] {
  const output: SubtitleLine[] = [];
  for (const group of groups) {
    const picked = group
      .map((index) => lines[index])
      .filter((line): line is SubtitleLine => Boolean(line));
    if (!picked.length) continue;
    output.push({
      start: picked[0].start,
      end: Math.max(picked[picked.length - 1].end, picked[0].start + 0.3),
      text: picked.reduce((text, line) => joinText(text, line.text), '')
    });
  }
  return output;
}

/** 规则断句：先合并碎句/未结束句，再把超长行按标点和字量拆分。 */
export function resegmentByRules(lines: SubtitleLine[], options: ResegmentOptions): SubtitleLine[] {
  const maxChars = Math.max(8, Math.min(80, Math.round(options.maxChars) || 24));
  const minDuration = Math.max(0.4, Math.min(6, Number(options.minDuration) || 1.2));
  const merged: SubtitleLine[] = [];
  for (const line of lines) {
    const text = normalizeText(line.text);
    if (!text) continue;
    const previous = merged[merged.length - 1];
    if (previous) {
      const gap = line.start - previous.end;
      const duration = previous.end - previous.start;
      const combined = joinText(previous.text, text);
      const closeGap = gap >= -0.25 && gap <= 1.2;
      const shouldMerge =
        combined.length <= maxChars &&
        closeGap &&
        (duration < minDuration || !SENTENCE_END.test(previous.text));
      if (shouldMerge) {
        previous.text = combined;
        previous.end = Math.max(previous.end, line.end);
        continue;
      }
    }
    merged.push({ start: line.start, end: line.end, text });
  }

  const output: SubtitleLine[] = [];
  for (const line of merged) {
    const text = line.text;
    if (text.length <= maxChars) {
      output.push(line);
      continue;
    }
    const parts: string[] = [];
    let rest = text;
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
    let cursor = line.start;
    const span = Math.max(0.3, line.end - line.start);
    for (const part of parts) {
      const duration = Math.max(0.3, (part.length / totalChars) * span);
      output.push({ start: cursor, end: cursor + duration, text: part });
      cursor += duration;
    }
  }
  return output;
}

/** LLM 只返回「哪些行属于同一句」，文本由程序拼接，避免模型改写字幕。 */
export function parseSegmentationGroups(text: string, count: number): number[][] | null {
  const raw = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const groups: number[][] = [];
  for (const row of parsed) {
    if (!Array.isArray(row)) return null;
    const group = row
      .map((value) => Number(value) - 1)
      .filter((value) => Number.isInteger(value) && value >= 0 && value < count);
    if (!group.length) return null;
    groups.push(group);
  }
  // 必须完整覆盖、且不重复/不倒序
  const flat = groups.flat();
  if (flat.length !== count) return null;
  for (let index = 0; index < flat.length; index += 1) {
    if (flat[index] !== index) return null;
  }
  return groups;
}

export function segmentationPrompt(lines: SubtitleLine[], maxChars: number): string {
  const numbered = lines.map((line, index) => `${index + 1}. ${line.text}`).join('\n');
  return [
    `下面是一部视频的 ${lines.length} 条字幕，请把相邻的短句合并成适合阅读的句子。`,
    `要求：每句尽量不超过 ${maxChars} 个字符；按语义断句，不要拆开一个完整的词/人名/数字；不要遗漏或重复任何一行。`,
    '只输出 JSON 数字数组，表示每一句包含第几行，例如 [[1,2],[3],[4,5]]，不要解释、不要 Markdown。',
    numbered
  ].join('\n');
}

export async function resegmentLines(
  lines: SubtitleLine[],
  options: ResegmentOptions,
  signal?: AbortSignal
): Promise<ResegmentResult> {
  const maxChars = Math.max(8, Math.min(80, Math.round(options.maxChars) || 24));
  if (!lines.length) return { lines: [], mode: 'rule', note: '没有字幕行' };
  if (!options.useAi || lines.length < 2) {
    return {
      lines: resegmentByRules(lines, { ...options, maxChars }),
      mode: 'rule',
      note: options.useAi ? '行数太少，使用规则断句' : '使用规则断句'
    };
  }
  const settings = loadSettings();
  const platform = activePlatform(settings);
  if (!platform?.baseUrl.trim() || !platform.model.trim()) {
    return {
      lines: resegmentByRules(lines, { ...options, maxChars }),
      mode: 'rule',
      note: '没有可用的 AI 平台，使用规则断句'
    };
  }

  const batches: SubtitleLine[][] = [];
  for (let index = 0; index < lines.length; index += 120) {
    batches.push(lines.slice(index, index + 120));
  }
  const groups: number[][] = [];
  let offset = 0;
  let aiBatches = 0;
  try {
    for (const batch of batches) {
      if (signal?.aborted) throw new Error('已终止');
      const result = await chatOnce(
        platform,
        [
          { role: 'system', content: '你是字幕断句助手，只做语义分组，不改写字幕文字。' },
          { role: 'user', content: segmentationPrompt(batch, maxChars) }
        ],
        { temperature: 0, maxTokens: 1500, timeoutMs: 60000, signal }
      );
      const parsed = parseSegmentationGroups(
        result.text || result.reasoning || '',
        batch.length
      );
      if (!parsed) throw new Error('AI 断句结果无法解析');
      for (const group of parsed) {
        groups.push(group.map((index) => index + offset));
      }
      offset += batch.length;
      aiBatches += 1;
    }
    const merged = groupLines(lines, groups);
    return {
      lines: resegmentByRules(merged, { ...options, useAi: false, maxChars }),
      mode: 'ai',
      note: `AI 合并 ${groups.length} 句（${aiBatches} 批）`
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      lines: resegmentByRules(lines, { ...options, maxChars }),
      mode: 'rule',
      note: `AI 断句失败，改用规则：${(error as Error).message}`
    };
  }
}
