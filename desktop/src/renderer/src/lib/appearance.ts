import { colorSchemeById } from '../../../shared/colorSchemes';

interface AppearanceInput {
  accentColor?: string;
  colorScheme?: string;
  density?: string;
  customCss?: string;
  uiRadius?: number;
  uiGlass?: boolean;
  uiMotion?: boolean;
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

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** 强调色上的文字：按对比度自动选白字或深字，深浅主题都不至于看不清。 */
function inkFor(accent: string): string {
  const ratio = luminance(accent);
  const onWhite = 1.05 / (ratio + 0.05);
  const onInk = (ratio + 0.05) / (luminance('#0b0f15') + 0.05);
  return onWhite >= onInk ? '#ffffff' : '#0b0f15';
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
  root.style.setProperty('--accent-ink', inkFor(accent));
  root.dataset.colorScheme = scheme.id || 'custom';
}

/** 主题配色、强调色、界面密度、自定义 CSS：由 App 在设置加载/变更时调用。 */
export function applyAppearance(general: AppearanceInput): void {
  current = general;
  applyColors();
  const root = document.documentElement;
  root.dataset.density = general.density === 'compact' ? 'compact' : 'comfortable';
  const radius = Math.min(24, Math.max(6, Number(general.uiRadius) || 14));
  root.style.setProperty('--radius-lg', `${radius}px`);
  root.style.setProperty('--radius-md', `${Math.max(6, radius - 4)}px`);
  root.dataset.uiGlass = general.uiGlass === false ? 'off' : 'on';
  root.dataset.uiMotion = general.uiMotion === false ? 'off' : 'on';

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
