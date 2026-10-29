// 存储层：chrome.storage.local 存配置（本机、不同步），IndexedDB 存字幕缓存 / 音轨分块 / 历史。
import * as CFG from './settings.js';

const SETTINGS_KEY = 'bsub.settings.v1';
const TRACK_CHOICE_KEY = 'bsub.trackChoice.v1';
const DB_NAME = 'bsub-db';
const DB_VERSION = 4;
const STORE_CACHE = 'subtitleCache';
const STORE_AUDIO = 'audioChunks';
const STORE_HISTORY = 'history';
// 桌面端离线队列：每个视频只保留最新一份快照（按 uid 覆盖），
// 不用「每次保存追加一条」，否则断网时会迅速撑大 IndexedDB。
const STORE_OUTBOX = 'desktopOutbox';
// 桌面库的本地镜像：只存列表投影（uid/标题/总结摘要等），不含字幕正文。
const STORE_LIBRARY = 'desktopLibrary';
// 按视频保存的对话历史：关掉侧边栏/刷新后还能接着聊。
const STORE_CHAT = 'chatHistory';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        const s = db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        s.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const s = db.createObjectStore(STORE_HISTORY, { keyPath: 'key' });
        s.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const s = db.createObjectStore(STORE_OUTBOX, { keyPath: 'key' });
        s.createIndex('queuedAt', 'queuedAt');
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        const s = db.createObjectStore(STORE_LIBRARY, { keyPath: 'uid' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_CHAT)) {
        const s = db.createObjectStore(STORE_CHAT, { keyPath: 'key' });
        s.createIndex('savedAt', 'savedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB 事务被中止'));
  });
}

function reqPromise(request) {
  return { __req: request };
}

export const db = {
  async put(store, value) {
    await tx(store, 'readwrite', (s) => s.put(value));
    return value;
  },
  async get(store, key) {
    return tx(store, 'readonly', (s) => reqPromise(s.get(key)));
  },
  async del(store, key) {
    await tx(store, 'readwrite', (s) => s.delete(key));
  },
  async all(store) {
    return tx(store, 'readonly', (s) => reqPromise(s.getAll()));
  },
  async clear(store) {
    await tx(store, 'readwrite', (s) => s.clear());
  },
  async count(store) {
    return tx(store, 'readonly', (s) => reqPromise(s.count()));
  },
  async putAll(store, rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return 0;
    await tx(store, 'readwrite', (s) => {
      for (const row of list) s.put(row);
    });
    return list.length;
  }
};

export const STORES = {
  STORE_CACHE,
  STORE_AUDIO,
  STORE_HISTORY,
  STORE_OUTBOX,
  STORE_LIBRARY,
  STORE_CHAT
};

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

let settingsCache = null;

export async function loadSettings() {
  if (settingsCache) return settingsCache;
  let raw = null;
  try {
    const got = await chrome.storage.local.get(SETTINGS_KEY);
    raw = got ? got[SETTINGS_KEY] : null;
  } catch (err) {
    raw = null;
  }
  settingsCache = CFG.migrateSettings(raw);
  return settingsCache;
}

export async function saveSettings(next) {
  settingsCache = CFG.migrateSettings(next);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settingsCache });
  return settingsCache;
}

// 局部更新（点路径，如 ['general','theme']），避免整对象覆盖丢字段。
export async function patchSettings(path, value) {
  const cur = await loadSettings();
  const clone = JSON.parse(JSON.stringify(cur));
  let node = clone;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!CFG.isPlainObject(node[path[i]])) node[path[i]] = {};
    node = node[path[i]];
  }
  node[path[path.length - 1]] = value;
  return saveSettings(clone);
}

export async function updateSettings(patch) {
  const cur = await loadSettings();
  return saveSettings(CFG.deepMerge(cur, patch));
}

export function invalidateSettingsCache() {
  settingsCache = null;
}

// ---------------------------------------------------------------------------
// 字幕缓存：key 去掉查询串（签名短时效，带查询串会导致永不命中）
// ---------------------------------------------------------------------------

export function subtitleCacheKey(parts) {
  const { bvid, cid, page, lang, url } = parts;
  const clean = stripQuery(url || '');
  // 只保留 path（去掉 host 上的易变子域）
  let pathKey = clean;
  try {
    const u = new URL(clean, 'https://x.invalid');
    pathKey = u.pathname;
  } catch (err) {
    /* 保留原样 */
  }
  // v2：WBI 签名接口修复后，旧缓存可能来自无签名接口的串片结果，整体失效。
  return ['sub', 'v2', bvid || '-', cid || '-', page == null ? '-' : String(page), lang || '-', pathKey].join('|');
}

export function stripQuery(url) {
  return String(url || '').split('#')[0].split('?')[0];
}

export async function cacheGetSubtitle(key) {
  const row = await db.get(STORE_CACHE, key);
  if (!row) return null;
  return row;
}

export async function cachePutSubtitle(key, payload, meta = {}) {
  const row = {
    key,
    savedAt: Date.now(),
    payload,
    meta
  };
  await db.put(STORE_CACHE, row);
  return row;
}

// 删除单条字幕缓存：发现签名不符/旧版本写入时，避免它继续占空间或再次命中
export async function cacheDelSubtitle(key) {
  await db.del(STORE_CACHE, key);
  return { ok: true };
}

export async function cacheClearOld(days) {
  if (!days || days <= 0) return 0;
  const cutoff = Date.now() - days * 86400000;
  const rows = await db.all(STORE_CACHE);
  let removed = 0;
  for (const r of rows) {
    if (!r.savedAt || r.savedAt < cutoff) {
      await db.del(STORE_CACHE, r.key);
      removed += 1;
    }
  }
  return removed;
}

export async function cacheStats() {
  const rows = await db.all(STORE_CACHE);
  const audio = await db.count(STORE_AUDIO);
  const history = await db.count(STORE_HISTORY);
  let bytes = 0;
  for (const r of rows) {
    try {
      bytes += JSON.stringify(r.payload || {}).length;
    } catch (err) {
      /* ignore */
    }
  }
  return { subtitleCount: rows.length, audioCount: audio, historyCount: history, approxBytes: bytes };
}

// ---------------------------------------------------------------------------
// 音轨分块（历史遗留：音频缓存功能未启用，只保留清理入口供「清空缓存」使用）
// ---------------------------------------------------------------------------

export async function clearAudioChunks() {
  await db.clear(STORE_AUDIO);
}

// ---------------------------------------------------------------------------
// 历史记录
// ---------------------------------------------------------------------------

export function historyKey(video) {
  return [video.bvid || '-', video.cid || '-', video.page == null ? '-' : String(video.page)].join('|');
}

export async function historyPut(video, entry) {
  const key = historyKey(video);
  const prev = (await db.get(STORE_HISTORY, key)) || {};
  const row = {
    key,
    savedAt: Date.now(),
    video: {
      bvid: video.bvid,
      aid: video.aid,
      cid: video.cid,
      page: video.page,
      title: video.title,
      partTitle: video.partTitle,
      owner: video.owner,
      duration: video.duration
    },
    ...prev,
    ...entry
  };
  // 空字符串/空数组不该覆盖已有内容。
  //
  // 这里是「合并写」（{...prev, ...entry}），而调用方经常在 summary
  // 已被清空的时候保存字幕 —— 若 entry.summary === ''，已经存好的总结
  // 就会被抹掉，表现为「字幕有、总结没了」。
  // 调用方已尽量不写空值，这里再加一道兜底，防止将来别的调用方踩同一个坑。
  if (entry && entry.summary === '' && prev.summary) row.summary = prev.summary;
  if (entry && Array.isArray(entry.lines) && entry.lines.length === 0 && Array.isArray(prev.lines) && prev.lines.length) {
    row.lines = prev.lines;
  }
  await db.put(STORE_HISTORY, row);
  return row;
}

export async function historyList(limit = 100) {
  const rows = await db.all(STORE_HISTORY);
  rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return rows.slice(0, limit);
}

export async function historyAll() {
  return historyList(10000);
}

export async function historyGet(key) {
  return db.get(STORE_HISTORY, key);
}

export async function historyRemove(key) {
  await db.del(STORE_HISTORY, key);
}

export async function historyClear() {
  await db.clear(STORE_HISTORY);
}

// ---------------------------------------------------------------------------
// 手动选轨记忆（按视频，不参与设置同步）
// ---------------------------------------------------------------------------

function trackChoiceKey(video) {
  return [video && video.bvid ? video.bvid : '-', video && video.cid ? video.cid : '-', video && video.page == null ? '-' : video.page].join('|');
}

export async function loadTrackChoice(video) {
  try {
    const got = await chrome.storage.local.get(TRACK_CHOICE_KEY);
    const map = (got && got[TRACK_CHOICE_KEY]) || {};
    return map[trackChoiceKey(video)] || null;
  } catch (err) {
    return null;
  }
}

export async function saveTrackChoice(video, choice) {
  if (!video || !choice) return;
  try {
    const got = await chrome.storage.local.get(TRACK_CHOICE_KEY);
    const map = { ...((got && got[TRACK_CHOICE_KEY]) || {}) };
    map[trackChoiceKey(video)] = {
      lan: String(choice.lan || ''),
      source: String(choice.source || ''),
      isAi: Boolean(choice.isAi)
    };
    await chrome.storage.local.set({ [TRACK_CHOICE_KEY]: map });
  } catch (err) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// 桌面端离线队列
// ---------------------------------------------------------------------------

/** 写入/覆盖某个视频的待同步快照。 */
export async function outboxPut(row) {
  await db.put(STORE_OUTBOX, row);
  return row;
}

export async function outboxAll() {
  const rows = await db.all(STORE_OUTBOX);
  rows.sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
  return rows;
}

export async function outboxDel(key) {
  await db.del(STORE_OUTBOX, key);
}

export async function outboxCount() {
  return db.count(STORE_OUTBOX);
}

export async function outboxClear() {
  await db.clear(STORE_OUTBOX);
}

// ---------------------------------------------------------------------------
// 桌面库镜像
// ---------------------------------------------------------------------------

export async function libraryPutAll(items) {
  return db.putAll(STORE_LIBRARY, items);
}

export async function libraryAll() {
  const rows = await db.all(STORE_LIBRARY);
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return rows;
}

export async function libraryCount() {
  return db.count(STORE_LIBRARY);
}

export async function libraryClear() {
  await db.clear(STORE_LIBRARY);
}

export async function libraryDeleteMany(uids) {
  const list = Array.isArray(uids) ? uids : [];
  for (const uid of list) {
    if (uid) await db.del(STORE_LIBRARY, uid);
  }
  return list.length;
}

/** 全量快照未被截断时用：先清空再写入，顺带同步桌面端的删除。 */
export async function libraryReplaceAll(items) {
  await db.clear(STORE_LIBRARY);
  return db.putAll(STORE_LIBRARY, items);
}

// ---------------------------------------------------------------------------
// 对话历史（按视频）
// ---------------------------------------------------------------------------

export async function chatHistoryPut(key, messages, meta = {}) {
  await db.put(STORE_CHAT, { key, savedAt: Date.now(), messages, meta });
}

export async function chatHistoryGet(key) {
  return db.get(STORE_CHAT, key);
}

export async function chatHistoryClear(key) {
  await db.del(STORE_CHAT, key);
}

export async function chatHistoryAll() {
  const rows = await db.all(STORE_CHAT);
  rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return rows;
}
