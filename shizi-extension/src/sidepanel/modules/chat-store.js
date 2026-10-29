// 对话历史持久化：按视频保存最近 60 条消息，关掉侧边栏/刷新后恢复。
//
// 与桌面端 chat.db 的对齐点：桌面端对话会持久化；插件以前只存在内存里，
// 面板一关就丢。这里先做本地持久化，独立可用；后续可再同步到桌面。

import { store } from './store.js';
import { chatHistoryGet, chatHistoryPut, chatHistoryClear } from '../../shared/storage.js';
import { linkStatus } from './desktop-link.js';
import { syncChatConversation } from './desktop-ai.js';

export function chatKey(video = store.get().video) {
  if (!video) return '';
  if (video.bvid || video.cid) {
    return ['v', video.bvid || '-', video.cid || '-', video.page == null ? '-' : video.page].join('|');
  }
  return video.url ? `u|${video.url}` : '';
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({
      role: message.role,
      text: String(message.text || ''),
      reasoning: message.reasoning ? String(message.reasoning).slice(0, 4000) : '',
      toolTrace: Array.isArray(message.toolTrace) ? message.toolTrace.slice(0, 12) : undefined,
      reasonMs: Number(message.reasonMs) || 0
    }))
    .filter((message) => message.text.trim() || message.reasoning)
    .slice(-60);
}

export async function loadChatForVideo(video = store.get().video) {
  const key = chatKey(video);
  if (!key) return [];
  try {
    const row = await chatHistoryGet(key);
    const messages = cleanMessages(row && row.messages);
    store.set({ chat: messages });
    return messages;
  } catch (err) {
    store.set({ chat: [] });
    return [];
  }
}

let saveTimer = null;
let lastChat = null;

function scheduleSave() {
  const state = store.get();
  if (state.chat === lastChat) return;
  lastChat = state.chat;
  const messages = cleanMessages(state.chat);
  // 空对话不写：换视频时先清空、再异步载入，不能把新视频的历史清掉。
  if (!messages.length) return;
  const key = chatKey(state.video);
  if (!key) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    chatHistoryPut(key, messages).catch(() => {});
    // 桌面端连接时，整段同步到 chat.db（只覆盖该 key 的桥接会话）。
    if (linkStatus().state === 'connected') {
      const video = state.video || {};
      syncChatConversation(key, {
        videoKey: key,
        videoTitle: video.title || '',
        messages: messages.map((message) => ({
          role: message.role,
          content: message.text,
          reasoning: message.reasoning
        }))
      }).catch(() => {});
    }
  }, 600);
}

let watching = false;

/** 面板初始化时调用一次；订阅 store，消息变化自动落盘。 */
export function watchChatPersistence() {
  if (watching) return;
  watching = true;
  lastChat = store.get().chat;
  store.subscribe(() => scheduleSave());
}

export async function clearChatForVideo(video = store.get().video) {
  const key = chatKey(video);
  if (!key) return;
  try {
    await chatHistoryClear(key);
  } catch (err) {
    /* ignore */
  }
}
