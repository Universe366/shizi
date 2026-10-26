import type { SubtitleLine } from './types';

/** 解析 SRT / WebVTT 文本；不支持的时间轴（纯文本）返回空数组。 */
export function parseSubtitleText(text: string): SubtitleLine[] {
  const raw = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!raw) return [];

  const lines = raw.split('\n');
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    if (/^(WEBVTT|NOTE\b|STYLE\b|REGION\b)/i.test(line.trim()) && !current.length) continue;
    current.push(line);
  }
  if (current.length) blocks.push(current);

  const cues: SubtitleLine[] = [];
  for (const block of blocks) {
    const timeIndex = block.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;
    const timeLine = block[timeIndex];
    const match = timeLine.match(
      /((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/
    );
    if (!match) continue;
    const start = parseClock(match[1]);
    const end = parseClock(match[2]);
    if (start === null || end === null) continue;
    const after = timeLine.slice((match.index || 0) + match[0].length).trim();
    // WebVTT 在时间轴后还能跟 align/position/line/size/region 等 cue 设置，不是正文。
    const afterIsSettings = /^(?:align|position|line|size|region|vertical):/i.test(after);
    const body = [afterIsSettings ? '' : after, ...block.slice(timeIndex + 1)]
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]+\}/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (!body) continue;
    cues.push({ start, end: Math.max(start + 0.3, end), text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues.filter((cue, index) => index === 0 || cue.text !== cues[index - 1].text || cue.start !== cues[index - 1].start);
}

function parseClock(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value.trim());
  if (!match) return null;
  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}

export function subtitleFileNameHint(name: string): string {
  if (/\.(srt|vtt)$/i.test(name)) return '';
  return '只支持 .srt / .vtt 带时间轴的字幕文件';
}
