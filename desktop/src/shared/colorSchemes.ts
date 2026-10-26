/** 桌面端 UI 配色预设：每种都有浅色/深色两套强调色。 */
export interface ColorScheme {
  id: string;
  label: string;
  light: { accent: string; soft: string };
  dark: { accent: string; soft: string };
}

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'slate',
    label: '海盐蓝',
    light: { accent: '#4f6f8f', soft: '#e9eff5' },
    dark: { accent: '#8fb0cc', soft: '#223039' }
  },
  {
    id: 'forest',
    label: '松林绿',
    light: { accent: '#3f7d62', soft: '#e7f2ec' },
    dark: { accent: '#7fbf9f', soft: '#1f332a' }
  },
  {
    id: 'ocean',
    label: '深海青',
    light: { accent: '#2f7189', soft: '#e4f1f5' },
    dark: { accent: '#6fb3c8', soft: '#1c2f36' }
  },
  {
    id: 'violet',
    label: '极光紫',
    light: { accent: '#6b5b9a', soft: '#eeeafa' },
    dark: { accent: '#a99ad6', soft: '#272338' }
  },
  {
    id: 'rose',
    label: '玫瑰粉',
    light: { accent: '#a64b64', soft: '#f7e8ed' },
    dark: { accent: '#d98aa0', soft: '#332027' }
  },
  {
    id: 'sakura',
    label: '樱花',
    light: { accent: '#b85c7a', soft: '#fbe9ef' },
    dark: { accent: '#e69ab2', soft: '#352229' }
  },
  {
    id: 'amber',
    label: '琥珀',
    light: { accent: '#a8722c', soft: '#f7eee0' },
    dark: { accent: '#d8b46a', soft: '#332a1c' }
  },
  {
    id: 'graphite',
    label: '石墨',
    light: { accent: '#5a616b', soft: '#ecedf0' },
    dark: { accent: '#a9b0ba', soft: '#282b30' }
  },
  {
    id: 'custom',
    label: '自定义',
    light: { accent: '#4f6f8f', soft: '#e9eff5' },
    dark: { accent: '#8fb0cc', soft: '#223039' }
  }
];

export const DEFAULT_COLOR_SCHEME = 'custom';

export function colorSchemeById(id: string | undefined): ColorScheme {
  return COLOR_SCHEMES.find((scheme) => scheme.id === id) || COLOR_SCHEMES[0];
}

export function isColorSchemeId(id: unknown): id is string {
  return COLOR_SCHEMES.some((scheme) => scheme.id === id);
}
