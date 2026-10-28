import type { PageInfo, SubtitleLine, VerificationSummary } from '../shared/types';
import { chat } from './chat';
import { buildSummaryChatPrompt } from './ai';

export interface SummarizeChatOptions {
  info: PageInfo;
  lines: SubtitleLine[];
  web?: boolean;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onStatus?: (status: string) => void;
}

export interface SummarizeChatResult {
  text: string;
  model: string;
  verification?: VerificationSummary;
}

/** 字幕总结的唯一联网流程：原总结提示词 + 对话式联网工具循环。 */
export async function summarizeChat(options: SummarizeChatOptions): Promise<SummarizeChatResult> {
  const prompt = buildSummaryChatPrompt(options.info);
  const result = await chat({
    info: options.info,
    lines: options.lines,
    systemPrompt: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    page: null,
    includeTranscript: true,
    web: options.web !== false,
    mcpToolIds: [],
    surface: 'main',
    signal: options.signal,
    onDelta: options.onDelta,
    onReasoning: options.onReasoning,
    onStatus: options.onStatus
  });
  if (!result.text.trim()) throw new Error('AI 返回为空');
  const verification = result.references?.length
    ? {
        items: [],
        references: [],
        supplements: [],
        attempted: 0,
        failed: 0,
        judged: false,
        dropped: 0,
        sources: result.references
      }
    : undefined;
  return { text: result.text, model: result.model, verification };
}
