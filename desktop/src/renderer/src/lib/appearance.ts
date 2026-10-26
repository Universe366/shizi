/** 主题强调色、界面密度、自定义 CSS：由 App 在设置加载/变更时调用。 */
export function applyAppearance(general: {
  accentColor?: string;
  density?: string;
  customCss?: string;
}): void {
  const root = document.documentElement;
  const accent = /^#[0-9a-f]{6}$/i.test(String(general.accentColor || ''))
    ? String(general.accentColor)
    : '#4f6f8f';
  root.style.setProperty('--accent', accent);
  // 半透明强调底色：直接拼 8 位 hex，主题切换时也成立。
  root.style.setProperty('--accent-soft', `${accent}24`);
  root.dataset.density = general.density === 'compact' ? 'compact' : 'comfortable';

  let style = document.getElementById('shizi-custom-css') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'shizi-custom-css';
    document.head.appendChild(style);
  }
  style.textContent = String(general.customCss || '');
}
