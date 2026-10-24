import { globalShortcut } from 'electron';
import { loadSettings } from './settings';
import { openPetWindow, petWebContents } from './petWindow';
import { beginRegionCapture } from './shotOverlay';

/** 全局框选截图：桌宠启用时可用，截完把结果送回桌宠气泡。 */
export const PET_SHOT_ACCELERATOR = 'Control+Shift+S';

let registered = false;

export function registerPetShortcuts(): void {
  if (registered) return;
  try {
    const ok = globalShortcut.register(PET_SHOT_ACCELERATOR, () => {
      if (!loadSettings().general.petEnabled) return;
      openPetWindow();
      void (async () => {
        const result = await beginRegionCapture();
        if (!result) return;
        const wc = petWebContents();
        if (!wc || wc.isDestroyed()) return;
        // 快捷键可能刚把桌宠窗口拉起来，等页面加载完再发，否则事件会丢。
        if (wc.isLoading()) {
          wc.once('did-finish-load', () => {
            if (!wc.isDestroyed()) wc.send('pet:shot', result);
          });
        } else {
          wc.send('pet:shot', result);
        }
      })();
    });
    registered = ok;
    if (!ok) console.warn('[pet] 快捷键注册失败（可能被其他程序占用）:', PET_SHOT_ACCELERATOR);
  } catch (error) {
    console.warn('[pet] 快捷键注册异常:', (error as Error).message);
  }
}

export function unregisterPetShortcuts(): void {
  try {
    globalShortcut.unregister(PET_SHOT_ACCELERATOR);
  } catch {
    // 忽略
  }
  registered = false;
}
