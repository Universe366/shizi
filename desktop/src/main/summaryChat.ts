import type { PageInfo, SubtitleLine, VerificationSummary } from '../shared/types';
import { chat } from './chat';
import { buildSummaryChatPrompt } from './ai';
import { loadSettings } from './settings';

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

function textChars(lines: SubtitleLine[]): number {
  return lines.reduce((sum, line) => sum + String(line.text || '').length, 0);
}

/** 按字符预算均分字幕，保留每条字幕完整。 */
function splitLines(lines: SubtitleLine[], count: number): SubtitleLine[][] {
  const total = textChars(lines);
  if (count <= 1 || total <= 0) return [lines];
  const target = total / count;
  const chunks: SubtitleLine[][] = [];
  let current: SubtitleLine[] = [];
  let currentChars = 0;
  for (const line of lines) {
    const length = String(line.text || '').length;
    if (current.length && currentChars + length > target && chunks.length < count - 1) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(line);
    currentChars += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function segmentCount(lines: SubtitleLine[]): number {
  const settings = loadSettings();
  const configured = Math.max(0, Math.min(20, Number(settings.search.summarySegments) || 0));
  if (configured > 0) return configured;
  const chars = textChars(lines);
  if (chars <= 20000) return 1;
  return Math.max(2, Math.min(8, Math.ceil(chars / 18000)));
}

function verificationOf(references: unknown[]): VerificationSummary | undefined {
  return references.length
    ? {
        items: [],
        references: [],
        supplements: [],
        attempted: 0,
        failed: 0,
        judged: false,
        dropped: 0,
        sources: references as VerificationSummary['sources']
      }
    : undefined;
}

/** 字幕总结的唯一联网流程：原总结提示词 + 对话式联网工具循环。 */
export async function summarizeChat(options: SummarizeChatOptions): Promise<SummarizeChatResult> {
  const prompt = buildSummaryChatPrompt(options.info);
  const count = segmentCount(options.lines);

  if (count <= 1) {
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
    return {
      text: result.text,
      model: result.model,
      verification: verificationOf(result.references || [])
    };
  }

  const chunks = splitLines(options.lines, count);
  const parts: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    options.onStatus?.(`分段总结 ${index + 1}/${chunks.length}…`);
    const part = await chat({
      info: options.info,
      lines: chunks[index],
      systemPrompt: prompt.system,
      messages: [
        {
          role: 'user',
          content: `${prompt.user}\n\n这是第 ${index + 1}/${chunks.length} 段字幕。只整理这一段，做成结构化笔记；不要写“本段/接下来”这类过渡语，也不要臆测其它段落。`
        }
      ],
      page: null,
      includeTranscript: true,
      web: false,
      mcpToolIds: [],
      surface: 'main',
      signal: options.signal,
      onReasoning: options.onReasoning
    });
    if (!part.text.trim()) throw new Error(`第 ${index + 1} 段总结为空`);
    parts.push(part.text.trim());
  }

  options.onStatus?.(`合并 ${parts.length} 段总结并联网核对…`);
  const merged = await chat({
    info: options.info,
    lines: [],
    systemPrompt: prompt.system,
    messages: [
      {
        role: 'user',
        content: [
          prompt.user,
          '',
          `下面是同一视频的 ${parts.length} 段分段总结。请合并成一份最终总结，覆盖全片、去重、保留数字/时间/步骤；段落之间冲突时以字幕内容为准。需要外部事实时可以联网搜索/读取网页，并在用到时标注来源。`,
          '',
          ...parts.map((part, index) => `【第 ${index + 1} 段】\n${part.slice(0, 6000)}`)
        ].join('\n')
      }
    ],
    page: null,
    includeTranscript: false,
    web: options.web !== false,
    mcpToolIds: [],
    surface: 'main',
    signal: options.signal,
    onDelta: options.onDelta,
    onReasoning: options.onReasoning,
    onStatus: options.onStatus
  });
  const text = merged.text.trim() || parts.join('\n\n---\n\n');
  return {
    text,
    model: merged.model,
    verification: verificationOf(merged.references || [])
  };
}
