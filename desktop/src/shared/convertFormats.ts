/** 本地文件转换格式（Filee 风格）：只做 ffmpeg 能可靠离线完成的类型。 */
export type ConvertGroup = 'video' | 'audio' | 'image';

export interface ConvertFormat {
  id: string;
  label: string;
  group: ConvertGroup;
  ext: string;
}

export const CONVERT_FORMATS: ConvertFormat[] = [
  { id: 'mp4', label: 'MP4', group: 'video', ext: 'mp4' },
  { id: 'webm', label: 'WebM', group: 'video', ext: 'webm' },
  { id: 'mkv', label: 'MKV', group: 'video', ext: 'mkv' },
  { id: 'mov', label: 'MOV', group: 'video', ext: 'mov' },
  { id: 'gif', label: 'GIF', group: 'video', ext: 'gif' },
  { id: 'mp3', label: 'MP3', group: 'audio', ext: 'mp3' },
  { id: 'm4a', label: 'M4A', group: 'audio', ext: 'm4a' },
  { id: 'wav', label: 'WAV', group: 'audio', ext: 'wav' },
  { id: 'flac', label: 'FLAC', group: 'audio', ext: 'flac' },
  { id: 'ogg', label: 'OGG', group: 'audio', ext: 'ogg' },
  { id: 'png', label: 'PNG', group: 'image', ext: 'png' },
  { id: 'jpg', label: 'JPG', group: 'image', ext: 'jpg' },
  { id: 'webp', label: 'WebP', group: 'image', ext: 'webp' }
];

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'ts', 'mpg', 'mpeg'];
const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus', 'wma', 'aiff'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'gif', 'avif'];

export function convertGroupOf(path: string): ConvertGroup | null {
  const ext = String(path).split('.').pop()?.toLowerCase() || '';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

export function formatsForFile(path: string): ConvertFormat[] {
  const group = convertGroupOf(path);
  if (!group) return [];
  if (group === 'image') return CONVERT_FORMATS.filter((item) => item.group === 'image');
  if (group === 'audio') return CONVERT_FORMATS.filter((item) => item.group !== 'video' || item.id === 'gif');
  return CONVERT_FORMATS;
}
