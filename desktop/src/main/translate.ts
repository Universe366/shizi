import type { AiPlatform, AppSettings, SubtitleLine } from '../shared/types';
import { loadSettings, platformForTask } from './settings';
import { needsApiKey } from './platformKey';
import { chatOnce } from './aiClient';
import { translateFree } from './freeTranslate';

const MAX_BATCH_LINES = 40;
const MAX_BATCH_CHARS = 6000;
const REQUEST_TIMEOUT_MS = 180000;

type Progress = (percent: number, message: string) => void;

export interface TranslateOptions {
  /** 批间带前后文（默认读设置） */
  useContext?: boolean;
  /** 译完对照原文反思一次（默认读设置） */
  reflect?: boolean;
  /** 并发批数 1-3（默认读设置） */
  concurrency?: number;
  /** LLM 不可用/失败时用免费翻译兜底（默认读设置） */
  freeFallback?: boolean;
}

function batchesOf(lines: SubtitleLine[]): SubtitleLine[][] {
  const batches: SubtitleLine[][] = [];
  let current: SubtitleLine[] = [];
  let chars = 0;
  for (const line of lines) {
    const length = line.text.length + 8;
    if (current.length >= MAX_BATCH_LINES || (current.length && chars + length > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(line);
    chars += length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function parseTranslatedLines(raw: string, expected: number): string[] {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const json = JSON.parse(text.slice(start, end + 1));
      const rows = Array.isArray(json?.lines)
        ? json.lines
        : Array.isArray(json?.translations)
          ? json.translations
          : null;
      if (rows) {
        return Array.from({ length: expected }, (_, index) => String(rows[index] ?? ''));
      }
    } catch {
      // 继续按行解析
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\s*[.、:：)\]]\s*/, '').trim())
    .filter(Boolean);
  return Array.from({ length: expected }, (_, index) => lines[index] || '');
}

function glossaryBlock(settings: AppSettings): string {
  const glossary = settings.correction?.glossary;
  if (!glossary?.enabled) return '';
  const terms = (glossary.terms || [])
    .filter((term) => term.from.trim() && term.to.trim())
    .slice(0, 60);
  if (!terms.length) return '';
  return `\n术语表（必须按此翻译）：\n${terms.map((term) => `${term.from} => ${term.to}`).join('\n')}`;
}

function contextBlock(batches: SubtitleLine[][], index: number): string {
  const previous = index > 0 ? batches[index - 1].slice(-2) : [];
  const next = index < batches.length - 1 ? batches[index + 1].slice(0, 2) : [];
  if (!previous.length && !next.length) return '';
  return [
    previous.length ? `前文（仅供理解，不要翻译）：\n${previous.map((line) => line.text).join('\n')}` : '',
    next.length ? `后文（仅供理解，不要翻译）：\n${next.map((line) => line.text).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

function parseReflection(raw: string, expected: number): string[] | null {
  const rows = parseTranslatedLines(raw, expected);
  return rows.some(Boolean) ? rows : null;
}

async function translateBatch(
  platform: AiPlatform,
  settings: AppSettings,
  target: string,
  batch: SubtitleLine[],
  context: string,
  reflect: boolean,
  signal?: AbortSignal
): Promise<string[]> {
  const numbered = batch.map((line, index) => `${index + 1}. ${line.text}`).join('\n');
  const result = await chatOnce(
    platform,
    [
      { role: 'system', content: `${settings.prompt.translate}\n\n目标语言：${target}${glossaryBlock(settings)}` },
      {
        role: 'user',
        content: `${context ? `${context}\n\n` : ''}共 ${batch.length} 条字幕，请逐条翻译：\n${numbered}`
      }
    ],
    {
      temperature: 0.2,
      maxTokens: settings.ai.maxTokens || undefined,
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal,
      task: 'translate'
    }
  );
  let rows = parseTranslatedLines(result.text, batch.length);
  if (!rows.some(Boolean)) throw new Error('AI 没有返回可解析的译文');
  if (!reflect) return rows;

  // 反思：把原文和初译一起给模型，只做必要修正，避免二次创作。
  try {
    const review = await chatOnce(
      platform,
      [
        {
          role: 'system',
          content:
            '你是字幕翻译审校。对照原文检查译文是否漏译、误译、术语不一致或过于生硬；' +
            '只做必要修正，不扩写、不解释。只输出 JSON：{"lines":["译文1","译文2"]}，行数与输入一致。'
        },
        {
          role: 'user',
          content: batch
            .map(
              (line, index) =>
                `${index + 1}. 原文：${line.text}\n   初译：${rows[index] || ''}`
            )
            .join('\n')
        }
      ],
      {
        temperature: 0.1,
        maxTokens: settings.ai.maxTokens || undefined,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal,
        task: 'translate'
      }
    );
    const reviewed = parseReflection(review.text, batch.length);
    if (reviewed) rows = reviewed;
  } catch (error) {
    if (signal?.aborted) throw error;
    // 审校失败不影响初译，保留初译继续。
  }
  return rows;
}

export async function translateLines(
  lines: SubtitleLine[],
  target: string,
  onProgress: Progress,
  signal?: AbortSignal,
  settingsOverride?: AppSettings,
  options: TranslateOptions = {}
): Promise<{ lines: SubtitleLine[]; language: string }> {
  const settings = settingsOverride || loadSettings();
  const platform = platformForTask('translate', settings);
  const freeFallback = options.freeFallback ?? settings.general.translateFreeFallback === true;
  const aiReady = Boolean(
    platform &&
      platform.baseUrl.trim() &&
      platform.model.trim() &&
      (!needsApiKey(platform) || platform.apiKey.trim())
  );
  if (!aiReady && !freeFallback) {
    if (!platform || !platform.baseUrl.trim()) throw new Error('请先在设置里选择一个 AI 平台');
    if (!platform.model.trim()) throw new Error('请先在设置里填写模型名');
    throw new Error('请先在设置里填写 API Key');
  }
  if (!lines.length) throw new Error('没有可翻译的字幕');

  const useContext = options.useContext ?? settings.general.translateContext !== false;
  const reflect = options.reflect ?? settings.general.translateReflect === true;
  const concurrency = Math.max(
    1,
    Math.min(3, Math.round(options.concurrency ?? settings.general.translateConcurrency ?? 2))
  );
  const batches = batchesOf(lines);
  const results: string[][] = new Array(batches.length);
  let cursor = 0;
  let finished = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= batches.length) return;
      if (signal?.aborted) throw new Error('已终止');
      const batch = batches[index];
      onProgress(
        (finished / batches.length) * 100,
        `翻译第 ${finished + 1} / ${batches.length} 批（${batch.length} 行，并发 ${concurrency}）`
      );
      results[index] = aiReady
        ? await translateBatch(
            platform as NonNullable<typeof platform>,
            settings,
            target,
            batch,
            useContext ? contextBlock(batches, index) : '',
            reflect,
            signal
          ).catch(async (error) => {
            if (!freeFallback || signal?.aborted) throw error;
            onProgress(
              (finished / batches.length) * 100,
              `第 ${index + 1} 批 AI 失败，改用免费翻译`
            );
            return translateFree(batch.map((line) => line.text), target, signal);
          })
        : await translateFree(batch.map((line) => line.text), target, signal);
      finished += 1;
      onProgress(
        (finished / batches.length) * 100,
        `已完成 ${finished} / ${batches.length} 批`
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, () => worker())
  );

  const translated = results.flat();
  onProgress(100, `翻译完成，共 ${translated.length} 行`);
  return {
    language: target,
    lines: lines.map((line, index) => ({
      ...line,
      text: translated[index] || line.text
    }))
  };
}
