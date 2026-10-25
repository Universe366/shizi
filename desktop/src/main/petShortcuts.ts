import { globalShortcut } from 'electron';
import { loadSettings } from './settings';
import { openPetWindow, petWebContents } from './petWindow';
import { beginRegionCapture } from './shotOverlay';

/** 桌面宠物全局快捷键。截图必须可用；对话/语音可通过设置关闭。 */
// 不要用 Control+Shift+S：主窗口的「选中即问」占用了它，全局注册会把它吞掉。
export const PET_SHOT_ACCELERATOR = 'Control+Alt+S';
export const PET_VOICE_ACCELERATOR = 'Control+Shift+Space';
export const PET_CHAT_ACCELERATOR = 'Control+Shift+D';

export interface PetShortcutState {
  id: 'shot' | 'voice' | 'chat';
  accelerator: string;
  registered: boolean;
  error: string;
}

const states: Record<PetShortcutState['id'], PetShortcutState> = {
  shot: { id: 'shot', accelerator: PET_SHOT_ACCELERATOR, registered: false, error: '' },
  voice: { id: 'voice', accelerator: PET_VOICE_ACCELERATOR, registered: false, error: '' },
  chat: { id: 'chat', accelerator: PET_CHAT_ACCELERATOR, registered: false, error: '' }
};

function sendToPet(channel: string): void {
  const before = petWebContents();
  openPetWindow();
  const wc = petWebContents();
  if (!wc || wc.isDestroyed()) return;
  const deliver = () => {
    if (!wc.isDestroyed()) wc.send(channel);
  };
  // 新窗口的 React effect 要等首帧之后才注册监听，did-finish-load 仍然可能太早；
  // 已就绪的窗口立即发，新窗口给 600ms 缓冲。
  if (before && !before.isDestroyed() && !wc.isLoading()) deliver();
  else setTimeout(deliver, 600);
}

function register(id: PetShortcutState['id'], callback: () => void): void {
  const state = states[id];
  state.registered = false;
  state.error = '';
  try {
    const ok = globalShortcut.register(state.accelerator, callback);
    state.registered = ok;
    if (!ok) state.error = '被其他程序占用';
  } catch (error) {
    state.error = (error as Error).message;
  }
}

/** 注册/重新注册全部桌宠快捷键（设置变化后调用）。 */
export function registerPetShortcuts(): void {
  unregisterPetShortcuts();
  const settings = loadSettings();
  if (!settings.general.petEnabled) return;

  if (settings.general.petShortcut !== false) {
    register('shot', () => {
      if (loadSettings().general.petShortcut === false) return;
      openPetWindow();
      void (async () => {
        const result = await beginRegionCapture();
        if (!result) return;
        const wc = petWebContents();
        if (!wc || wc.isDestroyed()) return;
        if (wc.isLoading()) {
          wc.once('did-finish-load', () => {
            if (!wc.isDestroyed()) wc.send('pet:shot', result);
          });
        } else {
          wc.send('pet:shot', result);
        }
      })();
    });
  }
  if (settings.general.petVoiceShortcut !== false) {
    register('voice', () => sendToPet('pet:voice'));
  }
  if (settings.general.petChatShortcut !== false) {
    register('chat', () => sendToPet('pet:open-chat'));
  }
}

export function unregisterPetShortcuts(): void {
  for (const state of Object.values(states)) {
    try {
      globalShortcut.unregister(state.accelerator);
    } catch {
      // ignore
    }
    state.registered = false;
  }
}

/** 兼容旧设置页：截图快捷键状态。 */
export function petShortcutStatus(): { accelerator: string; registered: boolean; error: string } {
  const state = states.shot;
  return { accelerator: state.accelerator, registered: state.registered, error: state.error };
}

export function petShortcutsStatus(): PetShortcutState[] {
  return Object.values(states);
}
