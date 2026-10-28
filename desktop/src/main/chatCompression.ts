import { chatOnce } from './aiClient';
import type { AiMessage } from './aiClient';
import type { AiPlatform, AppSettings } from '../shared/types';
import { estimateMessagesTokens } from '../shared/chatTokens';

/**
 * 对话自动压缩：把较早消息交给当前模型总结，只保留摘要 + 最近 N 条。
 * 摘要按会话缓存，后续请求不必每轮重新总结。
 */

interface CompressionCacheEntry {
  covered: number;
  summary: string;
}

const summaryCache = new Map<number, CompressionCacheEntry>();

export function clearCompressionCache(conversationId?: number): void {
  if (conversationId === undefined) summaryCache.clear();
  else summaryCache.delete(conversationId);
}

export function buildTranscript(messages: AiMessage[], maxChars = 30000): string {
  const lines: string[] = [];
  let total = 0;
  for (const message of messages) {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('');
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const line = `${message.role === 'assistant' ? 'AI' : '用户'}：${clean.slice(0, 1500)}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join('\n');
}

export interface CompressionInput {
  platform: AiPlatform;
  messages: AiMessage[];
  settings: AppSettings;
  conversationId?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export interface CompressionResult {
  messages: AiMessage[];
  compressed: number;
}

export async function compressHistory(input: CompressionInput): Promise<CompressionResult> {
  const { platform, settings, conversationId } = input;
  if (settings.ai.contextAutoCompress === false || !conversationId) {
    return { messages: input.messages, compressed: 0 };
  }
  const keep = Math.min(50, Math.max(2, Math.round(settings.ai.contextKeepRecent || 10)));
  const threshold = Math.min(
    200000,
    Math.max(2000, Math.round(settings.ai.contextCompressTokens || 24000))
  );

  let cache = summaryCache.get(conversationId);
  if (cache && cache.covered > input.messages.length) {
    summaryCache.delete(conversationId);
    cache = undefined;
  }
  const covered = cache ? Math.min(cache.covered, input.messages.length) : 0;
  const baseSummary = cache?.summary || '';
  const effective: AiMessage[] = baseSummary
    ? [
        { role: 'user', content: `以下是本次对话较早内容的摘要：\n${baseSummary}` },
        ...input.messages.slice(covered)
      ]
    : input.messages;
  if (estimateMessagesTokens(effective) <= threshold) {
    return { messages: effective, compressed: 0 };
  }

  const coveredCount = input.messages.length - keep;
  if (coveredCount <= covered) return { messages: effective, compressed: 0 };
  const older = input.messages.slice(covered, coveredCount);
  if (!older.length) return { messages: effective, compressed: 0 };

  const transcript = [baseSummary ? `已有摘要：\n${baseSummary}` : '', buildTranscript(older)]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 30000);
  try {
    input.onStatus?.(`上下文较长，正在压缩 ${older.length} 条旧消息…`);
    const result = await chatOnce(
      platform,
      [
        {
          role: 'system',
          content:
            '你是对话摘要助手。把对话压缩成中文摘要，保留事实、结论、决定、待办和未解决问题；不要寒暄，不要编造，控制在 600 字以内。'
        },
        { role: 'user', content: transcript }
      ],
      { task: 'quick', maxTokens: 800, temperature: 0.2, signal: input.signal }
    );
    const summary = result.text.trim().slice(0, 4000);
    if (!summary) return { messages: effective, compressed: 0 };
    summaryCache.set(conversationId, { covered: coveredCount, summary });
    input.onStatus?.(`已压缩 ${coveredCount} 条旧消息`);
    return {
      messages: [
        {
          role: 'user',
          content: `以下是本次对话较早内容的摘要（共 ${coveredCount} 条消息）：\n${summary}`
        },
        ...input.messages.slice(coveredCount)
      ],
      compressed: coveredCount
    };
  } catch (error) {
    console.warn('[chat] 压缩上下文失败:', (error as Error).message);
    return { messages: effective, compressed: 0 };
  }
}
