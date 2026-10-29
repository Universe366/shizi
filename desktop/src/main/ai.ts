import type { PageInfo, SubtitleLine } from '../shared/types';
import { activePrompt, loadSettings } from './settings';
import { DEFAULT_SUMMARY_FORMAT_RULES } from '../shared/summaryFormat';
import { buildSummaryPrompt, clock } from '../shared/core/summary';
import { fetchHotComments } from './comments';
import { glossaryTerms } from './correction';

const MAX_TRANSCRIPT_CHARS = 200000;

export function buildTranscript(info: PageInfo, lines: SubtitleLine[]): string {
  let text = lines.map((line) => `[${clock(line.start)}] ${line.text}`).join('\n');
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    const head = text.slice(0, MAX_TRANSCRIPT_CHARS - 6000);
    const tail = text.slice(-5000);
    text = `${head}\n…（中间字幕过长，已省略）…\n${tail}`;
  }
  return text;
}

function summaryFormatRules(settings: ReturnType<typeof loadSettings>): string {
  return String(settings.prompt.summaryFormatRules || '').trim() || DEFAULT_SUMMARY_FORMAT_RULES;
}

/** 把原总结提示词/格式规则交给对话式联网，尽量保留总结格式。 */
export async function buildSummaryChatPrompt(
  info: PageInfo,
  options?: { signal?: AbortSignal; onStatus?: (status: string) => void }
): Promise<{ system: string; user: string }> {
  const settings = loadSettings();
  const template = activePrompt(settings);
  let commentsBlock = '';
  if (settings.search.useComments && info.aid) {
    options?.onStatus?.('正在获取热门评论…');
    try {
      const comments = await fetchHotComments(
        info,
        Math.max(1, Math.min(30, Number(settings.search.hotCommentCount) || 12))
      );
      if (options?.signal?.aborted) throw new Error('已终止');
      if (comments.length) {
        commentsBlock = [
          '',
          '热门评论（仅作观众观点参考，不代表事实；不要逐条复述）：',
          ...comments.map(
            (comment, index) =>
              `${index + 1}. [${comment.like} 赞] ${comment.author}：${comment.content.slice(0, 180)}`
          )
        ].join('\n');
        options?.onStatus?.(`已获取 ${comments.length} 条热门评论`);
      }
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      options?.onStatus?.(`评论获取失败：${(error as Error).message}（继续总结）`);
    }
  }

  return buildSummaryPrompt({
    info,
    promptText: template.text,
    formatRules: summaryFormatRules(settings),
    glossary: glossaryTerms(settings),
    useVideoMeta: settings.search.useVideoMeta !== false,
    commentsBlock
  });
}
