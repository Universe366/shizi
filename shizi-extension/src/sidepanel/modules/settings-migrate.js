// 首次连接设置迁移：让用户选择主端，并在两端之间复制共享设置。
//
// 方向不做时间判断：
//   - 只有一端有配置 → 自动从有配置的一端复制；
//   - 两端都有配置 → 弹窗让用户选择；
//   - 选择后记录 settingsAuthority，之后可在设置里重新选择/撤销。

import { h, button, toast } from './dom.js';
import { openOverlay, closeOverlays, confirmDialog } from './ui.js';
import { store, loadSettings, saveSettings } from './store.js';
import {
  linkStatus,
  fetchSharedSettings,
  pushSharedSettings,
  queueSnapshot,
  flushOutbox,
  syncLibrary,
  fetchBridgeChats
} from './desktop-link.js';
import { syncChatConversation } from './desktop-ai.js';
import { historyAll, chatHistoryAll, chatHistoryPut } from '../../shared/storage.js';
import { exportSharedSettings, importSharedSettings } from '../../shared/settings-sync.js';

const BACKUP_KEY = 'bsub.settingsMigrationBackup.v1';

function platformCounts(settings) {
  return {
    ai: (settings.ai && settings.ai.platforms ? settings.ai.platforms.length : 0),
    search: (settings.search && settings.search.platforms ? settings.search.platforms.length : 0),
    asr: (settings.asr && settings.asr.platforms ? settings.asr.platforms.length : 0)
  };
}

function hasKeys(settings) {
  const groups = [settings.ai, settings.search, settings.asr];
  return groups.some((group) =>
    ((group && group.platforms) || []).some((platform) => String(platform.apiKey || '').trim())
  );
}

function sharedHasKeys(shared) {
  const groups = [shared && shared.ai, shared && shared.search, shared && shared.asr];
  return groups.some((group) =>
    ((group && group.platforms) || []).some(
      (platform) => platform.hasKey || String(platform.apiKey || '').trim()
    )
  );
}

function sharedCounts(shared) {
  return {
    ai: (shared && shared.ai && shared.ai.platforms ? shared.ai.platforms.length : 0),
    search: (shared && shared.search && shared.search.platforms ? shared.search.platforms.length : 0),
    asr: (shared && shared.asr && shared.asr.platforms ? shared.asr.platforms.length : 0)
  };
}

async function readBackup() {
  try {
    const got = await chrome.storage.local.get(BACKUP_KEY);
    return got ? got[BACKUP_KEY] || null : null;
  } catch (err) {
    return null;
  }
}

async function writeBackup(backup) {
  try {
    await chrome.storage.local.set({ [BACKUP_KEY]: backup });
  } catch (err) {
    /* ignore */
  }
}

async function clearBackup() {
  try {
    await chrome.storage.local.remove(BACKUP_KEY);
  } catch (err) {
    /* ignore */
  }
}

function withAuthority(settings, authority) {
  return {
    ...settings,
    desktop: { ...(settings.desktop || {}), settingsAuthority: authority }
  };
}

/** 以桌面端为准：桌面共享设置覆盖插件。 */
export async function migrateFromDesktop() {
  const current = store.get().settings || (await loadSettings());
  const includeSecrets = current.desktop?.migrateKeys !== false;
  const shared = await fetchSharedSettings(includeSecrets);
  const previousDesktop = await fetchSharedSettings(true).catch(() => null);
  await writeBackup({
    at: Date.now(),
    direction: 'desktop',
    plugin: current,
    desktop: previousDesktop,
    authority: current.desktop?.settingsAuthority || ''
  });
  const next = importSharedSettings(current, shared);
  next.desktop = {
    ...(next.desktop || {}),
    settingsAuthority: 'desktop',
    migrationDismissed: false
  };
  await saveSettings(next);
  let data = null;
  try {
    data = await migrateDataFromDesktop();
  } catch (err) {
    toast({ title: '设置已同步，但桌面库/对话拉取失败', detail: String((err && err.message) || err) }, 'warn', 5000);
  }
  toast(
    {
      title: '已以桌面端为准',
      detail: data ? `设置与桌面库已同步；对话 ${data.chats} 个` : '设置与桌面库已同步'
    },
    'ok',
    3200
  );
  return next;
}

/** 拉取桌面库，并把桌面桥接对话写回插件本地。 */
export async function migrateDataFromDesktop(onProgress = () => {}) {
  await syncLibrary();
  const chats = await fetchBridgeChats(true);
  let imported = 0;
  for (let index = 0; index < chats.length; index += 1) {
    const row = chats[index];
    if (!row || !row.key || !Array.isArray(row.messages) || !row.messages.length) continue;
    await chatHistoryPut(
      row.key,
      row.messages
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({
          role: message.role,
          text: String(message.content || ''),
          reasoning: String(message.reasoning || '')
        })),
      {
        videoTitle: row.videoTitle || '',
        title: row.title || row.videoTitle || '桌面对话',
        importedFrom: 'desktop'
      }
    );
    imported += 1;
    if ((index + 1) % 10 === 0) onProgress({ kind: 'chat', done: index + 1, total: chats.length });
  }
  return { chats: imported };
}

/** 把插件本地历史库与对话批量推到桌面端。 */
export async function migrateDataToDesktop(onProgress = () => {}) {
  const settings = store.get().settings || (await loadSettings());
  const history = await historyAll();
  let pushedHistory = 0;
  let skippedHistory = 0;
  for (let index = 0; index < history.length; index += 1) {
    const row = history[index];
    if (!row || !row.video) continue;
    const result = await queueSnapshot(
      { video: row.video, subtitles: row.lines || [], summary: row.summary || '', settings },
      { force: true }
    );
    if (result && result.queued) pushedHistory += 1;
    else skippedHistory += 1;
    if ((index + 1) % 10 === 0) {
      await flushOutbox({ force: true });
      onProgress({ kind: 'history', done: index + 1, total: history.length });
    }
  }
  await flushOutbox({ force: true });

  const chats = await chatHistoryAll();
  let pushedChats = 0;
  for (let index = 0; index < chats.length; index += 1) {
    const row = chats[index];
    if (!row || !row.key || !Array.isArray(row.messages) || !row.messages.length) continue;
    await syncChatConversation(row.key, {
      videoKey: row.key,
      videoTitle: row.videoTitle || '',
      messages: row.messages.map((message) => ({
        role: message.role,
        content: message.text || '',
        reasoning: message.reasoning || ''
      }))
    });
    pushedChats += 1;
    if ((index + 1) % 10 === 0) onProgress({ kind: 'chat', done: index + 1, total: chats.length });
  }
  return { history: pushedHistory, skippedHistory, chats: pushedChats };
}

/** 以插件端为准：插件共享设置覆盖桌面。 */
export async function migrateToDesktop() {
  const current = store.get().settings || (await loadSettings());
  const includeSecrets = current.desktop?.migrateKeys !== false;
  const shared = exportSharedSettings(current, includeSecrets);
  const previousDesktop = await fetchSharedSettings(true).catch(() => null);
  await writeBackup({
    at: Date.now(),
    direction: 'plugin',
    plugin: current,
    desktop: previousDesktop,
    authority: current.desktop?.settingsAuthority || ''
  });
  await pushSharedSettings(shared);
  const next = withAuthority(current, 'plugin');
  next.desktop = { ...(next.desktop || {}), migrationDismissed: false };
  await saveSettings(next);
  let data = null;
  try {
    data = await migrateDataToDesktop();
  } catch (err) {
    toast({ title: '设置已同步，但历史/对话迁移失败', detail: String((err && err.message) || err) }, 'warn', 5000);
  }
  toast(
    {
      title: '已以插件端为准',
      detail: data
        ? `设置已更新；历史 ${data.history} 条、对话 ${data.chats} 个已推送`
        : '桌面端共享设置已更新'
    },
    'ok',
    3600
  );
  return next;
}

/** 撤销最近一次设置迁移。 */
export async function undoLastMigration() {
  const backup = await readBackup();
  if (!backup) throw new Error('没有可撤销的迁移');
  if (backup.direction === 'plugin' && backup.desktop) {
    await pushSharedSettings(backup.desktop);
  }
  if (backup.plugin) {
    const restored = withAuthority(backup.plugin, backup.authority || '');
    await saveSettings(restored);
  }
  await clearBackup();
  toast({ title: '已撤销上次设置迁移' }, 'ok', 2600);
}

export async function migrationBackupExists() {
  return Boolean(await readBackup());
}

function showChoiceDialog(shared) {
  const plugin = store.get().settings || {};
  const pluginCounts = platformCounts(plugin);
  const desktopCounts = sharedCounts(shared);
  const body = h('div');
  body.appendChild(
    h('div', {
      text: '两端都有配置。请选择以哪一端作为设置主端；只同步 AI / 检索 / ASR / 提示词 / 术语表 / 导出，不包含面板布局等专属配置。'
    })
  );
  const table = h('div', { class: 'note', style: { marginTop: '8px', lineHeight: '1.7' } });
  table.appendChild(
    h('div', {
      text: `插件端：AI ${pluginCounts.ai} · 检索 ${pluginCounts.search} · ASR ${pluginCounts.asr} · ${hasKeys(plugin) ? '含 Key' : '无 Key'}`
    })
  );
  table.appendChild(
    h('div', {
      text: `桌面端：AI ${desktopCounts.ai} · 检索 ${desktopCounts.search} · ASR ${desktopCounts.asr} · ${sharedHasKeys(shared) ? '含 Key' : '无 Key'}`
    })
  );
  body.appendChild(table);
  body.appendChild(
    h('div', {
      class: 'note muted',
      text: '迁移前会保留两端的设置快照，可在设置里撤销。'
    })
  );

  const run = async (fn) => {
    closeOverlays();
    try {
      await fn();
    } catch (err) {
      toast({ title: '迁移失败', detail: String((err && err.message) || err) }, 'error', 4200);
    }
  };

  openOverlay(
    '首次连接：选择设置主端',
    body,
    [
      {
        label: '稍后',
        onClick: async () => {
          closeOverlays();
          const current = store.get().settings || (await loadSettings());
          await saveSettings({
            ...current,
            desktop: { ...(current.desktop || {}), migrationDismissed: true }
          });
        }
      },
      {
        label: '以插件端为准',
        onClick: () => void run(migrateToDesktop)
      },
      {
        label: '以桌面端为准',
        primary: true,
        onClick: () => void run(migrateFromDesktop)
      }
    ],
    { width: 'min(560px, 92vw)' }
  );
}

let offering = false;

/** 首次连接后调用；只有一端有配置时自动迁移，两端都有时弹窗。 */
export async function maybeOfferSettingsMigration() {
  if (offering) return;
  const settings = store.get().settings;
  if (!settings || !settings.desktop) return;
  const cfg = settings.desktop;
  if (cfg.settingsAuthority || cfg.migrationDismissed) return;
  if (linkStatus().state !== 'connected') return;
  offering = true;
  try {
    const shared = await fetchSharedSettings(false);
    // 不做时间/“谁有 Key”判断：首次连接一律让用户选择主端。
    showChoiceDialog(shared);
  } catch (err) {
    // 桌面端没配置/读取失败都不阻塞使用，下次连接再试。
    console.warn('[拾字] 设置迁移检查失败', err && err.message);
  } finally {
    offering = false;
  }
}

/** 设置页手动选择入口。 */
export function chooseDesktopAsAuthority() {
  return migrateFromDesktop();
}

export function choosePluginAsAuthority() {
  return migrateToDesktop();
}

export function confirmUndoMigration() {
  return new Promise((resolve) => {
    confirmDialog(
      '撤销设置迁移',
      '会用迁移前保存的快照恢复插件设置，并在需要时把桌面设置恢复回去。确定继续？',
      () => {
        undoLastMigration()
          .then(() => resolve(true))
          .catch((err) => {
            toast({ title: '撤销失败', detail: String((err && err.message) || err) }, 'error', 4200);
            resolve(false);
          });
      }
    );
  });
}
