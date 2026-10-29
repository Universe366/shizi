import type { PageInfo, SubtitleLine } from '../shared/types';
import { activePrompt, loadSettings } from './settings';
import { DEFAULT_SUMMARY_FORMAT_RULES } from '../shared/summaryFormat';
import { fetchHotComments } from './comments';
import { glossaryTerms } from './correction';

const MAX_TRANSCRIPT_CHARS = 200000;

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** 官方分段转成提示词块；没有就返回空串。 */
function officialSegmentsBlock(info: PageInfo): string {
  const points = info.viewPoints || [];
  if (points.length < 2) return '';
  return [
    '【视频官方分段（必须沿用这些分段作为章节，不要另造章节标题）】',
    ...points.map(
      (point) => `- ${clock(point.start)} ~ ${clock(point.end)} ${point.title}`
    )
  ].join('\n');
}

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
  const glossary = glossaryTerms(settings);
  const glossaryBlock = glossary.length
    ? `\n\n术语表（输出时统一使用以下写法）：\n${glossary
        .slice(0, 80)
        .map((term) => `- ${term.from} → ${term.to}${term.note ? `（${term.note}）` : ''}`)
        .join('\n')}`
    : '';
  const system = [template.text, glossaryBlock, '', summaryFormatRules(settings)]
    .filter(Boolean)
    .join('\n');

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

  const meta = [
    `视频标题：${info.title || '未知'}`,
    `UP 主：${info.owner || '未知'}`,
    `视频时长：${clock(info.duration)}`,
    `链接：${info.url || ''}`,
    ...(settings.search.useVideoMeta !== false && info.desc
      ? [`视频简介：${info.desc.slice(0, 2000)}`]
      : []),
    ...(commentsBlock ? [commentsBlock] : []),
    ...(officialSegmentsBlock(info) ? [officialSegmentsBlock(info)] : [])
  ].join('\n');
  const user = [
    meta,
    '',
    '请基于上面的字幕写一份完整总结，严格按系统提示里的格式规则输出；不要写开场白或“根据字幕”这类过程说明。',
    '尽量详细：每个主题至少展开 2–4 个具体要点，保留数字、时间、步骤、例子和结论，不要只写一句话概括。',
    '需要外部事实时，可以调用联网搜索/读取网页；用到外部资料时用 [n] 标注来源。'
  ].join('\n');
  return { system, user };
}
