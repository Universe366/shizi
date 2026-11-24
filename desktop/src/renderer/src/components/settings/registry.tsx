import type { ComponentType } from 'react';
import {
  Bot,
  Captions,
  DatabaseBackup,
  Download,
  Globe,
  Keyboard,
  Palette,
  Puzzle,
  Settings,
  Sparkles
} from 'lucide-react';

export interface SettingsGroup {
  id: string;
  label: string;
  description: string;
  /** 导航分组标题（借 Cherry Studio：分组标题 + 一页一件事） */
  navGroup: string;
  /** 首次进入该分组时的 2–3 条上手提示。 */
  tips: string[];
  icon: ComponentType<{ size?: number | string; className?: string }>;
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'general',
    label: '通用',
    description: '启动与主页、窗口、代理',
    navGroup: '基础',
    tips: [
      '第一次使用先到「AI 与模型」选平台、填 Key。',
      '加速器开着但 API 连不上时，把「网络代理」改成跟随系统。'
    ],
    icon: Settings
  },
  {
    id: 'appearance',
    label: '外观',
    description: '主题、密度、侧栏与工具栏',
    navGroup: '基础',
    tips: ['想要更紧凑：密度改成紧凑，字号调到 90%。', '标签栏默认在左侧，可改回顶部或隐藏。'],
    icon: Palette
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    description: '应用内与全局热键',
    navGroup: '基础',
    tips: ['点右侧按键即可重新录制；冲突会标红。'],
    icon: Keyboard
  },
  {
    id: 'browser',
    label: '浏览器',
    description: '地址栏、搜索引擎、网页与阅读',
    navGroup: '基础',
    tips: ['地址栏默认必应，可换 B 站 / Google / 自定义模板。', '选中文字是否弹出解释/翻译工具条在这里。'],
    icon: Globe
  },
  {
    id: 'ai',
    label: 'AI 与模型',
    description: '平台、对话、提示词、助手与联网检索',
    navGroup: 'AI',
    tips: [
      '先选一个 OpenAI 兼容或 Anthropic 平台，填 Base URL、模型和 Key，点「测试连接」。',
      '想省钱：给翻译/校对单独选便宜模型，其余任务跟随 AI 平台。'
    ],
    icon: Bot
  },
  {
    id: 'voice',
    label: '语音与字幕',
    description: '识别、字幕、翻译、校对、朗读与成片',
    navGroup: 'AI',
    tips: ['没有官方字幕时，先用「语音识别」把音轨转成字幕。', '字幕样式、跟随、翻译和成片都在这页。'],
    icon: Captions
  },
  {
    id: 'desktop',
    label: '桌面助手',
    description: '桌宠、悬浮球、取词与轮盘',
    navGroup: '工具',
    tips: ['桌宠和悬浮球都使用「AI 与模型」里的当前平台。', '全局取词默认关闭，开启后注意热键冲突。'],
    icon: Sparkles
  },
  {
    id: 'extensions',
    label: '扩展与自动化',
    description: 'MCP、技能、插件、浏览器扩展与本地接口',
    navGroup: '工具',
    tips: ['MCP 危险工具默认逐次确认，不会静默执行。', '插件 UI 运行在隔离 iframe 里，拿不到应用权限。'],
    icon: Puzzle
  },
  {
    id: 'download',
    label: '下载与导出',
    description: '视频下载默认值与导出格式',
    navGroup: '工具',
    tips: ['这里的默认值只影响新任务，不改变已有文件。'],
    icon: Download
  },
  {
    id: 'data',
    label: '数据与关于',
    description: '备份、更新、用量、诊断与站点权限',
    navGroup: '数据',
    tips: ['换电脑前用「备份数据」导出设置、字幕库、对话与用量。', '更新只走 GitHub Releases。'],
    icon: DatabaseBackup
  }
];

export function settingsGroup(id: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((group) => group.id === id);
}
