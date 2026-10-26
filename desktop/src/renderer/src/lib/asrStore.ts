import type { PageInfo, SubtitleLine } from '../../../shared/types';

export type LocalSubtitleSource = 'asr' | 'import';

interface AsrResult {
  key: string;
  info: PageInfo;
  lines: SubtitleLine[];
  source: LocalSubtitleSource;
  /** 伪轨的地址：asr://local 或 import://local */
  url: string;
  /** 伪轨显示名：语音转录 / 导入：xxx.srt */
  label: string;
}

let current: AsrResult | null = null;

export function setAsrResult(
  key: string,
  info: PageInfo,
  lines: SubtitleLine[],
  source: LocalSubtitleSource = 'asr',
  label?: string
): void {
  current = {
    key,
    info,
    lines,
    source,
    url: source === 'import' ? 'import://local' : 'asr://local',
    label: label || (source === 'import' ? '导入字幕' : '语音转录')
  };
}

export function getAsrResult(key: string): AsrResult | null {
  return current && current.key === key ? current : null;
}

export function clearAsrResult(): void {
  current = null;
}
