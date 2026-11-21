import { nativeTheme } from 'electron';
import type { WebContents } from 'electron';
import { loadSettings } from './settings';
import { mediaSiteKey } from '../shared/media';

const BILI_DARK_CSS =
  '@media (prefers-color-scheme: dark){' +
  '[class*="bpx-player-control"]{background-image:none !important;}' +
  '[class*="bpx-player-control"]::before,[class*="bpx-player-control"]::after{background-image:none !important;}' +
  '.bpx-player-control-bottom{background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.72)) !important;}' +
  '}';

/** 主标签页与侧栏网页共用同一套网页深浅色策略。 */
export async function applyPageDarkMode(wc: WebContents): Promise<void> {
  const settings = loadSettings();
  const host = mediaSiteKey(wc.getURL());
  const disabled =
    Boolean(host) && (settings.general.siteDarkDisabled || []).includes(host);
  const enabled =
    !disabled &&
    (settings.general.theme === 'dark' ||
      (settings.general.theme === 'system' && nativeTheme.shouldUseDarkColors));
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: enabled ? [{ name: 'prefers-color-scheme', value: 'dark' }] : []
    });
    await wc.debugger.sendCommand('Emulation.setAutoDarkModeOverride', { enabled });
    if (enabled && host.endsWith('bilibili.com')) {
      await wc.insertCSS(BILI_DARK_CSS);
    }
  } catch {
    // 页面尚未 ready 或调试器被占用时忽略，下一次加载会再试。
  }
}
