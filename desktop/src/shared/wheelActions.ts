import type { WheelActionId } from './types';

export const WHEEL_ACTION_LABELS: Record<WheelActionId, string> = {
  summary: '总结本页',
  chat: 'AI 对话',
  newChat: '新对话',
  library: '工作台',
  settings: '设置',
  start: '起始页',
  find: '页内查找',
  reader: '阅读模式',
  reload: '刷新页面',
  none: '留空'
};

export const WHEEL_ACTION_ORDER: WheelActionId[] = [
  'summary',
  'chat',
  'newChat',
  'library',
  'settings',
  'start',
  'find',
  'reader',
  'reload',
  'none'
];
