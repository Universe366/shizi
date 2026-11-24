import type { ComponentType } from 'react';
import { Bot, Captions, DatabaseBackup, Palette, Settings, SlidersHorizontal, Sparkles } from 'lucide-react';

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
 * 原则：主设置只放日常会改的 6 组；专业参数统一收进「高级」。
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'general',
    label: '通用',
    description: '启动与主页、窗口、代理',
    tips: [
      '第一次使用先到「AI 与模型」选平台、填 Key。',
      '加速器开着但 API 连不上时，把「网络代理」改成跟随系统。',
      '修改后右上角保存，快捷键 Ctrl+S。'
    ],
    icon: Settings
  },
  {
    id: 'appearance',
    label: '外观',
    description: '主题、密度、侧栏、工具栏与网页阅读',
    tips: [
      '想要更紧凑：把「界面密度」改成紧凑，字号调到 90%。',
      '标签栏默认在左侧，可改回顶部或隐藏。',
      '地址栏默认必应，可换 B 站 / Google / 自定义模板。'
    ],
    icon: Palette
  },
  {
    id: 'ai',
    label: 'AI 与模型',
    description: '平台、对话、提示词与联网检索',
    tips: [
      '先选一个 OpenAI 兼容或 Anthropic 平台，填 Base URL、模型和 Key，点「测试连接」。',
      '想省钱：在「高级 → 各功能模型」里给翻译/校对单独选便宜模型。',
      '联网检索没有 Key 也能用免费兜底。'
    ],
    icon: Bot
  },
  {
    id: 'media',
    label: '语音与字幕',
    description: '语音识别、字幕、翻译与校对',
    tips: [
      '没有官方字幕时，先用「语音识别」把音轨转成字幕。',
      '字幕样式、跟随、翻译和成片都收在同一张卡里。'
    ],
    icon: Captions
  },
  {
    id: 'desktop',
    label: '桌面助手',
    description: '桌宠、悬浮球与全局取词',
    tips: [
      '桌宠和悬浮球都使用「AI 与模型」里的当前平台。',
      '全局取词默认关闭，开启后注意热键不要冲突。'
    ],
    icon: Sparkles
  },
  {
    id: 'data',
    label: '数据与关于',
    description: '备份、更新与诊断',
    tips: [
      '换电脑前用「备份数据」导出设置、字幕库、对话与用量。',
      '更新只走 GitHub Releases，不在本地 publish。'
    ],
    icon: DatabaseBackup
  },
  {
    id: 'advanced',
    label: '高级',
    description: '快捷键、下载、本地模型、插件、MCP 与开发者选项',
    tips: [
      '这里都是低频或专业选项；不确定时保持默认即可。',
      '改坏了可以在「数据与关于 → 备份」里恢复设置。'
    ],
    icon: SlidersHorizontal
  }
];

export function settingsGroup(id: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((group) => group.id === id);
}
