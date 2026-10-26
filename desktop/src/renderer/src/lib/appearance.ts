import { colorSchemeById } from '../../../shared/colorSchemes';

interface AppearanceInput {
  accentColor?: string;
  colorScheme?: string;
  density?: string;
  customCss?: string;
}

let current: AppearanceInput = {};
let media: MediaQueryList | null = null;

function isDark(): boolean {
  try {
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  } catch {
    return false;
  }
}

function applyColors(): void {
  const root = document.documentElement;
  const scheme = colorSchemeById(current.colorScheme);
  const custom =
    !current.colorScheme ||
    current.colorScheme === 'custom' ||
    !scheme ||
    scheme.id === 'custom';
  const accent = custom
    ? /^#[0-9a-f]{6}$/i.test(String(current.accentColor || ''))
      ? String(current.accentColor)
      : '#4f6f8f'
    : isDark()
      ? scheme.dark.accent
      : scheme.light.accent;
  const soft = custom ? `${accent}24` : isDark() ? scheme.dark.soft : scheme.light.soft;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-soft', soft);
  root.dataset.colorScheme = scheme.id || 'custom';
}

/** 主题配色、强调色、界面密度、自定义 CSS：由 App 在设置加载/变更时调用。 */
export function applyAppearance(general: AppearanceInput): void {
  current = general;
  applyColors();
  const root = document.documentElement;
  root.dataset.density = general.density === 'compact' ? 'compact' : 'comfortable';

  // 跟随系统深浅色时，预设配色需要跟着切换；监听只绑定一次。
  if (!media) {
    try {
      media = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
      media?.addEventListener?.('change', applyColors);
    } catch {
      media = null;
    }
  }

  let style = document.getElementById('shizi-custom-css') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'shizi-custom-css';
    document.head.appendChild(style);
  }
  style.textContent = String(general.customCss || '');
}
