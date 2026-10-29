import type { ComponentType } from 'react';
import {
  Bot,
  Captions,
  DatabaseBackup,
  Globe,
  Palette,
  Settings,
  Sparkles
} from 'lucide-react';

export interface SettingsGroup {
  id: string;
  label: string;
  description: string;
  /** 首次进入该分组时的 2–3 条上手提示。 */
  tips: string[];
  icon: ComponentType<{ size?: number | string; className?: string }>;
}

/**
 * 设置分组注册表：导航、标题和搜索索引都从这里派生。
 * 原则：左边只放 7 个用户能一眼理解的分类，细节留在右侧 section 里。
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'general',
    label: '通用',
    description: '启动、关闭、代理与快捷键',
    tips: [
      '第一次使用先到「AI 与语音」选平台、填 Key。',
      '开了系统加速器但 API 连不上时，到「网络代理」改成跟随系统。',
      '所有修改点右上角保存，快捷键 Ctrl+S。'
    ],
    icon: Settings
  },
  {
    id: 'appearance',
    label: '外观与浏览器',
    description: '主题、侧栏、标签栏、地址栏与阅读',
    tips: [
      '想更紧凑：把「界面密度」改成紧凑，字号调到 90%。',
      '标签栏默认在左侧，可改回顶部或隐藏。',
      '地址栏默认必应，可换 B 站 / Google / 自定义模板。'
    ],
    icon: Palette
  },
  {
    id: 'ai',
    label: 'AI 与语音',
    description: '模型、助手、语音识别与朗读、OCR、提示词',
    tips: [
      '先选一个 OpenAI 兼容或 Anthropic 平台，填 Base URL、模型和 Key，点「测试连接」。',
      '想省钱：在「按任务选模型」里让翻译/校对用便宜模型。',
      '「助手档案」可以把提示词、模型、技能、工具打包，在对话框里一键切换。'
    ],
    icon: Bot
  },
  {
    id: 'search',
    label: '检索与知识',
    description: '联网搜索、MCP 与技能',
    tips: [
      '总结前核对默认开启；没有检索 Key 也能用免费兜底。',
      'MCP 危险工具默认逐次确认，写入类操作不会静默执行。'
    ],
    icon: Globe
  },
  {
    id: 'subtitles',
    label: '字幕与播放',
    description: '字幕显示、播放倍速与导出默认',
    tips: [
      '字幕跟随默认开启，拖动进度条大跳转会重新定位。',
      '倍速支持页内面板和快捷键，按站点记忆。',
      '导出默认值只影响新导出，不影响已有文件。'
    ],
    icon: Captions
  },
  {
    id: 'desktop',
    label: '桌面助手',
    description: '桌宠、悬浮球、快捷取词与快捷键',
    tips: [
      '桌宠和悬浮球都使用「AI 与语音」里的当前平台。',
      '全局听写 / 快捷取词默认关闭，开启后记得确认热键不冲突。',
      '桌宠拖到屏幕边缘会停靠，悬停探出。'
    ],
    icon: Sparkles
  },
  {
    id: 'data',
    label: '数据与关于',
    description: '用量、备份、更新、诊断与站点权限',
    tips: [
      '换电脑前用「备份数据」导出设置、字幕库、对话与用量。',
      '更新只走 GitHub Releases，不在本地 publish。',
      '诊断导出会做脱敏，不包含 API Key 和正文。'
    ],
    icon: DatabaseBackup
  }
];

export function settingsGroup(id: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((group) => group.id === id);
}
