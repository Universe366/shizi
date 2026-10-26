/** 字幕面板工具栏按钮：用户可以按需隐藏，避免小功能堆得太密。 */
export const SUBTITLE_TOOLBAR_ITEMS = [
  { id: 'ingest', label: '入库' },
  { id: 'collection', label: '合集' },
  { id: 'asr', label: '转写' },
  { id: 'import', label: '导入字幕' },
  { id: 'resegment', label: '断句' },
  { id: 'translate', label: '翻译' },
  { id: 'optimize', label: '优化' },
  { id: 'summary', label: '总结' },
  { id: 'chapters', label: '章节' },
  { id: 'quality', label: '质检' },
  { id: 'export', label: '导出' },
  { id: 'follow', label: '跟随' }
] as const;

export type SubtitleToolbarId = (typeof SUBTITLE_TOOLBAR_ITEMS)[number]['id'];

export const SUBTITLE_TOOLBAR_IDS = SUBTITLE_TOOLBAR_ITEMS.map((item) => item.id);

export const DEFAULT_SUBTITLE_TOOLBAR: SubtitleToolbarId[] = [...SUBTITLE_TOOLBAR_IDS];

export function isSubtitleToolbarId(value: unknown): value is SubtitleToolbarId {
  return typeof value === 'string' && (SUBTITLE_TOOLBAR_IDS as string[]).includes(value);
}
