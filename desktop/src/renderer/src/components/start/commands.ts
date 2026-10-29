import {
  BookOpen,
  Bookmark,
  CloudSun,
  Command,
  Download,
  Flame,
  Globe,
  History,
  ListChecks,
  Palette,
  Pencil,
  Search,
  Sparkles,
  StickyNote,
  Timer,
  Upload,
  type LucideIcon
} from 'lucide-react';
import type { StartShortcut } from '../../../../shared/types';
import type { PaletteCommand } from './CommandPalette';
import type { BuiltInEntry } from './ShortcutBoard';
import { WIDGET_LABELS } from './model';

export interface StartCommandContext {
  minimal: boolean;
  editMode: boolean;
  toggleMinimal: () => void;
  toggleEdit: () => void;
  focusSearch: () => void;
  openOnboarding: () => void;
  openWallpaper: () => void;
  exportStart: () => void;
  importStart: () => void;
  builtIn: BuiltInEntry[];
  widgetVisible: (id: string) => boolean;
  toggleWidget: (id: string) => void;
  engineLabel: string;
  shortcuts: StartShortcut[];
  openShortcut: (item: StartShortcut) => void;
}

const WIDGET_ICONS: Record<string, LucideIcon> = {
  weather: CloudSun,
  todo: ListChecks,
  pomodoro: Timer,
  notes: StickyNote,
  hot: Flame,
  recent: BookOpen,
  history: History
};

/** 起始页指令面板的静态命令；动态搜索命令见 buildStartQueryCommands。 */
export function buildStartCommands(context: StartCommandContext): PaletteCommand[] {
  return [
    {
      id: 'zen',
      group: '操作',
      label: context.minimal ? '退出禅模式' : '进入禅模式',
      hint: 'Esc 退出',
      icon: Sparkles,
      run: context.toggleMinimal
    },
    {
      id: 'edit',
      group: '操作',
      label: context.editMode ? '退出编辑' : '编辑快捷方式',
      hint: 'E',
      icon: Pencil,
      run: context.toggleEdit
    },
    {
      id: 'focus-search',
      group: '操作',
      label: '聚焦搜索框',
      hint: '/',
      icon: Search,
      run: context.focusSearch
    },
    {
      id: 'shortcut-help',
      group: '操作',
      label: '快捷键说明',
      hint: '?',
      icon: Command,
      run: context.openOnboarding
    },
    {
      id: 'wallpaper',
      group: '操作',
      label: '更换壁纸',
      icon: Palette,
      run: context.openWallpaper
    },
    {
      id: 'export',
      group: '操作',
      label: '导出起始页数据',
      icon: Download,
      run: context.exportStart
    },
    {
      id: 'import',
      group: '操作',
      label: '导入起始页数据',
      icon: Upload,
      run: context.importStart
    },
    ...context.builtIn.map((entry) => ({
      id: `page-${entry.id}`,
      group: '页面',
      label: entry.label,
      icon: entry.icon,
      run: entry.run
    })),
    ...Object.keys(WIDGET_LABELS).map((id) => ({
      id: `widget-${id}`,
      group: '小组件',
      label: `${context.widgetVisible(id) ? '隐藏' : '显示'}${WIDGET_LABELS[id] || id}`,
      icon: WIDGET_ICONS[id] || Sparkles,
      run: () => context.toggleWidget(id)
    })),
    ...context.shortcuts.map((item) => ({
      id: `open-${item.id}`,
      group: '快捷方式',
      label: item.label,
      hint: item.url.replace(/^https?:\/\//, '').split('/')[0],
      icon: Bookmark,
      run: () => context.openShortcut(item)
    }))
  ];
}

export function buildStartQueryCommands(
  value: string,
  engineLabel: string,
  commitSearch: (text: string) => void
): PaletteCommand[] {
  const text = value.trim();
  if (!text) return [];
  const video = /^(BV[0-9A-Za-z]{10}|av\d+)$/i.test(text);
  const target = video ? `https://www.bilibili.com/video/${text}` : text;
  const openable = video || /^(https?:\/\/|www\.)/i.test(text) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(text);
  return [
    {
      id: 'palette-search',
      group: '搜索',
      label: openable ? `打开 ${text}` : `在 ${engineLabel} 搜索“${text}”`,
      icon: openable ? Globe : Search,
      run: () => commitSearch(target)
    }
  ];
}
