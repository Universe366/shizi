// 插件 ↔ 桌面桥的兼容入口。
//
// 真正的连接、发现、离线队列在 desktop-link.js；这里保留旧导出名，
// 让「立即同步」按钮与设置页不用同时改两套 API。

import { store } from './store.js';
import { syncNow, discoverDesktop, buildSnapshotPayload } from './desktop-link.js';

// 兼容旧导出名。
export { discoverDesktop, buildSnapshotPayload as buildDesktopPayload };

/** 手动立即同步：跳过去重，强制把当前字幕与总结推给桌面端。 */
export async function sendToDesktop(state = store.get()) {
  const settings = (state && state.settings) || {};
  const cfg = settings.desktop || {};
  if (cfg.enabled === false) throw new Error('桌面端推送已在设置里关闭');
  if (!state || !state.video) throw new Error('还没有读取视频');
  const lines = Array.isArray(state.subtitles) ? state.subtitles : [];
  if (!lines.length) throw new Error('还没有字幕可推送');

  const result = await syncNow(state);
  if (!result.pushed && result.pending > 0) {
    throw new Error(
      '没有检测到桌面端。请先启动桌面端；扩展会自动连接，不需要填端口或 Token。数据已留在本地，连接后会自动补传。'
    );
  }
  return {
    lineCount: lines.length,
    summarySaved: Boolean(state.summary),
    pushed: result.pushed,
    pending: result.pending
  };
}
